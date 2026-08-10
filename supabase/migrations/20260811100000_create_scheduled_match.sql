-- ============================================================================
-- create_scheduled_match: atomic match + roster creation, period from date
-- ============================================================================
-- Replaces the client's two sequential PostgREST inserts (matches, then
-- match_players) which could strand a zero-player match if the second call
-- failed, and which pinned period_id to the game's FIRST period by
-- start_date whatever date was picked — permanently wrong, since
-- period_id is immutable after insert (patch_match_immutability).
--
-- Period resolution, in order:
--   1. the period whose [start_date, end_date] contains p_match_date
--   2. else the game's single 'active' period (round played outside any
--      scheduled window — keeps the legacy behaviour of counting it in
--      the running journée rather than refusing)
--   3. else error — better no match than one pinned to the wrong week.
--
-- Modeled on create_practice_match: SECURITY DEFINER, json result with
-- success/error, GRANT authenticated / REVOKE PUBLIC+anon
-- (per 20260731090000 grant conventions).
--
-- Safe to re-run: CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_scheduled_match(
  p_game_id uuid,
  p_match_date date,
  p_player_ids uuid[],
  p_match_time time DEFAULT NULL,
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
  v_game record;
  v_period_id uuid;
  v_match_id uuid;
  v_course_name text;
  v_players uuid[];
  v_member_count int;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT id, status, is_practice, format, team_mode, course_name
    INTO v_game
    FROM games WHERE id = p_game_id;

  -- Practice containers answer as nonexistent, same as the join RPCs:
  -- no oracle that the hidden game exists.
  IF v_game.id IS NULL OR v_game.is_practice THEN
    RETURN json_build_object('success', false, 'error', 'Game not found');
  END IF;
  IF v_game.status = 'completed' THEN
    RETURN json_build_object('success', false, 'error', 'Game is completed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM game_members WHERE game_id = p_game_id AND user_id = v_caller
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Not a member of this game');
  END IF;

  IF p_match_date IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Missing match date');
  END IF;

  -- Roster: dedupe, then validate against membership. 2..4 players
  -- (solo rounds are create_practice_match's job); singles match play
  -- is strictly 1v1, mirroring the client rule server-side.
  SELECT ARRAY(SELECT DISTINCT unnest(p_player_ids)) INTO v_players;
  IF v_players IS NULL OR array_length(v_players, 1) IS NULL
     OR array_length(v_players, 1) < 2 THEN
    RETURN json_build_object('success', false, 'error', 'At least 2 players required');
  END IF;
  IF array_length(v_players, 1) > 4 THEN
    RETURN json_build_object('success', false, 'error', 'At most 4 players');
  END IF;
  IF v_game.format = 'match_play' AND COALESCE(v_game.team_mode, false) IS FALSE
     AND array_length(v_players, 1) <> 2 THEN
    RETURN json_build_object('success', false, 'error', 'Singles match play is 1v1');
  END IF;

  SELECT count(*) INTO v_member_count
    FROM game_members
   WHERE game_id = p_game_id AND user_id = ANY(v_players);
  IF v_member_count <> array_length(v_players, 1) THEN
    RETURN json_build_object('success', false, 'error', 'All players must be game members');
  END IF;

  -- Period from the DATE the user picked, not position in the season.
  SELECT id INTO v_period_id
    FROM game_periods
   WHERE game_id = p_game_id
     AND p_match_date BETWEEN start_date AND end_date
   ORDER BY start_date
   LIMIT 1;
  IF v_period_id IS NULL THEN
    SELECT id INTO v_period_id
      FROM game_periods
     WHERE game_id = p_game_id AND status = 'active'
     ORDER BY start_date
     LIMIT 1;
  END IF;
  IF v_period_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No period covers this date');
  END IF;

  SELECT COALESCE(
    NULLIF(trim(p_course_name), ''),
    (SELECT name FROM courses WHERE id = p_course_id),
    v_game.course_name
  ) INTO v_course_name;
  IF v_course_name IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Missing course name');
  END IF;

  -- One transaction: the roster can never be stranded off the match.
  INSERT INTO matches (
    game_id, period_id, course_name, course_id,
    match_date, match_time, created_by, status
  )
  VALUES (
    p_game_id, v_period_id, v_course_name, p_course_id,
    p_match_date, p_match_time, v_caller, 'scheduled'
  )
  RETURNING id INTO v_match_id;

  INSERT INTO match_players (match_id, user_id)
  SELECT v_match_id, unnest(v_players);

  RETURN json_build_object(
    'success', true,
    'match_id', v_match_id,
    'period_id', v_period_id
  );
EXCEPTION WHEN foreign_key_violation THEN
  RETURN json_build_object('success', false, 'error', 'Unknown course');
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_scheduled_match(uuid, date, uuid[], time, uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_scheduled_match(uuid, date, uuid[], time, uuid, text) FROM PUBLIC, anon;
