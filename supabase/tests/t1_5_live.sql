-- ============================================================================
-- T E — live scoring: realtime publication populated, match_live fires once
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- T1: the publication actually carries the app's tables (the pre-existing
--     bug was an EMPTY supabase_realtime — every subscription silently dead)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['scores', 'matches', 'score_holes', 'match_players']) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'T1 FAIL: missing from supabase_realtime: %', v_missing;
  END IF;
  RAISE NOTICE 'T1 PASS: realtime publication carries scores/matches/score_holes/match_players';
END $$;

-- ---------------------------------------------------------------------------
-- T2: match_live — exactly one ping per match, to the others, on first hole
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'abababab-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'live-nina@test.local', '{"first_name":"Nina","username":"nina"}'),
  ('00000000-0000-0000-0000-000000000000', 'abababab-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'live-omar@test.local', '{"first_name":"Omar","username":"omar"}');

DO $$
DECLARE
  v_nina uuid := 'abababab-0000-0000-0000-000000000001';
  v_omar uuid := 'abababab-0000-0000-0000-000000000002';
  v_res json;
  v_game uuid;
  v_match uuid;
  v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_nina, 'role', 'authenticated')::text, true);
  v_res := create_game('Live Game', 'Anywhere', 4, current_date, current_date + 27, 3, 5);
  v_game := (v_res->>'game_id')::uuid;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_omar, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, course_name, match_date, created_by, status)
  VALUES (v_game, 'Anywhere', current_date, v_nina, 'scheduled') RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match, v_nina), (v_match, v_omar);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_nina, 'role', 'authenticated')::text, true);
  PERFORM upsert_score_hole(v_match, v_nina, 1, 5);

  SELECT count(*) INTO v_n FROM notifications
  WHERE type = 'match_live' AND user_id = v_omar
    AND (data->>'match_id')::uuid = v_match;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'T2 FAIL: Omar should have exactly 1 match_live ping (got %)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM notifications
  WHERE type = 'match_live' AND user_id = v_nina;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'T2 FAIL: the writer pinged themselves (%)', v_n;
  END IF;

  -- Second hole, second player, edits — never a second ping.
  PERFORM upsert_score_hole(v_match, v_nina, 2, 4);
  PERFORM upsert_score_hole(v_match, v_omar, 1, 6);
  PERFORM upsert_score_hole(v_match, v_nina, 1, 4);
  SELECT count(*) INTO v_n FROM notifications
  WHERE type = 'match_live' AND (data->>'match_id')::uuid = v_match;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'T2 FAIL: match_live fired again (total %)', v_n;
  END IF;
  RAISE NOTICE 'T2 PASS: match_live fires once, to the others only';
END $$;

ROLLBACK;
