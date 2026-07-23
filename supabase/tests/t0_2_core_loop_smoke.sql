-- ============================================================================
-- T0.2 core-loop smoke test — create game → join → match → scores → approve
--                              → leaderboard
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Exercises the five core RPCs end-to-end through the REAL auth path:
-- request.jwt.claims is set the way PostgREST sets it, so auth.uid() inside
-- every SECURITY DEFINER function resolves to the impersonated user.
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'smoke-alice@test.local', '{"first_name":"Alice","username":"alice"}'),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'smoke-bob@test.local',   '{"first_name":"Bob","username":"bob"}');

DO $$
DECLARE
  v_alice uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_bob   uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_res        json;
  v_game_id    uuid;
  v_code       text;
  v_match_id   uuid;
  v_rows       int;
BEGIN
  -- profiles created by the on_auth_user_created trigger
  IF (SELECT count(*) FROM profiles WHERE id IN (v_alice, v_bob)) <> 2 THEN
    RAISE EXCEPTION 'SMOKE FAIL: handle_new_user did not create profiles';
  END IF;

  -- ---- Alice creates a game --------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);

  v_res := create_game('Smoke Game', 'Smoke Course', 4, current_date, current_date + 27, 3, 5);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'SMOKE FAIL create_game: %', v_res;
  END IF;
  v_game_id := (v_res->>'game_id')::uuid;
  v_code    := v_res->>'invite_code';

  IF (SELECT count(*) FROM game_members WHERE game_id = v_game_id) <> 1 THEN
    RAISE EXCEPTION 'SMOKE FAIL: admin not auto-added exactly once';
  END IF;

  -- ---- Bob joins by invite code ----------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);

  v_res := join_game_by_code(v_code);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'SMOKE FAIL join_game_by_code: %', v_res;
  END IF;

  -- ---- Alice generates periods ------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);

  v_res := generate_game_periods(v_game_id);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'SMOKE FAIL generate_game_periods: %', v_res;
  END IF;

  -- ---- Alice schedules a match with both players ------------------------------
  INSERT INTO matches (game_id, created_by, course_name, match_date)
  VALUES (v_game_id, v_alice, 'Smoke Course', current_date)
  RETURNING id INTO v_match_id;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match_id, v_alice), (v_match_id, v_bob);

  -- ---- Alice submits both scores ----------------------------------------------
  v_res := submit_match_scores(v_match_id, json_build_array(
    json_build_object('user_id', v_alice, 'score', 85, 'holes', 18),
    json_build_object('user_id', v_bob,   'score', 92, 'holes', 18)
  ));
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'SMOKE FAIL submit_match_scores: %', v_res;
  END IF;

  -- ---- Bob approves — all players in, scores finalize, match completes --------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);

  v_res := approve_match_scores(v_match_id);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'SMOKE FAIL approve_match_scores: %', v_res;
  END IF;

  IF (SELECT count(*) FROM scores WHERE match_id = v_match_id AND status = 'approved') <> 2 THEN
    RAISE EXCEPTION 'SMOKE FAIL: scores not approved after full approval';
  END IF;
  IF (SELECT status FROM matches WHERE id = v_match_id) <> 'completed' THEN
    RAISE EXCEPTION 'SMOKE FAIL: match not completed after full approval';
  END IF;

  -- ---- Leaderboard (member-gated, format-aware) -------------------------------
  SELECT count(*) INTO v_rows FROM get_leaderboard(v_game_id);
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'SMOKE FAIL: get_leaderboard returned % rows, expected 2', v_rows;
  END IF;
  IF (SELECT lb.user_id FROM get_leaderboard(v_game_id) lb WHERE lb."position" = 1) <> v_alice THEN
    RAISE EXCEPTION 'SMOKE FAIL: leaderboard leader should be the lower stroke-play score';
  END IF;

  -- ---- search_players ----------------------------------------------------------
  IF (SELECT count(*) FROM search_players('alice')) < 1 THEN
    RAISE EXCEPTION 'SMOKE FAIL: search_players found nothing for alice';
  END IF;

  RAISE NOTICE 'SMOKE PASS: create game -> join -> periods -> match -> submit -> approve -> leaderboard';
END;
$$;

ROLLBACK;
