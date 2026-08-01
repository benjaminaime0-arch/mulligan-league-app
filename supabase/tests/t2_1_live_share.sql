-- ============================================================================
-- T live-share — spectator token: gates, anon reads, revocation, privacy
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

SET LOCAL search_path = public, extensions;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'aeaeaeae-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ls-yves@test.local', '{"first_name":"Yves","username":"yves"}'),
  ('00000000-0000-0000-0000-000000000000', 'aeaeaeae-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ls-zoe@test.local',  '{"first_name":"Zoe","username":"zoe"}'),
  ('00000000-0000-0000-0000-000000000000', 'aeaeaeae-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'ls-out@test.local',  '{"first_name":"Out","username":"outsider"}');

DO $$
DECLARE
  v_yves uuid := 'aeaeaeae-0000-0000-0000-000000000001';
  v_zoe  uuid := 'aeaeaeae-0000-0000-0000-000000000002';
  v_out  uuid := 'aeaeaeae-0000-0000-0000-000000000003';
  v_course record;
  v_res json;
  v_game uuid;
  v_match uuid;
  v_token uuid;
  v_token2 uuid;
  v_live jsonb;
BEGIN
  SELECT c.id, c.name INTO v_course
  FROM courses c
  WHERE EXISTS (SELECT 1 FROM course_holes ch WHERE ch.course_id = c.id)
  ORDER BY c.name LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_yves, 'role', 'authenticated')::text, true);
  v_res := create_game('Live Share Game', v_course.name, 4, current_date, current_date + 27, 3, 5, 'stroke_play', v_course.id);
  v_game := (v_res->>'game_id')::uuid;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_zoe, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, course_name, course_id, match_date, created_by, status)
  VALUES (v_game, v_course.name, v_course.id, current_date, v_yves, 'scheduled')
  RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match, v_yves), (v_match, v_zoe);

  -- ---- T1: gate — outsider cannot enable ------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_out, 'role', 'authenticated')::text, true);
  v_res := enable_live_share(v_match);
  IF (v_res->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T1 FAIL: outsider enabled live share';
  END IF;

  -- ---- T2: member enables, idempotent ---------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_yves, 'role', 'authenticated')::text, true);
  v_res := enable_live_share(v_match);
  v_token := (v_res->>'token')::uuid;
  IF v_token IS NULL THEN RAISE EXCEPTION 'T2 FAIL: no token: %', v_res; END IF;
  v_res := enable_live_share(v_match);
  v_token2 := (v_res->>'token')::uuid;
  IF v_token2 IS DISTINCT FROM v_token THEN
    RAISE EXCEPTION 'T2 FAIL: re-enable rotated the token';
  END IF;
  RAISE NOTICE 'T1+T2 PASS: gate holds, enable is idempotent';

  -- Some live data: Yves keeps the card.
  PERFORM upsert_score_hole(v_match, v_yves, 1, 5);
  PERFORM upsert_score_hole(v_match, v_yves, 2, 4);
  PERFORM upsert_score_hole(v_match, v_zoe, 1, 6);

  -- ---- T3: anon reads via valid token; payload is privacy-clean -------------
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  v_live := get_live_match(v_token);
  IF (v_live->>'found')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T3 FAIL: anon cannot read a valid token: %', v_live;
  END IF;
  IF jsonb_array_length(v_live->'players') <> 2 THEN
    RAISE EXCEPTION 'T3 FAIL: players %', v_live->'players';
  END IF;
  IF (v_live->'players'->0->>'thru') IS NULL THEN
    RAISE EXCEPTION 'T3 FAIL: thru missing';
  END IF;
  -- No identifying keys anywhere in the payload.
  IF v_live::text ILIKE '%user_id%' OR v_live::text ILIKE '%email%'
     OR v_live::text ILIKE '%@test.local%' THEN
    RAISE EXCEPTION 'T3 FAIL: payload leaks identifiers: %', v_live;
  END IF;

  -- ---- T4: unknown token → found:false, no error ----------------------------
  v_live := get_live_match(gen_random_uuid());
  IF (v_live->>'found')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: random token found a match';
  END IF;
  -- Anon must NOT be able to read matches directly (the RPC is the only door).
  BEGIN
    PERFORM count(*) FROM matches;
    RAISE EXCEPTION 'T4 FAIL: anon can read matches table directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'T3+T4 PASS: anon token reads work, payload clean, tables sealed';

  -- ---- T5: revocation kills the link ----------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_zoe, 'role', 'authenticated')::text, true);
  v_res := disable_live_share(v_match);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T5 FAIL: member could not disable: %', v_res;
  END IF;
  SET LOCAL ROLE anon;
  v_live := get_live_match(v_token);
  IF (v_live->>'found')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T5 FAIL: revoked token still reads';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'T5 PASS: revocation is immediate';
END $$;

ROLLBACK;
