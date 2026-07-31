-- ============================================================================
-- T G — recap, Indice Mulligan (Elo), rivalries
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'adadadad-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'soc-sara@test.local', '{"first_name":"Sara","username":"sara"}'),
  ('00000000-0000-0000-0000-000000000000', 'adadadad-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'soc-theo@test.local', '{"first_name":"theo","username":"theo"}'),
  ('00000000-0000-0000-0000-000000000000', 'adadadad-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'soc-vera@test.local', '{"first_name":"Vera","username":"vera"}');

-- Fixture helper: a completed 2-player match with approved scores. Lives in
-- pg_temp so it vanishes with the rollback (PL/pgSQL has no local functions).
CREATE FUNCTION pg_temp.make_match(p_game uuid, p_date date, p_sara int, p_theo int)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE p_match uuid;
BEGIN
  INSERT INTO matches (game_id, course_name, match_date, created_by, status)
  VALUES (p_game, 'Anywhere', p_date, 'adadadad-0000-0000-0000-000000000001', 'scheduled')
  RETURNING id INTO p_match;
  INSERT INTO match_players (match_id, user_id) VALUES
    (p_match, 'adadadad-0000-0000-0000-000000000001'),
    (p_match, 'adadadad-0000-0000-0000-000000000002');
  INSERT INTO scores (match_id, user_id, score, holes, status, submitted_by) VALUES
    (p_match, 'adadadad-0000-0000-0000-000000000001', p_sara, 18, 'approved', 'adadadad-0000-0000-0000-000000000001'),
    (p_match, 'adadadad-0000-0000-0000-000000000002', p_theo, 18, 'approved', 'adadadad-0000-0000-0000-000000000001');
  PERFORM set_config('mulligan.system_update', 'on', true);
  UPDATE matches SET status = 'completed' WHERE id = p_match;
  PERFORM set_config('mulligan.system_update', '', true);
  RETURN p_match;
END;
$fn$;

DO $$
DECLARE
  v_sara uuid := 'adadadad-0000-0000-0000-000000000001';
  v_theo uuid := 'adadadad-0000-0000-0000-000000000002';
  v_vera uuid := 'adadadad-0000-0000-0000-000000000003';  -- outsider
  v_res json;
  v_game uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid;
  v_r numeric;
  v_n int;
  v_h jsonb;
  v_recap jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_sara, 'role', 'authenticated')::text, true);
  v_res := create_game('Social Game', 'Anywhere', 4, current_date - 30, current_date - 2, 3, 5);
  v_game := (v_res->>'game_id')::uuid;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_theo, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_sara, 'role', 'authenticated')::text, true);

  -- ---- T1: Elo — two fresh 1000s, K=32: winner +16, loser −16 ---------------
  v_m1 := pg_temp.make_match(v_game, current_date - 20, 80, 90);  -- Sara wins (net = gross)

  SELECT rating INTO v_r FROM player_ratings WHERE user_id = v_sara;
  IF v_r <> 1016 THEN RAISE EXCEPTION 'T1 FAIL: Sara rating % (want 1016)', v_r; END IF;
  SELECT rating INTO v_r FROM player_ratings WHERE user_id = v_theo;
  IF v_r <> 984 THEN RAISE EXCEPTION 'T1 FAIL: Theo rating % (want 984)', v_r; END IF;

  -- Idempotent: re-rating the same match moves nothing.
  IF rate_match(v_m1) <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: rate_match re-rated an already-rated match';
  END IF;
  SELECT rating INTO v_r FROM player_ratings WHERE user_id = v_sara;
  IF v_r <> 1016 THEN RAISE EXCEPTION 'T1 FAIL: idempotency broke rating (%)', v_r; END IF;
  RAISE NOTICE 'T1 PASS: Elo +16/−16 on first result, idempotent';

  -- ---- T2: more history — favorite winning gains less than 16 ---------------
  v_m2 := pg_temp.make_match(v_game, current_date - 15, 78, 92);  -- Sara wins again
  SELECT rating INTO v_r FROM player_ratings WHERE user_id = v_sara;
  IF NOT (v_r > 1016 AND v_r < 1032) THEN
    RAISE EXCEPTION 'T2 FAIL: favorite gained a full K (% after 2 wins)', v_r;
  END IF;
  SELECT count(*) INTO v_n FROM rating_history WHERE user_id = v_sara;
  IF v_n <> 2 THEN RAISE EXCEPTION 'T2 FAIL: % history rows (want 2)', v_n; END IF;
  RAISE NOTICE 'T2 PASS: expected-score damping + history journal';

  -- ---- T3: head-to-head — record, streak, last5 -----------------------------
  v_m3 := pg_temp.make_match(v_game, current_date - 10, 95, 85);  -- Theo takes one back

  v_h := get_head_to_head(v_sara, v_theo);
  IF (v_h->>'matches')::int <> 3 OR (v_h->>'a_wins')::int <> 2 OR (v_h->>'b_wins')::int <> 1 THEN
    RAISE EXCEPTION 'T3 FAIL: record %', v_h;
  END IF;
  IF (v_h->>'streak_len')::int <> 1 OR (v_h->>'streak_who') <> 'b' THEN
    RAISE EXCEPTION 'T3 FAIL: streak % / %', v_h->>'streak_len', v_h->>'streak_who';
  END IF;
  IF jsonb_array_length(v_h->'last5') <> 3 THEN
    RAISE EXCEPTION 'T3 FAIL: last5 %', v_h->'last5';
  END IF;

  -- Outsider gated.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_vera, 'role', 'authenticated')::text, true);
  v_h := get_head_to_head(v_sara, v_theo);
  IF (v_h->>'visible')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T3 FAIL: outsider sees head-to-head';
  END IF;
  RAISE NOTICE 'T3 PASS: head-to-head record, streak, gate';

  -- ---- T4: recap — refused while active, rich once completed ----------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_sara, 'role', 'authenticated')::text, true);
  v_recap := get_game_recap(v_game);
  IF (v_recap->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: recap served for a non-completed game';
  END IF;

  UPDATE games SET status = 'completed' WHERE id = v_game;
  v_recap := get_game_recap(v_game);
  IF (v_recap->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: recap refused for completed game: %', v_recap;
  END IF;
  IF jsonb_array_length(v_recap->'podium') < 2 THEN
    RAISE EXCEPTION 'T4 FAIL: podium %', v_recap->'podium';
  END IF;
  IF (v_recap->'attendance'->>'rounds')::int <> 3 THEN
    RAISE EXCEPTION 'T4 FAIL: attendance %', v_recap->'attendance';
  END IF;
  IF (v_recap->'biggest_win'->>'margin')::int <> 14 THEN
    RAISE EXCEPTION 'T4 FAIL: biggest win margin % (want 14: 78 vs 92)',
      v_recap->'biggest_win'->>'margin';
  END IF;
  IF jsonb_array_length(v_recap->'head_to_head') <> 2 THEN
    RAISE EXCEPTION 'T4 FAIL: h2h grid %', v_recap->'head_to_head';
  END IF;
  RAISE NOTICE 'T4 PASS: recap gate + podium/attendance/margin/h2h grid';
END $$;

ROLLBACK;
