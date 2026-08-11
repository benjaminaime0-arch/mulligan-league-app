-- ============================================================================
-- T2.4 regression tests — score history, post-completion lock, finalization
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Covers migration 20260811130000_score_finalize_lock_history.sql:
--   T1  submit_match_scores stamps submitted_by + validates targets/bounds
--   T2  editing a score writes a score_revisions line, notifies the players
--       whose approval it invalidates, and resets approvals
--   T3  finalize_match_scores refuses non-captains
--   T4  captain finalize approves remaining cards (approved_by = captain)
--       and completes the match
--   T5  the lock: submit refuses on a completed match; a direct UPDATE of
--       a score value raises; the system GUC lane still passes (crons)
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- The whole file is one rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;
SET LOCAL search_path = public, extensions;

INSERT INTO auth.users (instance_id, id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'a2240000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 't24-captain@test.local'),
  ('00000000-0000-0000-0000-000000000000', 'a2240000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 't24-member2@test.local'),
  ('00000000-0000-0000-0000-000000000000', 'a2240000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 't24-member3@test.local');

INSERT INTO games (id, name, course_name, admin_id, max_players, game_type, status)
VALUES ('12240000-0000-0000-0000-0000000000a1', 'T24 Game', 'T24 Course', 'a2240000-0000-0000-0000-000000000001', 4, 'stroke_play', 'active');

INSERT INTO game_members (game_id, user_id) VALUES
  ('12240000-0000-0000-0000-0000000000a1', 'a2240000-0000-0000-0000-000000000002'),
  ('12240000-0000-0000-0000-0000000000a1', 'a2240000-0000-0000-0000-000000000003');

INSERT INTO game_periods (id, game_id, week_number, name, start_date, end_date, status)
VALUES ('92240000-0000-0000-0000-000000000001', '12240000-0000-0000-0000-0000000000a1', 1, 'Week 1', current_date - 3, current_date + 3, 'active');

-- ----------------------------------------------------------------------------
-- T1: three-player match; captain submits all cards — submitted_by stamped,
--     bad targets/bounds refused
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_match uuid;
  v_n int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2240000-0000-0000-0000-000000000001","role":"authenticated"}', true);

  v := create_scheduled_match(
    '12240000-0000-0000-0000-0000000000a1'::uuid, current_date,
    ARRAY['a2240000-0000-0000-0000-000000000001','a2240000-0000-0000-0000-000000000002','a2240000-0000-0000-0000-000000000003']::uuid[]);
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RESET ROLE; RAISE EXCEPTION 'T1 FAIL: create_scheduled_match: %', v;
  END IF;
  v_match := (v->>'match_id')::uuid;
  PERFORM set_config('t24.match_id', v_match::text, false);

  -- Non-player target refused (the arbitrary-profile-id hole).
  v := submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', 'a2240000-0000-0000-0000-000000000001', 'score', 80, 'holes', 18),
    json_build_object('user_id', '00000000-0000-0000-0000-00000000dead', 'score', 80, 'holes', 18)));
  IF (v->>'success')::boolean IS TRUE THEN
    RESET ROLE; RAISE EXCEPTION 'T1 FAIL: non-player score target accepted';
  END IF;

  -- Insane holes refused.
  v := submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', 'a2240000-0000-0000-0000-000000000001', 'score', 80, 'holes', 27)));
  IF (v->>'success')::boolean IS TRUE THEN
    RESET ROLE; RAISE EXCEPTION 'T1 FAIL: holes=27 accepted';
  END IF;

  -- Legit submit of all three cards.
  v := submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', 'a2240000-0000-0000-0000-000000000001', 'score', 80, 'holes', 18),
    json_build_object('user_id', 'a2240000-0000-0000-0000-000000000002', 'score', 85, 'holes', 18),
    json_build_object('user_id', 'a2240000-0000-0000-0000-000000000003', 'score', 90, 'holes', 18)));
  RESET ROLE;
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T1 FAIL: legit submit refused: %', v;
  END IF;

  SELECT count(*) INTO v_n FROM scores
  WHERE match_id = v_match AND submitted_by = 'a2240000-0000-0000-0000-000000000001';
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'T1 FAIL: submitted_by stamped on % rows, expected 3', v_n;
  END IF;

  RAISE NOTICE 'T1 PASS: submit validates targets/bounds and stamps submitted_by';
END $$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T2: edit -> revision line + invalidation notice + approvals reset
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_match uuid := current_setting('t24.match_id')::uuid;
  v_rev score_revisions%ROWTYPE;
  v_n int;
