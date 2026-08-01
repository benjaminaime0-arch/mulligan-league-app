-- ============================================================================
-- Solo practice rounds: hidden personal practice game per user
-- ============================================================================
-- A lone user can log a hole-by-hole card on any course without a game or
-- friends — kills the cold-start wall and makes every /courses/[slug] page
-- convert. Design: matches.game_id stays NOT NULL (RLS, notifications,
-- activity and leaderboards all predicate on game membership); instead each
-- user gets ONE hidden `is_practice` game, created lazily.
--
-- Containment:
--   * max_players = 1 — the join flows' capacity check refuses on its own,
--     and both join RPCs additionally treat practice games as nonexistent
--     (same error as an invalid code: no oracle that the game exists).
--   * Sole member ⇒ games RLS (member-only) hides it from everyone else,
--     notification fan-out has no audience, shares_game_with widens nothing.
--   * get_user_honors skips practice games (badges against yourself are
--     noise); client listings filter is_practice.
--   * Elo: rate_match yields zero pairs for a 1-player match — asserted in
--     tests, no code change needed.
-- Completion: the sole player calls the EXISTING approve_match_scores
-- ("Terminer la partie" in the editor) — 1/1 approved ⇒ scores approved +
-- match completed. The 24h auto-validation remains the backstop.
--
-- Safe to re-run: IF NOT EXISTS / OR REPLACE throughout.
-- ============================================================================

ALTER TABLE public.games ADD COLUMN IF NOT EXISTS is_practice boolean NOT NULL DEFAULT false;

-- One practice game per user, enforced at the root.
CREATE UNIQUE INDEX IF NOT EXISTS games_one_practice_per_user
  ON public.games (admin_id) WHERE is_practice;

-- ---------------------------------------------------------------------------
-- get_or_create_practice_game: lazy, idempotent
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_practice_game()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_game_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT id INTO v_game_id FROM games WHERE admin_id = v_caller AND is_practice;
  IF v_game_id IS NOT NULL THEN
    RETURN json_build_object('success', true, 'game_id', v_game_id);
  END IF;

  -- No periods on purpose (matches.period_id is nullable); admin membership
  -- comes from the auto_add_game_admin_to_members trigger. status active so
  -- match surfaces treat it as a normal playable game.
  INSERT INTO games (
    name, course_name, admin_id, max_players, game_type,
    scoring_cards_count, total_cards_count, scoring_basis,
    status, is_practice
  )
  VALUES (
    'Entraînement', 'Entraînement', v_caller, 1, 'stroke_play',
    NULL, NULL, 'gross',
    'active', true
  )
  RETURNING id INTO v_game_id;

  RETURN json_build_object('success', true, 'game_id', v_game_id);
