-- ============================================================================
-- T C — net scoring: stroke allocation, handicap snapshot, basis-aware
--        leaderboard (net tie, gross unchanged, stableford_net points)
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'net-hugo@test.local', '{"first_name":"Hugo","username":"hugo"}'),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'net-iris@test.local', '{"first_name":"Iris","username":"iris"}');

-- ---------------------------------------------------------------------------
-- T1: stroke allocation — published indexes, remainder, >18, zero
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_course uuid;
  v_sum int;
  v_n int;
  v_bad int;
BEGIN
  -- A course whose 18 published hcp indexes are complete and distinct.
  SELECT ch.course_id INTO v_course
  FROM course_holes ch
  GROUP BY ch.course_id
  HAVING count(*) = 18
     AND count(ch.hcp_index) = 18
     AND count(DISTINCT ch.hcp_index) = 18
  ORDER BY ch.course_id LIMIT 1;
  IF v_course IS NULL THEN
    RAISE EXCEPTION 'T1 FAIL: no fully-indexed 18-hole course in seed';
  END IF;

  SELECT sum(strokes_received) INTO v_sum FROM allocate_strokes(v_course, 5);
  IF v_sum <> 5 THEN RAISE EXCEPTION 'T1 FAIL: php=5 allocated % strokes', v_sum; END IF;
  -- ...and they sit exactly on the 5 hardest holes (hcp_index 1..5).
  SELECT count(*) INTO v_bad
  FROM allocate_strokes(v_course, 5) al
  JOIN course_holes ch ON ch.course_id = v_course AND ch.hole_number = al.hole_number
  WHERE (al.strokes_received = 1) <> (ch.hcp_index <= 5);
  IF v_bad <> 0 THEN RAISE EXCEPTION 'T1 FAIL: php=5 strokes not on hcp 1..5'; END IF;

  SELECT sum(strokes_received) INTO v_sum FROM allocate_strokes(v_course, 20);
  IF v_sum <> 20 THEN RAISE EXCEPTION 'T1 FAIL: php=20 allocated % strokes', v_sum; END IF;
  SELECT count(*) INTO v_n FROM allocate_strokes(v_course, 20) WHERE strokes_received = 2;
  IF v_n <> 2 THEN RAISE EXCEPTION 'T1 FAIL: php=20 should double-stroke exactly 2 holes (got %)', v_n; END IF;

  SELECT sum(strokes_received) INTO v_sum FROM allocate_strokes(v_course, 0);
  IF v_sum <> 0 THEN RAISE EXCEPTION 'T1 FAIL: php=0 allocated %', v_sum; END IF;
  SELECT sum(strokes_received) INTO v_sum FROM allocate_strokes(v_course, NULL);
  IF v_sum <> 0 THEN RAISE EXCEPTION 'T1 FAIL: php=NULL allocated %', v_sum; END IF;
  RAISE NOTICE 'T1 PASS: allocation (exact holes, remainder, zero, null)';
END $$;

-- ---------------------------------------------------------------------------
-- T2: NULL-hcp fallback is par-desc deterministic
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_course uuid;
  v_bad int;
BEGIN
  -- A seeded course whose hcp indexes were nulled (duplicate-HCP rule).
  SELECT ch.course_id INTO v_course
  FROM course_holes ch
  GROUP BY ch.course_id
  HAVING count(*) = 18 AND count(ch.hcp_index) = 0
  ORDER BY ch.course_id LIMIT 1;
  IF v_course IS NULL THEN
    RAISE NOTICE 'T2 SKIP: no hcp-less 18-hole course in seed';
    RETURN;
  END IF;

  -- php=3 strokes must land on the 3 first holes in (par DESC, hole ASC) order.
  WITH expect AS (
    SELECT hole_number, ROW_NUMBER() OVER (ORDER BY par DESC, hole_number ASC) AS rk
    FROM course_holes WHERE course_id = v_course
  )
  SELECT count(*) INTO v_bad
  FROM allocate_strokes(v_course, 3) al
  JOIN expect e ON e.hole_number = al.hole_number
  WHERE (al.strokes_received = 1) <> (e.rk <= 3);
  IF v_bad <> 0 THEN RAISE EXCEPTION 'T2 FAIL: fallback allocation not par-desc'; END IF;
  RAISE NOTICE 'T2 PASS: par-desc fallback allocation';