BEGIN
  -- Player 2 approves (2/3 approved with the captain; match stays open).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2240000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  v := approve_match_scores(v_match);
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RESET ROLE; RAISE EXCEPTION 'T2 FAIL: approve: %', v;
  END IF;

  -- Captain edits player 3's card -> player 2's sign-off is invalidated.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2240000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  v := submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', 'a2240000-0000-0000-0000-000000000003', 'score', 88, 'holes', 18)));
  RESET ROLE;
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T2 FAIL: edit refused: %', v;
  END IF;

  SELECT * INTO v_rev FROM score_revisions
  WHERE match_id = v_match AND user_id = 'a2240000-0000-0000-0000-000000000003'
  ORDER BY changed_at DESC LIMIT 1;
  IF v_rev.id IS NULL OR v_rev.old_score <> 90 OR v_rev.new_score <> 88
     OR v_rev.changed_by <> 'a2240000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'T2 FAIL: revision line wrong (old=% new=% by=%)',
      v_rev.old_score, v_rev.new_score, v_rev.changed_by;
  END IF;

  SELECT count(*) INTO v_n FROM notifications
  WHERE user_id = 'a2240000-0000-0000-0000-000000000002'
    AND type = 'score_submitted' AND title = 'Scores updated';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'T2 FAIL: invalidated approver got no notice';
  END IF;

  SELECT count(*) INTO v_n FROM match_players
  WHERE match_id = v_match AND approved_at IS NOT NULL
    AND user_id <> 'a2240000-0000-0000-0000-000000000001';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'T2 FAIL: approvals not reset after edit';
  END IF;

  RAISE NOTICE 'T2 PASS: revision + notice + approvals reset';
END $$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T3 + T4: finalize — refused for a mere player, works for the captain
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_match uuid := current_setting('t24.match_id')::uuid;
  v_status text;
  v_n int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2240000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  v := finalize_match_scores(v_match);
  IF (v->>'success')::boolean IS TRUE THEN
    RESET ROLE; RAISE EXCEPTION 'T3 FAIL: non-captain finalized';
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2240000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  v := finalize_match_scores(v_match);
  RESET ROLE;
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: captain finalize refused: %', v;
  END IF;

  SELECT status INTO v_status FROM matches WHERE id = v_match;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'T4 FAIL: match status %, expected completed', v_status;
  END IF;
  SELECT count(*) INTO v_n FROM scores
  WHERE match_id = v_match AND status = 'approved'
    AND approved_by = 'a2240000-0000-0000-0000-000000000001';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'T4 FAIL: no captain-stamped approvals (approved_by)';
  END IF;
  SELECT count(*) INTO v_n FROM match_players
  WHERE match_id = v_match AND approved_at IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'T4 FAIL: % players left unapproved', v_n;
  END IF;

  RAISE NOTICE 'T3+T4 PASS: finalize gated to captain and completes the match';
END $$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T5: the lock — submit refused, direct value UPDATE raises, GUC lane passes
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_match uuid := current_setting('t24.match_id')::uuid;
  v_locked boolean := false;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2240000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  v := submit_match_scores(v_match, json_build_array(
    json_build_object('user_id', 'a2240000-0000-0000-0000-000000000002', 'score', 70, 'holes', 18)));
  RESET ROLE;
  IF (v->>'success')::boolean IS TRUE OR v->>'error' <> 'Match is closed.' THEN
    RAISE EXCEPTION 'T5 FAIL: submit on completed match returned %', v;
  END IF;

  -- Direct value UPDATE (any non-system lane) must raise. Table owner
  -- bypasses RLS but NOT the BEFORE trigger — same trigger PostgREST hits.
  BEGIN
    UPDATE scores SET score = 33
    WHERE match_id = v_match AND user_id = 'a2240000-0000-0000-0000-000000000002';
  EXCEPTION WHEN check_violation THEN
    v_locked := true;
  END;
  IF NOT v_locked THEN
    RAISE EXCEPTION 'T5 FAIL: direct score UPDATE on completed match not blocked';
  END IF;

  -- The crons' GUC lane must still pass (24h auto-validation unaffected).
  PERFORM set_config('mulligan.system_update', 'on', true);
  UPDATE scores SET score = 86
  WHERE match_id = v_match AND user_id = 'a2240000-0000-0000-0000-000000000002';
  PERFORM set_config('mulligan.system_update', 'off', true);

  RAISE NOTICE 'T5 PASS: lock blocks user lanes, system lane open';
END $$;
RESET ROLE;

ROLLBACK;
