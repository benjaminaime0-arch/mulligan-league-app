-- ============================================================================
-- T A — course foundation: course_holes seed integrity, RLS, create_game
--        p_course_id, get_profile_courses course grouping, backfill
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

-- unaccent may live in `extensions` (hosted layout) or `public` (fallback);
-- make both resolvable for the T4 assertions.
SET LOCAL search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- T1: seed integrity — coverage and par consistency
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_courses int;
  v_bad     int;
  v_gaps    int;
BEGIN
  SELECT count(DISTINCT course_id) INTO v_courses FROM course_holes;
  IF v_courses < 90 THEN
    RAISE EXCEPTION 'T1 FAIL: only % courses have hole data (want >= 90)', v_courses;
  END IF;

  -- Every seeded course's hole-par sum must equal courses.par directly (18T)
  -- or via the two-loop convention (9T: stored par = 2 x nine-hole par).
  SELECT count(*) INTO v_bad FROM (
    SELECT ch.course_id, sum(ch.par) AS s, count(*) AS n, c.par
    FROM course_holes ch JOIN courses c ON c.id = ch.course_id
    GROUP BY ch.course_id, c.par
    HAVING NOT (sum(ch.par) = c.par OR (count(*) = 9 AND sum(ch.par) * 2 = c.par))
  ) x;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: % courses where hole pars contradict courses.par', v_bad;
  END IF;

  -- Hole numbers are 1..n with no gaps and n in (9, 18).
  SELECT count(*) INTO v_gaps FROM (
    SELECT course_id, count(*) AS n, max(hole_number) AS mx
    FROM course_holes GROUP BY course_id
    HAVING count(*) NOT IN (9, 18) OR max(hole_number) <> count(*)
  ) x;
  IF v_gaps <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: % courses with gapped/odd hole numbering', v_gaps;
  END IF;

  RAISE NOTICE 'T1 PASS: % courses seeded, pars consistent, numbering dense', v_courses;
END $$;

-- ---------------------------------------------------------------------------
-- T2: RLS — authenticated can read course_holes, cannot write
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'course-carol@test.local', '{"first_name":"Carol","username":"carol"}'),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'course-dave@test.local',  '{"first_name":"Dave","username":"dave"}');

DO $$
DECLARE
  v_carol uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_carol, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_n FROM course_holes;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'T2 FAIL: authenticated cannot read course_holes';
  END IF;

  BEGIN
    INSERT INTO course_holes (course_id, hole_number, par)
    SELECT course_id, 19 - 18, 4 FROM course_holes LIMIT 1;
    RAISE EXCEPTION 'T2 FAIL: authenticated INSERT on course_holes was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'T2 PASS: course_holes readable, not writable, for authenticated';
    WHEN unique_violation THEN
      RAISE EXCEPTION 'T2 FAIL: INSERT reached the table (blocked only by unique)';
  END;

  RESET ROLE;
END $$;

-- ---------------------------------------------------------------------------
-- T3: create_game stores p_course_id; match inherits are client-side so we
--     insert the match row directly (as the app does) and read stats back
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_carol uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_dave  uuid := 'cccccccc-0000-0000-0000-000000000002';
  v_course_id uuid;
  v_course_name text;
  v_res json;
  v_game uuid;
  v_match uuid;
  v_row record;
BEGIN
  SELECT id, name INTO v_course_id, v_course_name
  FROM courses WHERE par IS NOT NULL ORDER BY name LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_carol, 'role', 'authenticated')::text, true);

  v_res := create_game('Course FK Game', v_course_name, 4,
                       current_date, current_date + 27, 3, 5,
                       'stroke_play', v_course_id);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T3 FAIL create_game: %', v_res;
  END IF;
  v_game := (v_res->>'game_id')::uuid;

  IF (SELECT course_id FROM games WHERE id = v_game) IS DISTINCT FROM v_course_id THEN
    RAISE EXCEPTION 'T3 FAIL: games.course_id not stored by create_game';
  END IF;

  -- Unknown course id -> clean error JSON, not an exception
  v_res := create_game('Bad Course Game', 'Nowhere', 4,
                       current_date, current_date + 27, 3, 5,
                       'stroke_play', 'ffffffff-ffff-ffff-ffff-ffffffffffff');
  IF (v_res->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T3 FAIL: create_game accepted a nonexistent course id';
  END IF;

  -- Dave joins; a match on the game course; approved score for Carol.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_dave, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, course_name, course_id, match_date, created_by, status)
  VALUES (v_game, v_course_name, v_course_id, current_date, v_carol, 'scheduled')
  RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id, approved_at) VALUES
    (v_match, v_carol, now()), (v_match, v_dave, now());
  INSERT INTO scores (match_id, user_id, score, holes, status, submitted_by)
  VALUES (v_match, v_carol, 88, 18, 'approved', v_carol);

  -- Dave (a game-mate) reads Carol's course stats: the row must aggregate
  -- under the verified course (id + city + par), not raw text.
  SELECT * INTO v_row FROM get_profile_courses(v_carol) LIMIT 1;
  IF v_row.course_id IS DISTINCT FROM v_course_id THEN
    RAISE EXCEPTION 'T3 FAIL: get_profile_courses did not group by course_id (got %)', v_row;
  END IF;
  IF v_row.best_score <> 88 OR v_row.times_played <> 1 THEN
    RAISE EXCEPTION 'T3 FAIL: wrong aggregates: %', v_row;
  END IF;

  RAISE NOTICE 'T3 PASS: create_game stores course_id; profile stats group by course';
END $$;

-- ---------------------------------------------------------------------------
-- T4: backfill_course_ids — exact + unaccented match, unique-only
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_carol uuid := 'cccccccc-0000-0000-0000-000000000001';
  v_res json;
  v_game_exact uuid;
  v_game_accent uuid;
  v_game_junk uuid;
  v_target record;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_carol, 'role', 'authenticated')::text, true);

  -- A course whose name carries accents, so the unaccent leg is exercised.
  SELECT id, name INTO v_target FROM courses
  WHERE name ~ '[éèêàçîô]' ORDER BY name LIMIT 1;

  v_res := create_game('BF exact', upper(v_target.name), 4, current_date, current_date + 7, 1, 1);
  v_game_exact := (v_res->>'game_id')::uuid;
  v_res := create_game('BF accent', unaccent(v_target.name), 4, current_date, current_date + 7, 1, 1);
  v_game_accent := (v_res->>'game_id')::uuid;
  v_res := create_game('BF junk', 'Le Golf Qui N''Existe Pas', 4, current_date, current_date + 7, 1, 1);
  v_game_junk := (v_res->>'game_id')::uuid;

  PERFORM backfill_course_ids();

  IF (SELECT course_id FROM games WHERE id = v_game_exact) IS DISTINCT FROM v_target.id THEN
    RAISE EXCEPTION 'T4 FAIL: case-insensitive exact match not backfilled';
  END IF;
  IF (SELECT course_id FROM games WHERE id = v_game_accent) IS DISTINCT FROM v_target.id THEN
    RAISE EXCEPTION 'T4 FAIL: unaccented match not backfilled';
  END IF;
  IF (SELECT course_id FROM games WHERE id = v_game_junk) IS NOT NULL THEN
    RAISE EXCEPTION 'T4 FAIL: junk course name got a course_id';
  END IF;

  RAISE NOTICE 'T4 PASS: backfill matches exact + unaccented, leaves junk NULL';
END $$;

ROLLBACK;