END $$;

-- ---------------------------------------------------------------------------
-- T3: snapshot freeze + cap + 9-hole halving + immutability
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_hugo uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_iris uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  v_res json;
  v_game uuid;
  v_match uuid;
  v_php int;
BEGIN
  UPDATE profiles SET handicap = 40 WHERE id = v_hugo;  -- caps at 36
  UPDATE profiles SET handicap = 21 WHERE id = v_iris;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_hugo, 'role', 'authenticated')::text, true);
  v_res := create_game('Snap Game', 'Anywhere', 4, current_date, current_date + 27, 3, 5, 'stroke_play', NULL, 'net');
  v_game := (v_res->>'game_id')::uuid;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_iris, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, match_date, created_by, status)
  VALUES (v_game, current_date, v_hugo, 'scheduled') RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match, v_hugo), (v_match, v_iris);

  -- 18-hole aggregate for Hugo (cap), 9-hole for Iris (halving).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_hugo, 'role', 'authenticated')::text, true);
  PERFORM submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', v_hugo, 'score', 100, 'holes', 18),
    json_build_object('user_id', v_iris, 'score', 55,  'holes', 9)
  ));

  SELECT playing_handicap INTO v_php FROM match_players WHERE match_id = v_match AND user_id = v_hugo;
  IF v_php <> 36 THEN RAISE EXCEPTION 'T3 FAIL: cap — got %', v_php; END IF;
  SELECT playing_handicap INTO v_php FROM match_players WHERE match_id = v_match AND user_id = v_iris;
  IF v_php <> 11 THEN RAISE EXCEPTION 'T3 FAIL: 9-hole halving — got % (want round(21/2)=11)', v_php; END IF;

  -- Profile edits after the freeze change nothing.
  UPDATE profiles SET handicap = 2 WHERE id = v_hugo;
  PERFORM submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', v_hugo, 'score', 99, 'holes', 18)
  ));
  SELECT playing_handicap INTO v_php FROM match_players WHERE match_id = v_match AND user_id = v_hugo;
  IF v_php <> 36 THEN RAISE EXCEPTION 'T3 FAIL: snapshot rewrote on re-submission (%)', v_php; END IF;
  RAISE NOTICE 'T3 PASS: snapshot cap/halving/immutability';
END $$;

-- ---------------------------------------------------------------------------
-- T4: net leaderboard — a 20-hcp and a 5-hcp tie on net; gross unchanged
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_hugo uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_iris uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  v_res json;
  v_game uuid;
  v_match uuid;
  v_row record;
  v_totals int[];
