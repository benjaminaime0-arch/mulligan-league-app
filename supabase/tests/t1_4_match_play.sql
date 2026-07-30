-- ============================================================================
-- T D — match play & Ryder: format plumbing, singles state ("3&2"),
--        match-points leaderboard, four-ball team score
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'mp-jack@test.local', '{"first_name":"Jack","username":"jack"}'),
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'mp-karl@test.local', '{"first_name":"Karl","username":"karl"}'),
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'mp-lisa@test.local', '{"first_name":"Lisa","username":"lisa"}'),
  ('00000000-0000-0000-0000-000000000000', 'ffffffff-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'mp-mona@test.local', '{"first_name":"Mona","username":"mona"}');

-- Synthetic 9-hole course: par 4, hcp = hole number (same trick as T C).
DO $$
DECLARE
  v_jack uuid := 'ffffffff-0000-0000-0000-000000000001';
  v_karl uuid := 'ffffffff-0000-0000-0000-000000000002';
  v_lisa uuid := 'ffffffff-0000-0000-0000-000000000003';
  v_mona uuid := 'ffffffff-0000-0000-0000-000000000004';
  v_course uuid;
  v_res json;
  v_st jsonb;
  v_game uuid;
  v_match uuid;
  v_row record;
  i int;
BEGIN
  INSERT INTO courses (name, city, holes, par) VALUES ('TD MP Course', 'Testville', 9, 72)
  RETURNING id INTO v_course;
  FOR i IN 1..9 LOOP
    INSERT INTO course_holes (course_id, hole_number, par, hcp_index) VALUES (v_course, i, 4, i);
  END LOOP;

  -- ---- T1: format plumbing ------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_jack, 'role', 'authenticated')::text, true);

  -- No hole data → refused.
  v_res := create_game('Bad MP', 'Nowhere', 4, current_date, current_date + 27, NULL, NULL, 'match_play', NULL, 'gross', false);
  IF (v_res->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T1 FAIL: match_play accepted without course holes';
  END IF;

  v_res := create_game('Singles MP', 'TD MP Course', 4, current_date, current_date + 27, NULL, NULL, 'match_play', v_course, 'gross', false);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T1 FAIL create_game match_play: %', v_res;
  END IF;
  v_game := (v_res->>'game_id')::uuid;

  -- sync_game_format must PRESERVE match_play, not squash it to stroke_play.
  IF (SELECT format FROM games WHERE id = v_game) <> 'match_play' THEN
    RAISE EXCEPTION 'T1 FAIL: sync_game_format squashed match_play to %',
      (SELECT format FROM games WHERE id = v_game);
  END IF;
  RAISE NOTICE 'T1 PASS: format plumbing (hole-data gate + trigger preserves match_play)';

  -- ---- T2: singles state — Jack wins 5&4 gross ------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_karl, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, course_id, match_date, created_by, status)
  VALUES (v_game, v_course, current_date, v_jack, 'scheduled') RETURNING id INTO v_match;
  -- join order fixes the sides: Jack = side A, Karl = side B
  INSERT INTO match_players (match_id, user_id, joined_at) VALUES (v_match, v_jack, now());
  INSERT INTO match_players (match_id, user_id, joined_at) VALUES (v_match, v_karl, now() + interval '1 second');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_jack, 'role', 'authenticated')::text, true);
  -- Holes 1..5: Jack 3, Karl 5 → Jack wins each. Lead 5 > remaining 4 → 5&4.
  FOR i IN 1..5 LOOP
    PERFORM upsert_score_hole(v_match, v_jack, i, 3);
    PERFORM upsert_score_hole(v_match, v_karl, i, 5);
  END LOOP;

  v_st := match_play_state(v_match);
  IF (v_st->>'available')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T2 FAIL: state unavailable: %', v_st;
  END IF;
  IF (v_st->>'state') <> '5&4' OR (v_st->>'leader')::int <> 1 OR (v_st->>'decided')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T2 FAIL: want Jack 5&4 decided, got %', v_st;
  END IF;
  RAISE NOTICE 'T2 PASS: singles running state 5&4';

  -- ---- T3: match-points leaderboard ----------------------------------------
  UPDATE scores SET status = 'approved' WHERE match_id = v_match;
  PERFORM set_config('mulligan.system_update', 'on', true);
  UPDATE matches SET status = 'completed' WHERE id = v_match;
  PERFORM set_config('mulligan.system_update', '', true);

  SELECT * INTO v_row FROM get_leaderboard(v_game) WHERE user_id = v_jack;
  IF v_row.total_score <> 2 OR v_row."position" <> 1 THEN
    RAISE EXCEPTION 'T3 FAIL: Jack should lead with 2 (win), got total % pos %', v_row.total_score, v_row."position";
  END IF;
  IF v_row.best_score <> 5 THEN
    RAISE EXCEPTION 'T3 FAIL: holes-won tiebreak column % (want 5)', v_row.best_score;
  END IF;
  SELECT * INTO v_row FROM get_leaderboard(v_game) WHERE user_id = v_karl;
  IF v_row.total_score <> 0 THEN
    RAISE EXCEPTION 'T3 FAIL: Karl total % (want 0)', v_row.total_score;
  END IF;
  RAISE NOTICE 'T3 PASS: match points 2/0, holes-won surfaced';

  -- ---- T4: Ryder four-ball — 4 players, 2 matches, team score ---------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_jack, 'role', 'authenticated')::text, true);
  v_res := create_game('Ryder Cup', 'TD MP Course', 8, current_date, current_date + 27, NULL, NULL, 'match_play', v_course, 'gross', true);
  v_game := (v_res->>'game_id')::uuid;

  FOR i IN 2..4 LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', ('ffffffff-0000-0000-0000-00000000000' || i)::uuid, 'role', 'authenticated')::text, true);
    PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));
  END LOOP;

  -- Admin assigns: Jack+Karl = team 1, Lisa+Mona = team 2.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_jack, 'role', 'authenticated')::text, true);
  PERFORM set_member_team(v_game, v_jack, 1);
  PERFORM set_member_team(v_game, v_karl, 1);
  PERFORM set_member_team(v_game, v_lisa, 2);
  PERFORM set_member_team(v_game, v_mona, 2);

  -- Non-admin refused.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_lisa, 'role', 'authenticated')::text, true);
  v_res := set_member_team(v_game, v_lisa, 1);
  IF (v_res->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: non-admin reassigned a team';
  END IF;

  -- Match 1: four-ball, all 4 players. Team snapshot comes from the trigger.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_jack, 'role', 'authenticated')::text, true);
  INSERT INTO matches (game_id, course_id, match_date, created_by, status)
  VALUES (v_game, v_course, current_date, v_jack, 'scheduled') RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES
    (v_match, v_jack), (v_match, v_karl), (v_match, v_lisa), (v_match, v_mona);
  IF (SELECT count(*) FROM match_players WHERE match_id = v_match AND team IS NOT NULL) <> 4 THEN
    RAISE EXCEPTION 'T4 FAIL: team snapshot trigger did not fire';
  END IF;

  -- Best ball: team1's best is Jack (4s); team2's best is Lisa (3s on odd
  -- holes) / Mona (3s on even) → team 2 wins every hole 3 vs 4 → 9&0…
  -- lead 9 after 9, decided at hole 5 (lead 5 > remaining 4) → "5&4".
  FOR i IN 1..9 LOOP
    PERFORM upsert_score_hole(v_match, v_jack, i, 4);
    PERFORM upsert_score_hole(v_match, v_karl, i, 6);
    PERFORM upsert_score_hole(v_match, v_lisa, i, CASE WHEN i % 2 = 1 THEN 3 ELSE 7 END);
    PERFORM upsert_score_hole(v_match, v_mona, i, CASE WHEN i % 2 = 0 THEN 3 ELSE 7 END);
  END LOOP;
  UPDATE scores SET status = 'approved' WHERE match_id = v_match;
  PERFORM set_config('mulligan.system_update', 'on', true);
  UPDATE matches SET status = 'completed' WHERE id = v_match;
  PERFORM set_config('mulligan.system_update', '', true);

  -- Match 2: singles pair inside the Ryder game — Jack beats Lisa.
  INSERT INTO matches (game_id, course_id, match_date, created_by, status)
  VALUES (v_game, v_course, current_date + 1, v_jack, 'scheduled') RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match, v_jack), (v_match, v_lisa);
  FOR i IN 1..9 LOOP
    PERFORM upsert_score_hole(v_match, v_jack, i, 3);
    PERFORM upsert_score_hole(v_match, v_lisa, i, 5);
  END LOOP;
  UPDATE scores SET status = 'approved' WHERE match_id = v_match;
  PERFORM set_config('mulligan.system_update', 'on', true);
  UPDATE matches SET status = 'completed' WHERE id = v_match;
  PERFORM set_config('mulligan.system_update', '', true);

  v_st := get_ryder_score(v_game);
  IF (v_st->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T4 FAIL get_ryder_score: %', v_st;
  END IF;
  IF (v_st->'team1'->>'points')::numeric <> 1 OR (v_st->'team2'->>'points')::numeric <> 1 THEN
    RAISE EXCEPTION 'T4 FAIL: want 1–1 (four-ball to team 2, singles to team 1), got %', v_st;
  END IF;
  IF jsonb_array_length(v_st->'matches') <> 2 THEN
    RAISE EXCEPTION 'T4 FAIL: % matches counted (want 2)', jsonb_array_length(v_st->'matches');
  END IF;
  RAISE NOTICE 'T4 PASS: Ryder four-ball + singles → 1–1, snapshot + admin gate hold';
END $$;

ROLLBACK;
