-- ============================================================================
-- Practice rounds: stats policy, match reuse, residue cleanup, silent finish
-- ============================================================================
-- Closes the residue of AUDIT 2026-08-10 P0#1. Four changes:
--
-- (1) STATS POLICY (the previously-undocumented decision, now explicit):
--     * COMPETITIVE/BRAGGING stats shown to game-mates exclude practice:
--       get_profile_records.best_score no longer counts solo practice
--       rounds — a self-scored, witness-less round is not a "best round"
--       claim. (top_rival is structurally immune: solo rounds have no
--       opponents.)
--     * HABIT/TRAJECTORY stats keep practice BY DESIGN: the play streak
--       (weeks with any round) and get_profile_score_trend measure how
--       much you play and how you're trending — a practice 18 is real
--       golf for those. Course history/conquest inclusion is the
--       documented product promise (PracticeCta copy, test T6).
--
-- (2) create_practice_match REUSES an existing scheduled, scoreless
--     practice match on the same course & day instead of inserting a new
--     row per tap — the CTA is one-tap with no confirm, so every stray tap
--     minted a residue match that the 24h crons never expire (they only
--     act on matches with scores / last_edit_at).
--
-- (3) A daily cleanup cron deletes scheduled practice matches that are
--     >7 days old and never received a score (match_players/scores FKs
--     cascade). Named mulligan_practice_residue_cleanup, 03:17 UTC.
--
-- (4) notify_match_completed skips practice games: finishing your own
--     solo round self-notified "Match completed!" — pure noise, and it
--     leaked the hidden game's existence into the notification list.
--
-- Safe to re-run: OR REPLACE + guarded cron scheduling.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) get_profile_records: best_score excludes practice
--     Body verbatim from 20260723170000 (caller gate intact); the ONLY
--     change is the is_practice filter on the best-round query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_profile_records(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_best_score RECORD;
  v_top_rival RECORD;
  v_longest_streak INT;
BEGIN
  -- Caller gate (AUD#3): stats are visible to game-mates only.
  IF NOT shares_game_with(p_user_id) THEN
    RETURN jsonb_build_object(
      'best_score', NULL, 'top_rival', NULL, 'longest_streak_weeks', 0
    );
  END IF;

  -- Best round: lowest approved score — competitive rounds only. A solo
  -- practice card (self-scored, no witnesses) can't set the record.
  SELECT s.score, s.holes, s.match_id,
         COALESCE(m.course_name, l.course_name) AS course_name,
         m.match_date
  INTO v_best_score
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  LEFT JOIN games l ON l.id = m.game_id
  WHERE s.user_id = p_user_id AND s.status = 'approved'
    AND COALESCE(l.is_practice, false) IS FALSE
  ORDER BY s.score ASC
  LIMIT 1;

  -- Top rival: opponent with the most head-to-head rounds (min 3).
  -- Tiebreak: more wins against them, then more rounds total.
  WITH user_scores AS (
    SELECT s.match_id, s.score AS my_score
    FROM scores s
    WHERE s.user_id = p_user_id AND s.status = 'approved'
  ),
  head_to_head AS (
    SELECT
      s.user_id AS opponent_id,
      us.my_score,
      s.score AS their_score
    FROM user_scores us
    JOIN scores s ON s.match_id = us.match_id
    WHERE s.user_id <> p_user_id
      AND s.status = 'approved'
  ),
  rival_stats AS (
    SELECT
      opponent_id,
      COUNT(*) AS total,
      SUM(CASE WHEN my_score < their_score THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN my_score > their_score THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN my_score = their_score THEN 1 ELSE 0 END) AS ties
    FROM head_to_head
    GROUP BY opponent_id
    HAVING COUNT(*) >= 3
  )
  SELECT
    rs.opponent_id AS user_id,
    COALESCE(p.username, p.first_name, 'Player') AS name,
    p.avatar_url,
    rs.wins,
    rs.losses,
    rs.ties,
    rs.total
  INTO v_top_rival
  FROM rival_stats rs
  JOIN profiles p ON p.id = rs.opponent_id
  ORDER BY rs.total DESC, rs.wins DESC
  LIMIT 1;

  -- Longest play streak: largest run of consecutive ISO weeks in which
  -- the user has at least one match with a score. Practice rounds COUNT
  -- here by design — the streak measures playing, not competing.
  -- Gap-and-islands pattern: subtract row_number * 7 days from each
  -- week; consecutive weeks share the same island value.
  WITH weeks_played AS (
    SELECT DISTINCT date_trunc('week', m.match_date)::date AS week
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND m.match_date IS NOT NULL
  ),
  numbered AS (
    SELECT week, ROW_NUMBER() OVER (ORDER BY week) AS rn
    FROM weeks_played
  ),
  islands AS (
    SELECT week, (week - (rn * interval '7 days'))::date AS island
    FROM numbered
  )
  SELECT COALESCE(MAX(cnt), 0) INTO v_longest_streak
  FROM (SELECT COUNT(*) AS cnt FROM islands GROUP BY island) t;

  RETURN jsonb_build_object(
    'best_score', CASE
      WHEN v_best_score.score IS NULL THEN NULL
      ELSE jsonb_build_object(
        'score', v_best_score.score,
        'holes', v_best_score.holes,
        'match_id', v_best_score.match_id,
        'course_name', v_best_score.course_name,
        'match_date', v_best_score.match_date
      )
    END,
    'top_rival', CASE
      WHEN v_top_rival.user_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'user_id', v_top_rival.user_id,
        'name', v_top_rival.name,
        'avatar_url', v_top_rival.avatar_url,
        'wins', v_top_rival.wins,
        'losses', v_top_rival.losses,
        'ties', v_top_rival.ties,
        'total', v_top_rival.total
      )
    END,
    'longest_streak_weeks', v_longest_streak
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- (2) create_practice_match: reuse today's scheduled scoreless match on the
--     same course. Body otherwise verbatim from 20260801110000.
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

  -- One-tap CTA, no confirm screen: a stray tap used to mint a fresh
  -- match every time, and scoreless matches never expire (the 24h crons
  -- key off scores/last_edit_at). Same course + same day + still
  -- scheduled + no scores yet => same round, reuse it.
  SELECT m.id INTO v_match_id
  FROM matches m
  WHERE m.game_id = v_game_id
    AND m.status = 'scheduled'
    AND m.match_date = current_date
    AND m.course_id IS NOT DISTINCT FROM p_course_id
    AND m.course_name = v_course_name
    AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.match_id = m.id)
  ORDER BY m.created_at DESC
  LIMIT 1;
  IF v_match_id IS NOT NULL THEN
    RETURN json_build_object(
      'success', true, 'match_id', v_match_id, 'game_id', v_game_id,
      'reused', true
    );
  END IF;

  INSERT INTO matches (game_id, course_name, course_id, match_date, created_by, status)
  VALUES (v_game_id, v_course_name, p_course_id, current_date, v_caller, 'scheduled')
  RETURNING id INTO v_match_id;

  INSERT INTO match_players (match_id, user_id) VALUES (v_match_id, v_caller);

  RETURN json_build_object('success', true, 'match_id', v_match_id, 'game_id', v_game_id);
EXCEPTION WHEN foreign_key_violation THEN
  RETURN json_build_object('success', false, 'error', 'Unknown course');
END;
$$;

-- ---------------------------------------------------------------------------
-- (3) Residue cleanup cron: scheduled + scoreless + practice + >7 days old.
--     match_players and scores cascade on delete; score_holes hangs off
--     scores, so "no scores row" already implies "no hole data".
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('mulligan_practice_residue_cleanup');
EXCEPTION WHEN OTHERS THEN
  NULL; -- not scheduled yet
END $$;

SELECT cron.schedule(
  'mulligan_practice_residue_cleanup',
  '17 3 * * *',
  $job$
  DELETE FROM public.matches m
  USING public.games g
  WHERE g.id = m.game_id
    AND g.is_practice
    AND m.status = 'scheduled'
    AND m.created_at < now() - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.scores s WHERE s.match_id = m.id)
  $job$
);

