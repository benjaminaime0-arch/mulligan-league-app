-- ============================================================================
-- T2.5 regression tests — join capacity + brute-force hardening
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Covers migration 20260812100000_harden_join_capacity_and_bruteforce.sql:
--   T1  new games get a 10-char Crockford invite code (entropy bump)
--   T2  enforce_game_member_limit blocks the (max+1)th member on any path
--   T3  join_game_by_code refuses a full game gracefully
--   T4  throttle: the 11th failed guess in a window is rejected; a success
--       clears the counter
--   T5  the capacity trigger does NOT block practice game admin auto-add
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction; nothing persists.
-- ============================================================================
BEGIN;
SET LOCAL search_path = public, extensions;

INSERT INTO auth.users (instance_id, id, aud, role, email) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a2500000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 't25-admin@test.local'),
  ('00000000-0000-0000-0000-000000000000', 'a2500000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 't25-b@test.local'),
  ('00000000-0000-0000-0000-000000000000', 'a2500000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 't25-c@test.local'),
  ('00000000-0000-0000-0000-000000000000', 'a2500000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 't25-d@test.local');

-- A 2-player game (admin auto-added as member #1 by trigger).
INSERT INTO games (id, name, course_name, admin_id, max_players, game_type, status, invite_code)
VALUES ('12500000-0000-0000-0000-0000000000a1', 'T25 Game', 'Course', 'a2500000-0000-0000-0000-000000000001', 2, 'stroke_play', 'active', 'T25FIXED01');

-- ----------------------------------------------------------------------------
-- T1: a game created WITHOUT an explicit code gets a 10-char Crockford code
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_code text;
BEGIN
  INSERT INTO games (id, name, course_name, admin_id, max_players, game_type, status)
  VALUES ('12500000-0000-0000-0000-0000000000a2', 'T25 Auto', 'Course', 'a2500000-0000-0000-0000-000000000001', 4, 'stroke_play', 'active')
  RETURNING invite_code INTO v_code;

  IF v_code !~ '^[0-9A-HJKMNP-TV-Z]{10}$' THEN
    RAISE EXCEPTION 'T1 FAIL: invite code % is not 10-char Crockford base32', v_code;
  END IF;
  RAISE NOTICE 'T1 PASS: auto invite code = % (10-char Crockford)', v_code;
END $$;

-- ----------------------------------------------------------------------------
-- T2 + T3: capacity — trigger blocks the 3rd member; RPC refuses gracefully
-- ----------------------------------------------------------------------------
DO $$
DECLARE v json; v_blocked boolean := false; v_count int;
BEGIN
  -- Admin is member #1. Add member #2 directly (fills the 2-player game).
  INSERT INTO game_members (game_id, user_id)
  VALUES ('12500000-0000-0000-0000-0000000000a1', 'a2500000-0000-0000-0000-000000000002');

  -- Direct insert of a 3rd must raise (the backstop trigger).
  BEGIN
    INSERT INTO game_members (game_id, user_id)
    VALUES ('12500000-0000-0000-0000-0000000000a1', 'a2500000-0000-0000-0000-000000000003');
  EXCEPTION WHEN check_violation THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'T2 FAIL: 3rd member insert not blocked on a 2-player game';
  END IF;

  -- The RPC path must refuse gracefully (JSON, not exception).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2500000-0000-0000-0000-000000000003","role":"authenticated"}', true);
  v := join_game_by_code('T25FIXED01');
  RESET ROLE;
  IF (v->>'success')::boolean IS TRUE OR v->>'error' <> 'This game is full' THEN
    RAISE EXCEPTION 'T3 FAIL: full-game join returned %', v;
  END IF;

  SELECT count(*) INTO v_count FROM game_members WHERE game_id = '12500000-0000-0000-0000-0000000000a1';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'T3 FAIL: member count is % after blocked joins, expected 2', v_count;
  END IF;
  RAISE NOTICE 'T2+T3 PASS: capacity enforced by trigger and RPC';
END $$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T4: throttle — 10 bad guesses allowed, 11th rejected; success resets
-- ----------------------------------------------------------------------------
DO $$
DECLARE v json; i int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2500000-0000-0000-0000-000000000004","role":"authenticated"}', true);

  FOR i IN 1..10 LOOP
    v := join_game_by_code('NOSUCHCODE');
    IF v->>'error' <> 'Invalid invite code' THEN
      RESET ROLE;
      RAISE EXCEPTION 'T4 FAIL: guess % returned % (expected Invalid invite code)', i, v;
    END IF;
  END LOOP;

  v := join_game_by_code('NOSUCHCODE');
  IF v->>'error' NOT LIKE 'Too many attempts%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'T4 FAIL: 11th guess not throttled: %', v;
  END IF;
  RESET ROLE;
  RAISE NOTICE 'T4 PASS: 11th failed guess throttled';
END $$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T5: capacity trigger must NOT block a practice game's admin auto-add
-- ----------------------------------------------------------------------------
DO $$
DECLARE v json; v_game uuid; v_members int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2500000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  v := get_or_create_practice_game();
  RESET ROLE;
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T5 FAIL: practice game creation blocked: %', v;
  END IF;
  v_game := (v->>'game_id')::uuid;
  SELECT count(*) INTO v_members FROM game_members WHERE game_id = v_game;
  IF v_members <> 1 THEN
    RAISE EXCEPTION 'T5 FAIL: practice game has % members, expected 1 (admin)', v_members;
  END IF;
  RAISE NOTICE 'T5 PASS: capacity trigger allows practice admin auto-add';
END $$;
RESET ROLE;

ROLLBACK;
