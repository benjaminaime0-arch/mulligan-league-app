-- ============================================================================
-- Close the authorization holes (T0.3 — AUD#1, #2, #3, #5, #10)
-- ============================================================================
-- The client (public anon key, shipped in every browser) could until now:
--   #1  approve its own scores:   .from("scores").update({status:'approved'})
--   #2  dump every user's email:  GET /rest/v1/profiles?select=email  (anon!)
--   #3  read any player's private stats via SECURITY DEFINER profile RPCs
--       that take an arbitrary p_user_id with no caller check
--   #5  self-add to any match:    .from("match_players").insert({...})
--   #10 exceed the 4-player cap via COUNT-then-INSERT races
--
-- Strategy notes:
--   * Scores/profiles use COLUMN-LEVEL privileges: PostgREST requests naming
--     a revoked column fail with 42501 while the SECURITY DEFINER RPCs (owner
--     privileges) keep working untouched. RLS policies still gate rows;
--     grants now gate columns.
--   * The one legitimate cross-user consumer (players/[id]) keeps working:
--     the profile RPCs are gated on "caller shares a game with the target
--     (or is the target)", not caller==target.
--   * match_players INSERT tightens to "the match creator, adding members of
--     the match's game" — the exact shape matches/create uses. Everyone else
--     goes through request_join_match/approve_join_request.
--
-- Safe to re-run: REVOKE/GRANT idempotent, policies drop-then-create,
-- functions CREATE OR REPLACE, orphan drops IF EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. AUD#1 — scores: clients may only ever write score/holes
-- ----------------------------------------------------------------------------
-- INSERT: status is not grantable → takes its DEFAULT 'pending'; approved_by/
-- approved_at unreachable. UPDATE: only score/holes; the reset trigger and
-- the approve RPC own every status transition.
REVOKE INSERT, UPDATE ON public.scores FROM anon, authenticated;
GRANT INSERT (match_id, user_id, score, holes) ON public.scores TO authenticated;
GRANT UPDATE (score, holes) ON public.scores TO authenticated;

-- The edited row itself must also lose its approval — previously only OTHER
-- rows were reset, so an approved score could be silently rewritten while
-- keeping its approved status (AUD#1, second half).
CREATE OR REPLACE FUNCTION public.reset_approvals_on_score_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reset every approved score in the match INCLUDING the edited row:
  -- an edit invalidates the peers' sign-off on the whole card set.
  UPDATE scores
  SET status = 'pending', approved_by = NULL, approved_at = NULL
  WHERE match_id = NEW.match_id AND status = 'approved';

  UPDATE match_players SET approved_at = NULL WHERE match_id = NEW.match_id;

  UPDATE matches SET status = 'in_progress'
  WHERE id = NEW.match_id AND status = 'completed';

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. AUD#2 — profiles: authenticated-only, email unreadable, anon fully out
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
CREATE POLICY profiles_select_authenticated ON public.profiles
  FOR SELECT TO authenticated USING (true);

-- Column privileges: email is reachable only by SECURITY DEFINER functions
-- and the service role. Client UPDATE is limited to the editable identity
-- fields (email is synced from auth.users by trigger, never client-written).
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, first_name, last_name, club, handicap, avatar_url, created_at, town, username)
  ON public.profiles TO authenticated;
GRANT UPDATE (first_name, last_name, club, handicap, avatar_url, town, username)
  ON public.profiles TO authenticated;

-- The blanket anon grant from grant_service_role_public_access.sql meant any
-- future table without RLS was anon-writable, and profiles was anon-dumpable.
-- The app has no unauthenticated database surface (the newsletter edge
-- function uses the service role; the OG share route uses the service role).
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM anon;

-- ----------------------------------------------------------------------------
-- 3. AUD#3 — profile RPCs: gate on shared-game visibility; drop orphans
-- ----------------------------------------------------------------------------
-- Visibility rule for player pages: you can see a player's stats iff you
-- share at least one game with them (or they are you). SECURITY DEFINER +
-- STABLE like the existing is_game_member/user_can_see_match helpers.
CREATE OR REPLACE FUNCTION public.shares_game_with(p_other uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p_other = auth.uid() OR EXISTS (
    SELECT 1
    FROM game_members a
    JOIN game_members b ON b.game_id = a.game_id
    WHERE a.user_id = auth.uid() AND b.user_id = p_other
  );
$$;
GRANT EXECUTE ON FUNCTION public.shares_game_with(uuid) TO authenticated;

-- Orphaned SECURITY DEFINER surface with zero client callers — pure leak.
DROP FUNCTION IF EXISTS public.get_activity_feed(uuid, integer);
DROP FUNCTION IF EXISTS public.get_user_match_on_date(uuid, date);
DROP FUNCTION IF EXISTS public.get_player_round_history(uuid);

-- get_profile_records: body verbatim from prod + the caller gate.
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

  -- Best round: lowest approved score
  SELECT s.score, s.holes, s.match_id,
         COALESCE(m.course_name, l.course_name) AS course_name,
         m.match_date
  INTO v_best_score
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  LEFT JOIN games l ON l.id = m.game_id
  WHERE s.user_id = p_user_id AND s.status = 'approved'
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
  -- the user has at least one match with a score.
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

-- get_profile_courses: body verbatim from prod + the caller gate.
CREATE OR REPLACE FUNCTION public.get_profile_courses(p_user_id uuid)
 RETURNS TABLE(course_name text, times_played bigint, best_score integer, last_played_date date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Caller gate (AUD#3): stats are visible to game-mates only.
  IF NOT shares_game_with(p_user_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(m.course_name, l.course_name, 'Unknown course')::TEXT AS course_name,
    COUNT(DISTINCT m.id) AS times_played,
    MIN(s.score) FILTER (WHERE s.status = 'approved')::INT AS best_score,
    MAX(m.match_date) AS last_played_date
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  LEFT JOIN games l ON l.id = m.game_id
  LEFT JOIN scores s ON s.match_id = m.id AND s.user_id = mp.user_id
  WHERE mp.user_id = p_user_id
  GROUP BY COALESCE(m.course_name, l.course_name, 'Unknown course')
  ORDER BY times_played DESC, MAX(m.match_date) DESC NULLS LAST;
END;
$function$;

-- get_profile_score_trend: body verbatim from prod + the caller gate.
CREATE OR REPLACE FUNCTION public.get_profile_score_trend(p_user_id uuid, p_range text DEFAULT 'recent'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_points JSONB;
  v_count INT;
  v_recent_avg NUMERIC;
  v_previous_avg NUMERIC;
  v_days INT;
  v_start_date DATE;
  v_prior_start DATE;
BEGIN
  -- Caller gate (AUD#3): stats are visible to game-mates only.
  IF NOT shares_game_with(p_user_id) THEN
    RETURN jsonb_build_object(
      'range', p_range, 'points', '[]'::jsonb, 'total_rounds', 0,
      'recent_avg', NULL, 'previous_avg', NULL, 'change', NULL
    );
  END IF;

  IF p_range IN ('week', 'month', 'year') THEN
    v_days := CASE p_range
      WHEN 'week'  THEN 7
      WHEN 'month' THEN 30
      WHEN 'year'  THEN 365
    END;
    v_start_date := (current_date - (v_days || ' days')::interval)::date;
    v_prior_start := (v_start_date - (v_days || ' days')::interval)::date;

    -- ORDER BY adds match_id as a tiebreaker so rows with the same
    -- match_date always plot in a stable order across calls.
    SELECT jsonb_agg(
             jsonb_build_object(
               'score', sub.score,
               'date',  sub.match_date,
               'match_id', sub.match_id
             ) ORDER BY sub.match_date ASC, sub.match_id ASC
           ),
           COUNT(*)
    INTO v_points, v_count
    FROM (
      SELECT s.score, m.match_date, s.match_id
      FROM scores s
      JOIN matches m ON m.id = s.match_id
      WHERE s.user_id = p_user_id
        AND s.status = 'approved'
        AND s.holes = 18
        AND m.match_date IS NOT NULL
        AND m.match_date >= v_start_date
    ) sub;

    SELECT AVG(s.score) INTO v_recent_avg
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND s.holes = 18
      AND m.match_date >= v_start_date;

    SELECT AVG(s.score) INTO v_previous_avg
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND s.holes = 18
      AND m.match_date >= v_prior_start
      AND m.match_date < v_start_date;
  ELSE
    -- 'recent' (default): last 20 approved 18-hole rounds
    SELECT jsonb_agg(
             jsonb_build_object(
               'score', sub.score,
               'date',  sub.match_date,
               'match_id', sub.match_id
             ) ORDER BY sub.match_date ASC
           ),
           COUNT(*)
    INTO v_points, v_count
    FROM (
      SELECT s.score, m.match_date, s.match_id
      FROM scores s
      JOIN matches m ON m.id = s.match_id
      WHERE s.user_id = p_user_id
        AND s.status = 'approved'
        AND s.holes = 18
        AND m.match_date IS NOT NULL
      ORDER BY m.match_date DESC, s.created_at DESC
      LIMIT 20
    ) sub;

    SELECT AVG(score) INTO v_recent_avg
    FROM (
      SELECT s.score
      FROM scores s
      JOIN matches m ON m.id = s.match_id
      WHERE s.user_id = p_user_id
        AND s.status = 'approved'
        AND s.holes = 18
        AND m.match_date IS NOT NULL
      ORDER BY m.match_date DESC, s.created_at DESC
      LIMIT 10
    ) last10;

    SELECT AVG(score) INTO v_previous_avg
    FROM (
      SELECT s.score
      FROM scores s
      JOIN matches m ON m.id = s.match_id
      WHERE s.user_id = p_user_id
        AND s.status = 'approved'
        AND s.holes = 18
        AND m.match_date IS NOT NULL
      ORDER BY m.match_date DESC, s.created_at DESC
      OFFSET 10 LIMIT 10
    ) prior10;
  END IF;

  RETURN jsonb_build_object(
    'range', p_range,
    'points', COALESCE(v_points, '[]'::jsonb),
    'total_rounds', v_count,
    'recent_avg', CASE WHEN v_recent_avg IS NULL THEN NULL ELSE ROUND(v_recent_avg, 1) END,
    'previous_avg', CASE WHEN v_previous_avg IS NULL THEN NULL ELSE ROUND(v_previous_avg, 1) END,
    'change', CASE
      WHEN v_recent_avg IS NULL OR v_previous_avg IS NULL THEN NULL
      ELSE ROUND(v_recent_avg - v_previous_avg, 1)
    END
  );
END;
$function$;

-- ----------------------------------------------------------------------------
-- 4. AUD#5 — match_players: only the match creator inserts; game-members only
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS match_players_insert_member ON public.match_players;
DROP POLICY IF EXISTS match_players_insert_creator ON public.match_players;
CREATE POLICY match_players_insert_creator ON public.match_players
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM matches m
      WHERE m.id = match_players.match_id AND m.created_by = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM matches m
      JOIN game_members gm ON gm.game_id = m.game_id
      WHERE m.id = match_players.match_id AND gm.user_id = match_players.user_id
    )
  );
-- Everyone else joins via request_join_match → approve_join_request
-- (SECURITY DEFINER, unaffected by the policy).

-- ----------------------------------------------------------------------------
-- 5. AUD#10 — the 4-player cap actually holds under concurrency
-- ----------------------------------------------------------------------------
-- Row-lock the parent match before counting: concurrent inserts serialize on
-- the lock instead of both reading 3. SECURITY DEFINER so the count is not
-- RLS-filtered by the inserting caller's visibility.
CREATE OR REPLACE FUNCTION public.check_match_player_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count integer;
BEGIN
  PERFORM 1 FROM public.matches WHERE id = NEW.match_id FOR UPDATE;

  SELECT COUNT(*) INTO v_count
  FROM public.match_players
  WHERE match_id = NEW.match_id;

  IF v_count >= 4 THEN
    RAISE EXCEPTION 'Match is full (maximum 4 players)';
  END IF;

  RETURN NEW;
END;
$fn$;

-- approve_join_request: body verbatim from prod + FOR UPDATE locks before
-- each capacity count (the trigger above is the backstop; the lock here
-- keeps the graceful 'now full' JSON error instead of an exception).
CREATE OR REPLACE FUNCTION public.approve_join_request(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_id UUID := auth.uid();
  v_req_status TEXT;
  v_req_admin UUID;
  v_req_type TEXT;
  v_req_target UUID;
  v_req_requester UUID;
  v_player_count INT;
  v_member_count INT;
  v_target_name TEXT;
  v_match_game_id UUID;
  v_match_course TEXT;
  v_match_date DATE;
  v_game_name TEXT;
  v_game_max INT;
BEGIN
  SELECT status, admin_id, target_type, target_id, requester_id
  INTO v_req_status, v_req_admin, v_req_type, v_req_target, v_req_requester
  FROM join_requests WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_req_admin != v_admin_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_req_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request already ' || v_req_status);
  END IF;

  IF v_req_type = 'match' THEN
    -- Serialize concurrent approvals/joins on the match row (AUD#10)
    PERFORM 1 FROM matches WHERE id = v_req_target FOR UPDATE;

    SELECT COUNT(*) INTO v_player_count FROM match_players WHERE match_id = v_req_target;
    IF v_player_count >= 4 THEN
      UPDATE join_requests SET status = 'rejected', resolved_at = now(), resolved_by = v_admin_id
        WHERE id = p_request_id;
      RETURN jsonb_build_object('success', false, 'error', 'Match is now full');
    END IF;

    SELECT game_id, course_name, match_date
    INTO v_match_game_id, v_match_course, v_match_date
    FROM matches WHERE id = v_req_target;

    IF v_match_game_id IS NOT NULL THEN
      INSERT INTO game_members (game_id, user_id) VALUES (v_match_game_id, v_req_requester)
      ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO match_players (match_id, user_id) VALUES (v_req_target, v_req_requester)
    ON CONFLICT DO NOTHING;

    v_target_name := COALESCE(v_match_course, 'the match');

    PERFORM create_notification(
      v_req_requester,
      'join_approved',
      'You''re in! Match request approved',
      v_target_name || ' · ' || COALESCE(to_char(v_match_date, 'Mon DD'), 'Date TBA'),
      jsonb_build_object('match_id', v_req_target)
    );

  ELSIF v_req_type = 'game' THEN
    -- Serialize concurrent approvals on the game row (AUD#10)
    PERFORM 1 FROM games WHERE id = v_req_target FOR UPDATE;

    SELECT name, max_players INTO v_game_name, v_game_max
    FROM games WHERE id = v_req_target;
    SELECT COUNT(*) INTO v_member_count FROM game_members WHERE game_id = v_req_target;

    IF v_game_max IS NOT NULL AND v_member_count >= v_game_max THEN
      UPDATE join_requests SET status = 'rejected', resolved_at = now(), resolved_by = v_admin_id
        WHERE id = p_request_id;
      RETURN jsonb_build_object('success', false, 'error', 'Game is now full');
    END IF;

    INSERT INTO game_members (game_id, user_id) VALUES (v_req_target, v_req_requester)
    ON CONFLICT DO NOTHING;

    v_target_name := COALESCE(v_game_name, 'the game');

    PERFORM create_notification(
      v_req_requester,
      'join_approved',
      'Welcome! You''ve been accepted to ' || v_target_name,
      'You can now view the leaderboard and join matches.',
      jsonb_build_object('game_id', v_req_target)
    );
  END IF;

  UPDATE join_requests SET status = 'approved', resolved_at = now(), resolved_by = v_admin_id
    WHERE id = p_request_id;

  -- Mark admin's own pending join_request notification(s) for this request as read.
  -- This fixes the bug where another admin (or the same admin on a different device)
  -- would still see an unread notification after the request is already resolved.
  UPDATE notifications
    SET read_at = COALESCE(read_at, now())
    WHERE type = 'join_request'
      AND data->>'request_id' = p_request_id::text;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ============================================================================
-- VERIFICATION (read-only)
-- ============================================================================
-- 1. Column grants on scores/profiles for authenticated:
--    SELECT table_name, column_name, privilege_type
--    FROM information_schema.column_privileges
--    WHERE grantee = 'authenticated' AND table_name IN ('scores','profiles')
--    ORDER BY 1, 3, 2;
--    -- expect: scores INSERT{match_id,user_id,score,holes} UPDATE{score,holes};
--    --         profiles SELECT{9 cols, NO email} UPDATE{7 cols, NO email/id}
--
-- 2. anon has no table DML left:
--    SELECT count(*) FROM information_schema.role_table_grants
--    WHERE grantee = 'anon' AND table_schema = 'public'
--      AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE');
--    -- expect 0
--
-- 3. Orphan RPCs gone:
--    SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND proname IN
--      ('get_activity_feed','get_user_match_on_date','get_player_round_history');
--    -- expect 0 rows
--
-- 4. The regression suite: supabase/tests/t0_3_authorization.sql (CI).
-- ============================================================================