EXCEPTION WHEN unique_violation THEN
  -- Concurrent first call: the other one won; return its game.
  SELECT id INTO v_game_id FROM games WHERE admin_id = v_caller AND is_practice;
  RETURN json_build_object('success', true, 'game_id', v_game_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_or_create_practice_game() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_or_create_practice_game() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- create_practice_match: one call from CTA to open scorecard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_practice_match(
  p_course_id uuid DEFAULT NULL,
  p_course_name text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_game json;
  v_game_id uuid;
  v_match_id uuid;
  v_course_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_game := get_or_create_practice_game();
  IF (v_game->>'success')::boolean IS NOT TRUE THEN
    RETURN v_game;
  END IF;
  v_game_id := (v_game->>'game_id')::uuid;

  SELECT COALESCE(
    p_course_name,
    (SELECT name FROM courses WHERE id = p_course_id),
    'Entraînement'
  ) INTO v_course_name;

  INSERT INTO matches (game_id, course_name, course_id, match_date, created_by, status)
  VALUES (v_game_id, v_course_name, p_course_id, current_date, v_caller, 'scheduled')
  RETURNING id INTO v_match_id;

  INSERT INTO match_players (match_id, user_id) VALUES (v_match_id, v_caller);

  RETURN json_build_object('success', true, 'match_id', v_match_id, 'game_id', v_game_id);
EXCEPTION WHEN foreign_key_violation THEN
  RETURN json_build_object('success', false, 'error', 'Unknown course');
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_practice_match(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_practice_match(uuid, text) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- Join flows: practice games are invisible — same error as nonexistence
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_game_by_code(code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id       uuid := auth.uid();
  v_game_id     uuid;
  v_game_name   text;
  v_max_players   int;
  v_current_count int;
  v_normalized    text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_normalized := upper(btrim(code));

  IF length(v_normalized) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code is required');
  END IF;

  -- is_practice games are unjoinable by design: same error as an invalid
  -- code, so the response never reveals that a practice game exists.
  SELECT id, name, max_players
  INTO v_game_id, v_game_name, v_max_players
  FROM games
  WHERE upper(btrim(invite_code)) = v_normalized
    AND NOT is_practice
  LIMIT 1;

  IF v_game_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code');
  END IF;

  IF EXISTS (
    SELECT 1 FROM game_members
    WHERE game_id = v_game_id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already a member of this game');
  END IF;

  IF v_max_players IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_count
    FROM game_members WHERE game_id = v_game_id;
    IF v_current_count >= v_max_players THEN
      RETURN jsonb_build_object('success', false, 'error', 'This game is full');
    END IF;
  END IF;

  INSERT INTO game_members (game_id, user_id)
  VALUES (v_game_id, v_user_id);

  RETURN jsonb_build_object(
    'success', true, 'game_id', v_game_id, 'game_name', v_game_name
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_join_game(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_game_admin UUID;
  v_game_name TEXT;
  v_game_max INT;
  v_member_count INT;
  v_existing_count INT;
  v_pending_count INT;
  v_request_id UUID;
  v_requester_name TEXT;
BEGIN
  -- Practice games are invisible to join flows (same error as nonexistence).
  SELECT admin_id, name, max_players
  INTO v_game_admin, v_game_name, v_game_max
  FROM games WHERE id = p_game_id AND NOT is_practice;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Game not found');
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM game_members WHERE game_id = p_game_id AND user_id = v_user_id;
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already in this game');
  END IF;

  SELECT COUNT(*) INTO v_member_count FROM game_members WHERE game_id = p_game_id;
  IF v_game_max IS NOT NULL AND v_member_count >= v_game_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'Game is full');
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM join_requests
  WHERE requester_id = v_user_id AND target_type = 'game'
    AND target_id = p_game_id AND status = 'pending';
  IF v_pending_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a pending request for this game');
  END IF;

  SELECT COALESCE(username, first_name, 'Someone') INTO v_requester_name
  FROM profiles WHERE id = v_user_id;

  INSERT INTO join_requests (requester_id, target_type, target_id, admin_id)
  VALUES (v_user_id, 'game', p_game_id, v_game_admin)
  RETURNING id INTO v_request_id;

  PERFORM create_notification(
    v_game_admin,
    'join_request',
    v_requester_name || ' wants to join ' || v_game_name,
    'Tap to approve or reject this request.',
    jsonb_build_object(
      'request_id', v_request_id,
      'request_type', 'game',
      'game_id', p_game_id,
      'requester_id', v_user_id,
      'requester_name', v_requester_name
    )
  );

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Honors: badges against yourself are noise
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_honors(p_user_id uuid)
 RETURNS TABLE(game_id uuid, game_name text, game_format text, badge_key text, value numeric, unit text, sub text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    l.id                                AS game_id,
    l.name                              AS game_name,
    COALESCE(l.format, 'stroke_play')   AS game_format,
    b.badge_key,
    b.value,
    b.unit,
    b.sub
  FROM game_members lm
  JOIN games l ON l.id = lm.game_id
  CROSS JOIN LATERAL get_game_badges(l.id) b
  WHERE lm.user_id = p_user_id
    AND b.user_id  = p_user_id
    AND NOT l.is_practice
  ORDER BY
    l.name ASC,
    CASE b.badge_key
      WHEN 'best_round'       THEN 1
      WHEN 'most_active'      THEN 2
      WHEN 'most_consistent'  THEN 3
      ELSE 99
    END;
$function$;

-- ============================================================================
-- Verification (run manually):
--   SELECT get_or_create_practice_game();            -- twice: same game_id
--   SELECT create_practice_match('<course>', NULL);
--   SELECT join_game_by_code('<practice invite>');   -- 'Invalid invite code'
-- ============================================================================
