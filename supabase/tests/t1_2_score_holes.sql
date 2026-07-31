-- ============================================================================
-- T B — per-hole scorecards: sum trigger, approval resets, RPC gates, RLS,
--        get_match_scorecard payload
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'holes-erin@test.local',  '{"first_name":"Erin","username":"erin"}'),
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'holes-frank@test.local', '{"first_name":"Frank","username":"frank"}'),
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'holes-gina@test.local',  '{"first_name":"Gina","username":"gina"}');

DO $$
DECLARE
  v_erin  uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_frank uuid := 'dddddddd-0000-0000-0000-000000000002';
  v_gina  uuid := 'dddddddd-0000-0000-0000-000000000003';  -- never joins
  v_course record;
  v_res json;
  v_card jsonb;
  v_game uuid;
  v_match uuid;
  v_score int;
  v_status text;
  v_n int;
BEGIN
  -- An 18-hole course WITH hole data, so the scorecard has par context.
  SELECT c.id, c.name, c.par INTO v_course
  FROM courses c
  WHERE (SELECT count(*) FROM course_holes ch WHERE ch.course_id = c.id) = 18
  ORDER BY c.name LIMIT 1;
  IF v_course.id IS NULL THEN
    RAISE EXCEPTION 'T0 FAIL: no 18-hole seeded course available';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_erin, 'role', 'authenticated')::text, true);

  v_res := create_game('Holes Game', v_course.name, 4, current_date, current_date + 27, 3, 5, 'stroke_play', v_course.id);
  v_game := (v_res->>'game_id')::uuid;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_frank, 'role', 'authenticated')::text, true);
  PERFORM join_game_by_code((SELECT invite_code FROM games WHERE id = v_game));

  INSERT INTO matches (game_id, course_name, course_id, match_date, created_by, status)
  VALUES (v_game, v_course.name, v_course.id, current_date, v_erin, 'scheduled')
  RETURNING id INTO v_match;
  INSERT INTO match_players (match_id, user_id) VALUES (v_match, v_erin), (v_match, v_frank);

  -- ---- T1: Erin keeps the card for both players -----------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_erin, 'role', 'authenticated')::text, true);

  v_res := upsert_score_hole(v_match, v_erin, 1, 5);
  IF (v_res->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T1 FAIL upsert hole 1 (self): %', v_res;
  END IF;
  v_res := upsert_score_hole(v_match, v_erin, 2, 4);
  v_res := upsert_score_hole(v_match, v_frank, 1, 6);   -- batch: card-keeper writes Frank too
  v_res := upsert_score_hole(v_match, v_frank, 2, 3);
  IF (v_res->>'total')::int <> 9 OR (v_res->>'thru')::int <> 2 THEN
    RAISE EXCEPTION 'T1 FAIL: RPC returned total/thru %', v_res;
  END IF;

  SELECT score, status INTO v_score, v_status FROM scores WHERE match_id = v_match AND user_id = v_erin;
  IF v_score <> 9 OR v_status <> 'pending' THEN
    RAISE EXCEPTION 'T1 FAIL: Erin aggregate % / % (want 9 / pending)', v_score, v_status;
  END IF;
  SELECT score INTO v_score FROM scores WHERE match_id = v_match AND user_id = v_frank;
  IF v_score <> 9 THEN
    RAISE EXCEPTION 'T1 FAIL: Frank aggregate % (want 9)', v_score;
  END IF;

  -- Card-keeper is auto-approved; the other player is not.
  IF (SELECT approved_at FROM match_players WHERE match_id = v_match AND user_id = v_erin) IS NULL THEN
    RAISE EXCEPTION 'T1 FAIL: card-keeper not auto-approved';
  END IF;
  IF (SELECT approved_at FROM match_players WHERE match_id = v_match AND user_id = v_frank) IS NOT NULL THEN
    RAISE EXCEPTION 'T1 FAIL: non-writer approved without acting';
  END IF;
  RAISE NOTICE 'T1 PASS: batch per-hole entry sums into scores + approval semantics';

  -- ---- T2: editing a hole resets an approved score back to pending ----------
  UPDATE scores SET status = 'approved', approved_by = v_frank, approved_at = now()
  WHERE match_id = v_match AND user_id = v_erin;

  v_res := upsert_score_hole(v_match, v_erin, 3, 7);
  SELECT score, status INTO v_score, v_status FROM scores WHERE match_id = v_match AND user_id = v_erin;
  IF v_score <> 16 OR v_status <> 'pending' THEN
    RAISE EXCEPTION 'T2 FAIL: after hole edit, aggregate %/% (want 16/pending)', v_score, v_status;
  END IF;

  -- Same-value write is a no-op: approval state must not churn.
  UPDATE scores SET status = 'approved' WHERE match_id = v_match AND user_id = v_erin;
  v_res := upsert_score_hole(v_match, v_erin, 3, 7);
  SELECT status INTO v_status FROM scores WHERE match_id = v_match AND user_id = v_erin;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'T2 FAIL: same-value hole write reset an approved score';
  END IF;
  RAISE NOTICE 'T2 PASS: hole edits reset approval, no-op writes do not';

  -- ---- T3: deletion (p_strokes NULL) recomputes -----------------------------
  v_res := upsert_score_hole(v_match, v_erin, 3, NULL);
  SELECT score INTO v_score FROM scores WHERE match_id = v_match AND user_id = v_erin;
  IF v_score <> 9 OR (v_res->>'thru')::int <> 2 THEN
    RAISE EXCEPTION 'T3 FAIL: after delete, aggregate % thru % (want 9/2)', v_score, v_res->>'thru';
  END IF;
  RAISE NOTICE 'T3 PASS: hole deletion recomputes the sum';

  -- ---- T4: gates — outsider RPC, closed match -------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_gina, 'role', 'authenticated')::text, true);
  v_res := upsert_score_hole(v_match, v_erin, 4, 4);
  IF (v_res->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: non-participant wrote a hole';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_erin, 'role', 'authenticated')::text, true);
  UPDATE matches SET status = 'cancelled' WHERE id = v_match;
  v_res := upsert_score_hole(v_match, v_erin, 4, 4);
  IF (v_res->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: wrote a hole into a cancelled match';
  END IF;
  UPDATE matches SET status = 'scheduled' WHERE id = v_match;
  RAISE NOTICE 'T4 PASS: participant + open-match gates hold';

  -- ---- T5: get_match_scorecard payload --------------------------------------
  v_card := get_match_scorecard(v_match);
  IF (v_card->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T5 FAIL: %', v_card;
  END IF;
  IF jsonb_array_length(v_card->'players') <> 2 THEN
    RAISE EXCEPTION 'T5 FAIL: players %', v_card->'players';
  END IF;
  IF jsonb_array_length(v_card->'course'->'holes') <> 18 THEN
    RAISE EXCEPTION 'T5 FAIL: course holes %', jsonb_array_length(v_card->'course'->'holes');
  END IF;
  IF (v_card->>'editable')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T5 FAIL: editable should be true for a participant';
  END IF;

  -- Outsider: gated.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_gina, 'role', 'authenticated')::text, true);
  v_card := get_match_scorecard(v_match);
  IF (v_card->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T5 FAIL: outsider can read the scorecard';
  END IF;
  RAISE NOTICE 'T5 PASS: scorecard payload + visibility gate';
END $$;

-- ---- T6: RLS — outsider sees no score_holes rows (role-level check) ---------
DO $$
DECLARE
  v_gina uuid := 'dddddddd-0000-0000-0000-000000000003';
  v_erin uuid := 'dddddddd-0000-0000-0000-000000000001';
  v_n int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_gina, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM score_holes;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'T6 FAIL: outsider sees % score_holes rows', v_n;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_erin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM score_holes;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'T6 FAIL: participant sees no score_holes rows';
  END IF;
  -- Direct writes are not granted — only the RPC path is.
  BEGIN
    INSERT INTO score_holes (score_id, hole_number, strokes)
    SELECT id, 18, 4 FROM scores LIMIT 1;
    RAISE EXCEPTION 'T6 FAIL: direct INSERT on score_holes was allowed';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'T6 PASS: score_holes RLS scopes to match visibility, no direct writes';
END $$;

ROLLBACK;
