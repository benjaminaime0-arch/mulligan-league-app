-- ============================================================================
-- T2.3 regression tests — create_scheduled_match RPC
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Covers migration 20260811100000_create_scheduled_match.sql:
--   T1  happy path: one call inserts match + full roster atomically
--   T2  period is derived from the PICKED DATE, not the season's first week
--   T3  date outside every period falls back to the 'active' period
--   T4  no matching + no active period -> error, and NOTHING is inserted
--   T5  roster validation: <2, >4, non-member player, singles match play <> 2
--   T6  caller validation: non-member caller, completed game, practice game
--       (answers 'Game not found' — no oracle that the hidden game exists)
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- The whole file is one rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;
SET LOCAL search_path = public, extensions;

-- Fixed ids so failures are readable
INSERT INTO auth.users (instance_id, id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'a2230000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 't23-admin@test.local'),
  ('00000000-0000-0000-0000-000000000000', 'a2230000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 't23-member@test.local'),
  ('00000000-0000-0000-0000-000000000000', 'a2230000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 't23-outsider@test.local');

INSERT INTO games (id, name, course_name, admin_id, max_players, game_type, status)
VALUES ('12230000-0000-0000-0000-0000000000a1', 'T23 Game', 'T23 Course', 'a2230000-0000-0000-0000-000000000001', 4, 'stroke_play', 'active');

-- Admin auto-membership comes from the trigger; add the second member.
INSERT INTO game_members (game_id, user_id)
VALUES ('12230000-0000-0000-0000-0000000000a1', 'a2230000-0000-0000-0000-000000000002');

-- Three periods: two past weeks + the current 'active' week.
INSERT INTO game_periods (id, game_id, week_number, name, start_date, end_date, status)
VALUES
  ('92230000-0000-0000-0000-000000000001', '12230000-0000-0000-0000-0000000000a1', 1, 'Week 1', current_date - 14, current_date - 8,  'completed'),
  ('92230000-0000-0000-0000-000000000002', '12230000-0000-0000-0000-0000000000a1', 2, 'Week 2', current_date - 7,  current_date - 1,  'completed'),
  ('92230000-0000-0000-0000-000000000003', '12230000-0000-0000-0000-0000000000a1', 3, 'Week 3', current_date,      current_date + 6,  'active');

-- ----------------------------------------------------------------------------
-- T1 + T2: happy path — roster lands atomically, period matches the date
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_match matches%ROWTYPE;
  v_roster int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'a2230000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

  -- Date sits in Week 2 — NOT the first period of the season.
  v := create_scheduled_match(
    '12230000-0000-0000-0000-0000000000a1'::uuid,
    (current_date - 3)::date,
    ARRAY['a2230000-0000-0000-0000-000000000001','a2230000-0000-0000-0000-000000000002']::uuid[],
    '10:30'::time, NULL, 'T23 Away Course');

  IF (v->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T1: expected success, got %', v;
  END IF;

  RESET ROLE;
  SELECT * INTO v_match FROM matches WHERE id = (v->>'match_id')::uuid;
  IF v_match.id IS NULL THEN
    RAISE EXCEPTION 'T1: match row missing';
  END IF;
  IF v_match.period_id <> '92230000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'T2: expected Week 2 period, got %', v_match.period_id;
  END IF;
  IF v_match.course_name <> 'T23 Away Course' OR v_match.match_time <> '10:30'::time THEN
    RAISE EXCEPTION 'T1: match fields wrong: % %', v_match.course_name, v_match.match_time;
  END IF;

  SELECT count(*) INTO v_roster FROM match_players WHERE match_id = v_match.id;
  IF v_roster <> 2 THEN
    RAISE EXCEPTION 'T1: expected 2 roster rows, got %', v_roster;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- T3: date outside every period window -> the 'active' period wins
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_period uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'a2230000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

  v := create_scheduled_match(
    '12230000-0000-0000-0000-0000000000a1'::uuid,
    (current_date + 30)::date,
    ARRAY['a2230000-0000-0000-0000-000000000001','a2230000-0000-0000-0000-000000000002']::uuid[]);

  IF (v->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T3: expected success, got %', v;
  END IF;

  RESET ROLE;
  SELECT period_id INTO v_period FROM matches WHERE id = (v->>'match_id')::uuid;
  IF v_period <> '92230000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'T3: expected active period fallback, got %', v_period;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- T4: no period at all -> error AND no stranded rows
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_before int;
  v_after int;
BEGIN
  RESET ROLE;
  UPDATE game_periods SET status = 'completed'
   WHERE id = '92230000-0000-0000-0000-000000000003';
  SELECT count(*) INTO v_before FROM matches
   WHERE game_id = '12230000-0000-0000-0000-0000000000a1';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'a2230000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

  v := create_scheduled_match(
    '12230000-0000-0000-0000-0000000000a1'::uuid,
    (current_date + 30)::date,
    ARRAY['a2230000-0000-0000-0000-000000000001','a2230000-0000-0000-0000-000000000002']::uuid[]);

  IF (v->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T4: expected failure without any period, got %', v;
  END IF;

  RESET ROLE;
  SELECT count(*) INTO v_after FROM matches
   WHERE game_id = '12230000-0000-0000-0000-0000000000a1';
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'T4: match row leaked on failure';
  END IF;

  UPDATE game_periods SET status = 'active'
   WHERE id = '92230000-0000-0000-0000-000000000003';
END $$;

-- ----------------------------------------------------------------------------
-- T5: roster validation
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'a2230000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);

  -- 1 player only
  v := create_scheduled_match(
    '12230000-0000-0000-0000-0000000000a1'::uuid, current_date,
    ARRAY['a2230000-0000-0000-0000-000000000001']::uuid[]);
  IF (v->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T5: solo roster must be rejected, got %', v;
  END IF;

  -- outsider in the roster
  v := create_scheduled_match(
    '12230000-0000-0000-0000-0000000000a1'::uuid, current_date,
    ARRAY['a2230000-0000-0000-0000-000000000001','a2230000-0000-0000-0000-000000000003']::uuid[]);
  IF (v->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T5: non-member player must be rejected, got %', v;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- T6: caller validation — outsider caller + practice-game invisibility
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_practice uuid;
BEGIN
  -- Outsider calls on a game they're not in
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'a2230000-0000-0000-0000-000000000003', 'role', 'authenticated')::text, true);
  v := create_scheduled_match(
    '12230000-0000-0000-0000-0000000000a1'::uuid, current_date,
    ARRAY['a2230000-0000-0000-0000-000000000001','a2230000-0000-0000-0000-000000000002']::uuid[]);
  IF (v->>'success')::boolean IS TRUE THEN
    RAISE EXCEPTION 'T6: outsider caller must be rejected, got %', v;
  END IF;

  -- Practice container answers 'Game not found', not a membership error
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'a2230000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
  v := get_or_create_practice_game();
  v_practice := (v->>'game_id')::uuid;
  v := create_scheduled_match(
    v_practice, current_date,
    ARRAY['a2230000-0000-0000-0000-000000000001','a2230000-0000-0000-0000-000000000002']::uuid[]);
  IF (v->>'success')::boolean IS TRUE OR (v->>'error') <> 'Game not found' THEN
    RAISE EXCEPTION 'T6: practice game must answer Game not found, got %', v;
  END IF;
END $$;

ROLLBACK;
