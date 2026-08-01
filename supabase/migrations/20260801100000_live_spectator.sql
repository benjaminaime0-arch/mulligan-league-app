-- ============================================================================
-- Public live spectator link (matches.live_share_token + RPCs)
-- ============================================================================
-- A member of a match can mint a public read-only URL for that round's live
-- leaderboard; anyone can open it without an account (dropped into the
-- group's WhatsApp when a round starts — every round becomes marketing).
--
-- Security model:
--   * Opt-in only: live_share_token is NULL until a member explicitly enables
--     sharing; NULL means no public access. Disabling nulls the token, which
--     kills every previously shared URL instantly.
--   * get_live_match is THE deliberate exception to the "no anon RPCs"
--     hardening posture: SECURITY DEFINER, pinned search_path, granted to
--     anon — and it is the ONLY anon-executable function. Table grants stay
--     untouched; anon still cannot read matches/scores/score_holes directly.
--   * The token is an unguessable uuid; unknown and revoked tokens return
--     the same found:false payload (no existence oracle).
--   * The payload is deliberately minimal: usernames + avatars only — no
--     user ids, no emails, no game internals beyond what a leaderboard shows.
--   * Freshness comes from matches.last_edit_at (bumped by trigger on every
--     score write) — score_holes carries no timestamp of its own.
--
-- Safe to re-run: IF NOT EXISTS / OR REPLACE throughout.
-- ============================================================================

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS live_share_token uuid UNIQUE;

-- ---------------------------------------------------------------------------
-- enable / disable (member-gated, idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enable_live_share(p_match_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_game_id uuid;
  v_token uuid;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT game_id INTO v_game_id FROM matches WHERE id = p_match_id;
  IF v_game_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Match not found');
  END IF;

  -- Same audience that can see the match: its players or their game-mates.
  IF NOT (
    EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND user_id = v_caller)
    OR is_game_member(v_game_id, v_caller)
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Members only');
  END IF;

  UPDATE matches
  SET live_share_token = COALESCE(live_share_token, gen_random_uuid())
  WHERE id = p_match_id
  RETURNING live_share_token INTO v_token;

  RETURN json_build_object('success', true, 'token', v_token);
END;
$$;
GRANT EXECUTE ON FUNCTION public.enable_live_share(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.enable_live_share(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.disable_live_share(p_match_id uuid)
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
  SELECT game_id INTO v_game_id FROM matches WHERE id = p_match_id;
  IF v_game_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Match not found');
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND user_id = v_caller)
    OR is_game_member(v_game_id, v_caller)
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Members only');
  END IF;

  UPDATE matches SET live_share_token = NULL WHERE id = p_match_id;
  RETURN json_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.disable_live_share(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.disable_live_share(uuid) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- get_live_match: the one anon-readable window, one round-trip
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_live_match(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_match record;
  v_basis text;
  v_format text;
  v_course_id uuid;
  v_players jsonb;
  v_course jsonb;
  v_mp jsonb;
  v_state jsonb;
  v_leader_name text;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT m.id, m.status, m.match_date, m.last_edit_at,
         COALESCE(m.course_name, g.course_name) AS course_name,
         COALESCE(m.course_id, g.course_id) AS course_id,
         COALESCE(g.format, 'stroke_play') AS format,
         COALESCE(g.scoring_basis, 'gross') AS scoring_basis
  INTO v_match
  FROM matches m
  LEFT JOIN games g ON g.id = m.game_id
  WHERE m.live_share_token = p_token;

  IF v_match.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_basis := v_match.scoring_basis;
  v_format := v_match.format;
  v_course_id := v_match.course_id;

  SELECT jsonb_build_object(
    'name', c.name, 'city', c.city, 'par', c.par,
    'holes_count', (SELECT count(*) FROM course_holes ch WHERE ch.course_id = c.id),
    'holes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('n', ch.hole_number, 'par', ch.par)
                       ORDER BY ch.hole_number)
      FROM course_holes ch WHERE ch.course_id = c.id
    ), '[]'::jsonb)
  ) INTO v_course
  FROM courses c WHERE c.id = v_course_id;

  -- Per player: display fields only. Totals/net/points reuse the same
  -- centralized math as the members' scorecard — no forked scoring logic.
  SELECT COALESCE(jsonb_agg(p ORDER BY p->>'name'), '[]'::jsonb) INTO v_players
  FROM (
    SELECT jsonb_build_object(
      'name', COALESCE(pr.username, pr.first_name, 'Joueur'),
      'avatar_url', pr.avatar_url,
      'gross', s.score,
      'thru', COALESCE((SELECT count(*) FROM score_holes sh WHERE sh.score_id = s.id), 0),
      'holes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('n', sh.hole_number, 'strokes', sh.strokes)
                         ORDER BY sh.hole_number)
        FROM score_holes sh WHERE sh.score_id = s.id
      ), '[]'::jsonb),
      'net', CASE WHEN v_basis = 'net' AND s.id IS NOT NULL
                  THEN round_basis_score(s.id, 'net') END,
      'points', CASE WHEN (v_basis = 'stableford_net' OR v_format = 'stableford')
                          AND s.id IS NOT NULL
                     THEN round_basis_score(s.id,
                       CASE WHEN v_basis = 'stableford_net' THEN 'stableford_net' ELSE 'gross' END) END,
      'declared_holes', s.holes
    ) AS p
    FROM match_players mp
    JOIN profiles pr ON pr.id = mp.user_id
    LEFT JOIN scores s ON s.match_id = mp.match_id AND s.user_id = mp.user_id
    WHERE mp.match_id = v_match.id
  ) sub;

  -- Match-play running state, stripped of user ids: side arrays become the
  -- leading side's display name only.
  IF v_format = 'match_play' THEN
    v_mp := match_play_state(v_match.id);
    IF (v_mp->>'available')::boolean THEN
      IF (v_mp->>'leader')::int > 0 THEN
        SELECT COALESCE(pr.username, pr.first_name, 'Joueur') INTO v_leader_name
        FROM profiles pr
        WHERE pr.id = ((CASE WHEN (v_mp->>'leader')::int = 1
                             THEN v_mp->'side_a' ELSE v_mp->'side_b' END)->>0)::uuid;
      END IF;
      v_state := jsonb_build_object(
        'state', v_mp->>'state',
        'thru', (v_mp->>'thru')::int,
        'final', (v_mp->>'final')::boolean,
        'leader_name', v_leader_name
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'course_name', v_match.course_name,
    'date', v_match.match_date,
    'status', v_match.status,
    'format', v_format,
    'scoring_basis', v_basis,
    'course', v_course,
    'players', v_players,
    'match_play', v_state,
    'updated_at', v_match.last_edit_at
  );
END;
$$;

-- The deliberate anon exception (see header).
GRANT EXECUTE ON FUNCTION public.get_live_match(uuid) TO anon, authenticated;

-- ============================================================================
-- Verification (run manually):
--   SELECT enable_live_share('<match>');            -- as a member
--   SELECT get_live_match('<token>');               -- as anon: SET ROLE anon
--   SELECT get_live_match(gen_random_uuid());       -- {found:false}
-- ============================================================================
