-- ============================================================================
-- T F — course directory & stats: slugs, anon reads, per-course stats,
--        conquests
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- T1: every seeded course has a unique, url-safe slug
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_null int; v_dup int; v_bad int;
BEGIN
  SELECT count(*) INTO v_null FROM courses WHERE slug IS NULL AND name NOT LIKE 'T%Course';
  IF v_null <> 0 THEN RAISE EXCEPTION 'T1 FAIL: % courses without slug', v_null; END IF;
  SELECT count(*) INTO v_dup FROM (
    SELECT slug FROM courses WHERE slug IS NOT NULL GROUP BY slug HAVING count(*) > 1
  ) d;
  IF v_dup <> 0 THEN RAISE EXCEPTION 'T1 FAIL: % duplicate slugs', v_dup; END IF;
  SELECT count(*) INTO v_bad FROM courses WHERE slug IS NOT NULL AND slug !~ '^[a-z0-9-]+$';
  IF v_bad <> 0 THEN RAISE EXCEPTION 'T1 FAIL: % non-url-safe slugs', v_bad; END IF;
  RAISE NOTICE 'T1 PASS: slugs present, unique, url-safe';
END $$;

-- ---------------------------------------------------------------------------
-- T2: anon can read the referential — and ONLY the referential
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM courses;
  IF v_n < 100 THEN RAISE EXCEPTION 'T2 FAIL: anon sees % courses', v_n; END IF;
  SELECT count(*) INTO v_n FROM course_holes;
  IF v_n < 500 THEN RAISE EXCEPTION 'T2 FAIL: anon sees % course_holes', v_n; END IF;
  BEGIN
    SELECT count(*) INTO v_n FROM games;
    RAISE EXCEPTION 'T2 FAIL: anon can read games';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'T2 PASS: anon reads referential only';
END $$;

-- ---------------------------------------------------------------------------
-- T3: per-course stats + conquest math
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'acacacac-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'crs-paul@test.local', '{"first_name":"Paul","username":"paul"}'),
  ('00000000-0000-0000-0000-000000000000', 'acacacac-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'crs-quin@test.local', '{"first_name":"Quin","username":"quin"}'),
  ('00000000-0000-0000-0000-000000000000', 'acacacac-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'crs-rita@test.local', '{"first_name":"Rita","username":"rita"}');

DO $$
DECLARE
  v_paul uuid := 'acacacac-0000-0000-0000-000000000001';
  v_quin uuid := 'acacacac-0000-0000-0000-000000000002';
  v_rita uuid := 'acacacac-0000-0000-0000-000000000003';  -- outsider
  v_course record;
  v_res json;
  v_game uuid;
  v_match uuid;
  v_stats jsonb;
  v_row record;
BEGIN
  SELECT c.id, c.name, c.par, c.dept_no INTO v_course
  FROM courses c
  WHERE c.par IS NOT NULL AND c.holes = 18
    AND EXISTS (SELECT 1 FROM course_holes ch WHERE ch.course_id = c.id)
  ORDER BY c.name LIMIT 1;

  UPDATE profiles SET handicap = 15 WHERE id = v_paul;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_paul, 'role', 'authenticated')::text, true);
  v_res := create_game('Course Stats Game', v_course.name, 4, current_date, current_date + 27, 3, 5, 'stroke_play', v_course.id);
  v_game := (v_res->>'game_id')::uuid;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_quin, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, course_name, course_id, match_date, created_by, status)
  VALUES (v_game, v_course.name, v_course.id, current_date, v_paul, 'scheduled')
  RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match, v_paul), (v_match, v_quin);

  -- Paul: gross = par + 10, php 15 → net = par − 5 → conquered.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_paul, 'role', 'authenticated')::text, true);
  PERFORM submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', v_paul, 'score', v_course.par + 10, 'holes', 18)
  ));
  UPDATE scores SET status = 'approved' WHERE match_id = v_match AND user_id = v_paul;

  v_stats := get_user_course_stats(v_paul, v_course.id);
  IF (v_stats->>'rounds')::int <> 1
     OR (v_stats->>'best_gross')::int <> v_course.par + 10
     OR (v_stats->>'best_net')::int <> v_course.par - 5
     OR (v_stats->>'avg_vs_par')::numeric <> 10 THEN
    RAISE EXCEPTION 'T3 FAIL: stats %', v_stats;
  END IF;

  -- Outsider gated.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_rita, 'role', 'authenticated')::text, true);
  v_stats := get_user_course_stats(v_paul, v_course.id);
  IF (v_stats->>'visible')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T3 FAIL: outsider sees stats';
  END IF;

  -- Conquest grid: Paul's department shows 1/1.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_paul, 'role', 'authenticated')::text, true);
  SELECT * INTO v_row FROM get_profile_course_conquests(v_paul)
  WHERE dept_no = v_course.dept_no;
  IF v_row.courses_played <> 1 OR v_row.conquered <> 1 THEN
    RAISE EXCEPTION 'T3 FAIL: conquest row % (want 1/1)', v_row;
  END IF;
  RAISE NOTICE 'T3 PASS: per-course stats, gate, conquest math';
END $$;

ROLLBACK;