-- ---------------------------------------------------------------------------
-- (4) notify_match_completed: practice games finish silently. Body verbatim
--     from prod (2026-08-11 pg_get_functiondef) + the is_practice skip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_match_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_match RECORD;
  v_player RECORD;
BEGIN
  IF OLD.status = 'completed' OR NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT NEW.id AS id, NEW.course_name AS course_name, NEW.game_id AS game_id,
         l.name AS game_name, l.is_practice AS is_practice
  INTO v_match
  FROM games l
  WHERE l.id = NEW.game_id;

  -- Solo practice: finishing your own round must not self-notify (noise)
  -- nor surface the hidden container's name in the notification list.
  IF COALESCE(v_match.is_practice, false) THEN
    RETURN NEW;
  END IF;

  FOR v_player IN
    SELECT mp.user_id
    FROM match_players mp
    WHERE mp.match_id = NEW.id
  LOOP
    PERFORM create_notification(
      v_player.user_id,
      'match_completed',
      'Match completed!',
      'All scores approved for ' || COALESCE(NEW.course_name, 'your match') ||
        CASE WHEN v_match.game_name IS NOT NULL THEN ' in ' || v_match.game_name ELSE '' END,
      jsonb_build_object(
        'match_id', NEW.id,
        'game_id', NEW.game_id,
        'game_name', v_match.game_name
      )
    );
  END LOOP;
  RETURN NEW;
END;
$function$;