BEGIN
  UPDATE profiles SET handicap = 20 WHERE id = v_hugo;
  UPDATE profiles SET handicap = 5  WHERE id = v_iris;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_hugo, 'role', 'authenticated')::text, true);
  v_res := create_game('Net Tie Game', 'Anywhere', 4, current_date, current_date + 27, 3, 5, 'stroke_play', NULL, 'net');
  v_game := (v_res->>'game_id')::uuid;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_iris, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, match_date, created_by, status)
  VALUES (v_game, current_date, v_hugo, 'scheduled') RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match, v_hugo), (v_match, v_iris);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_hugo, 'role', 'authenticated')::text, true);
  PERFORM submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', v_hugo, 'score', 90, 'holes', 18),
    json_build_object('user_id', v_iris, 'score', 75, 'holes', 18)
  ));
  UPDATE scores SET status = 'approved' WHERE match_id = v_match;

  SELECT array_agg(total_score::int ORDER BY user_id) INTO v_totals
  FROM get_leaderboard(v_game) WHERE rounds_counted > 0;
  IF v_totals IS DISTINCT FROM ARRAY[70, 70] THEN
    RAISE EXCEPTION 'T4 FAIL: net totals % (want {70,70} — 90−20 and 75−5)', v_totals;
  END IF;

  -- Same data on a gross basis: raw totals, direction unchanged.
  UPDATE games SET scoring_basis = 'gross' WHERE id = v_game;
  SELECT * INTO v_row FROM get_leaderboard(v_game) WHERE "position" = 1;
  IF v_row.total_score <> 75 THEN
    RAISE EXCEPTION 'T4 FAIL: gross leader total % (want 75)', v_row.total_score;
  END IF;
  RAISE NOTICE 'T4 PASS: net tie (70=70), gross unchanged (75 leads)';
END $$;

-- ---------------------------------------------------------------------------
-- T5: stableford_net — controlled synthetic course, exact points; rounds
--     without hole data are excluded
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_hugo uuid := 'eeeeeeee-0000-0000-0000-000000000001';
  v_iris uuid := 'eeeeeeee-0000-0000-0000-000000000002';
  v_course uuid;
  v_res json;
  v_game uuid;
  v_match uuid;
  v_row record;
  i int;
BEGIN
  -- Synthetic 9-hole card: par 4 / hcp = hole number. Deterministic math.
  INSERT INTO courses (name, city, holes, par) VALUES ('T5 Test Course', 'Testville', 9, 72)
  RETURNING id INTO v_course;
  FOR i IN 1..9 LOOP
    INSERT INTO course_holes (course_id, hole_number, par, hcp_index) VALUES (v_course, i, 4, i);
  END LOOP;

  UPDATE profiles SET handicap = 18 WHERE id = v_hugo;  -- 9-hole php = 9 → 1 stroke/hole

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_hugo, 'role', 'authenticated')::text, true);
  v_res := create_game('Stb Net Game', 'T5 Test Course', 4, current_date, current_date + 27, 3, 5, 'stroke_play', v_course, 'stableford_net');
  v_game := (v_res->>'game_id')::uuid;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_iris, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, course_id, match_date, created_by, status)
  VALUES (v_game, v_course, current_date, v_hugo, 'scheduled') RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match, v_hugo), (v_match, v_iris);

  -- Hugo: hole-by-hole 4s. net 3 vs par 4 = birdie = 3 pts × 9 = 27.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_hugo, 'role', 'authenticated')::text, true);
  FOR i IN 1..9 LOOP
    PERFORM upsert_score_hole(v_match, v_hugo, i, 4);
  END LOOP;
  -- Iris: aggregate only — cannot yield points, must be excluded.
  PERFORM submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', v_iris, 'score', 40, 'holes', 9)
  ));
  UPDATE scores SET status = 'approved' WHERE match_id = v_match;

  SELECT * INTO v_row FROM get_leaderboard(v_game) WHERE user_id = v_hugo;
  IF v_row.total_score <> 27 THEN
    RAISE EXCEPTION 'T5 FAIL: Hugo stableford_net total % (want 27)', v_row.total_score;
  END IF;
  IF v_row."position" <> 1 THEN
    RAISE EXCEPTION 'T5 FAIL: higher points should lead (position %)', v_row."position";
  END IF;
  SELECT * INTO v_row FROM get_leaderboard(v_game) WHERE user_id = v_iris;
  IF v_row.rounds_counted <> 0 THEN
    RAISE EXCEPTION 'T5 FAIL: aggregate-only round counted in stableford_net (%)', v_row.rounds_counted;
  END IF;
  RAISE NOTICE 'T5 PASS: stableford_net exact points + aggregate exclusion';
END $$;

ROLLBACK;
