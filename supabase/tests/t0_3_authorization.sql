-- ============================================================================
-- T0.3 authorization regression tests — the four exploits must be rejected
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
--
-- These tests exercise the RLS + column-grant layer the way PostgREST does:
-- SET ROLE authenticated + request.jwt.claims. Under SET ROLE, GRANTs and
-- RLS both apply exactly as they do for a real anon-key client — which is
-- the whole point (the exploits are direct-table writes around the RPCs).
-- Each exploit is wrapped so its expected failure doesn't abort the file.
-- One rolled-back transaction; nothing persists.
-- ============================================================================
BEGIN;

-- ---- Fixture (as postgres, RLS/grants bypassed) ----------------------------
INSERT INTO auth.users (instance_id, id, aud, role, email, raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'authz-alice@test.local', '{"username":"alice"}'),
  ('00000000-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'authz-bob@test.local',   '{"username":"bob"}'),
  ('00000000-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'authz-carol@test.local', '{"username":"carol"}');

-- Alice's game (Alice + Bob are members; Carol is an outsider)
INSERT INTO games (id, name, course_name, admin_id, max_players, game_type, status)
VALUES ('a3000000-0000-0000-0000-0000000000aa', 'Authz Game', 'Course', 'a3a3a3a3-0000-0000-0000-000000000001', 4, 'stroke_play', 'active');
INSERT INTO game_members (game_id, user_id, role) VALUES
  ('a3000000-0000-0000-0000-0000000000aa', 'a3a3a3a3-0000-0000-0000-000000000002', 'member');

-- A match (Alice creator; Alice + Bob players) with pending scores
INSERT INTO matches (id, game_id, created_by, course_name, match_date, status)
VALUES ('a3000000-0000-0000-0000-0000000000bb', 'a3000000-0000-0000-0000-0000000000aa', 'a3a3a3a3-0000-0000-0000-000000000001', 'Course', current_date, 'scheduled');
INSERT INTO match_players (match_id, user_id) VALUES
  ('a3000000-0000-0000-0000-0000000000bb', 'a3a3a3a3-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-0000000000bb', 'a3a3a3a3-0000-0000-0000-000000000002');
INSERT INTO scores (id, match_id, user_id, score, holes, status) VALUES
  ('a3000000-0000-0000-0000-0000000000c1', 'a3000000-0000-0000-0000-0000000000bb', 'a3a3a3a3-0000-0000-0000-000000000001', 80, 18, 'pending'),
  ('a3000000-0000-0000-0000-0000000000c2', 'a3000000-0000-0000-0000-0000000000bb', 'a3a3a3a3-0000-0000-0000-000000000002', 88, 18, 'pending');

-- A second match in the same game (Alice creator, only Alice a player)
INSERT INTO matches (id, game_id, created_by, course_name, match_date, status)
VALUES ('a3000000-0000-0000-0000-0000000000dd', 'a3000000-0000-0000-0000-0000000000aa', 'a3a3a3a3-0000-0000-0000-000000000001', 'Course', current_date, 'scheduled');
INSERT INTO match_players (match_id, user_id) VALUES
  ('a3000000-0000-0000-0000-0000000000dd', 'a3a3a3a3-0000-0000-0000-000000000001');

-- ---- helper: become an authenticated user -----------------------------------
-- (SET ROLE + JWT claims mirror PostgREST; RESET ROLE returns to postgres.)

-- === AUD#1: Bob cannot approve his own score by direct UPDATE ================
DO $$
DECLARE v_status text;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-0000-0000-0000-000000000002","role":"authenticated"}', true);
  BEGIN
    UPDATE scores SET status = 'approved', approved_by = 'a3a3a3a3-0000-0000-0000-000000000002'
    WHERE id = 'a3000000-0000-0000-0000-0000000000c2';
    -- If the grant is correct this raises 42501 before reaching a row.
    RAISE EXCEPTION 'AUD#1 FAIL: self-approval UPDATE was not rejected';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- expected: no column grant on status
  END;
  RESET ROLE;

  SELECT status INTO v_status FROM scores WHERE id = 'a3000000-0000-0000-0000-0000000000c2';
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'AUD#1 FAIL: score status changed to %', v_status;
  END IF;
  RAISE NOTICE 'AUD#1 PASS: direct self-approval rejected (column grant)';
END;
$$;
RESET ROLE;

-- === AUD#1b: editing a score resets ITS OWN approval too =====================
DO $$
BEGIN
  -- Pre-approve both scores as the system, then Bob edits his score value.
  UPDATE scores SET status = 'approved' WHERE match_id = 'a3000000-0000-0000-0000-0000000000bb';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-0000-0000-0000-000000000002","role":"authenticated"}', true);
  UPDATE scores SET score = 70 WHERE id = 'a3000000-0000-0000-0000-0000000000c2';
  RESET ROLE;

  IF EXISTS (SELECT 1 FROM scores WHERE match_id = 'a3000000-0000-0000-0000-0000000000bb' AND status = 'approved') THEN
    RAISE EXCEPTION 'AUD#1b FAIL: an approved score survived an edit in the same match';
  END IF;
  RAISE NOTICE 'AUD#1b PASS: score edit resets the edited row''s own approval';
END;
$$;
RESET ROLE;
-- restore pending for later cleanliness
UPDATE scores SET status = 'pending' WHERE match_id = 'a3000000-0000-0000-0000-0000000000bb';

-- === AUD#2: email column is not readable by an authenticated client =========
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-0000-0000-0000-000000000002","role":"authenticated"}', true);
  BEGIN
    PERFORM email FROM profiles WHERE id = 'a3a3a3a3-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'AUD#2 FAIL: profiles.email was readable';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- expected: no SELECT grant on email
  END;
  -- but display fields still work
  PERFORM username FROM profiles WHERE id = 'a3a3a3a3-0000-0000-0000-000000000001';
  RESET ROLE;
  RAISE NOTICE 'AUD#2 PASS: email hidden, display fields readable';
END;
$$;
RESET ROLE;

-- === AUD#2b: anon has no table access at all =================================
DO $$
BEGIN
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM profiles LIMIT 1;
    RAISE EXCEPTION 'AUD#2b FAIL: anon could read profiles';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- expected
  END;
  RESET ROLE;
  RAISE NOTICE 'AUD#2b PASS: anon has no table DML';
END;
$$;
RESET ROLE;

-- === AUD#3: Carol (outsider) gets empty stats for Alice ======================
DO $$
DECLARE v_records jsonb; v_courses int; v_trend jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-0000-0000-0000-000000000003","role":"authenticated"}', true);

  v_records := get_profile_records('a3a3a3a3-0000-0000-0000-000000000001');
  IF v_records->'best_score' <> 'null'::jsonb OR (v_records->>'longest_streak_weeks') <> '0' THEN
    RAISE EXCEPTION 'AUD#3 FAIL: outsider read Alice records: %', v_records;
  END IF;

  SELECT count(*) INTO v_courses FROM get_profile_courses('a3a3a3a3-0000-0000-0000-000000000001');
  IF v_courses <> 0 THEN
    RAISE EXCEPTION 'AUD#3 FAIL: outsider read % course rows', v_courses;
  END IF;

  v_trend := get_profile_score_trend('a3a3a3a3-0000-0000-0000-000000000001', 'recent');
  IF (v_trend->>'total_rounds') <> '0' THEN
    RAISE EXCEPTION 'AUD#3 FAIL: outsider read Alice trend: %', v_trend;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'AUD#3 PASS: outsider gets empty profile stats';
END;
$$;
RESET ROLE;

-- === AUD#3b: Bob (game-mate) still sees Alice's stats ========================
DO $$
DECLARE v_courses int;
BEGIN
  -- Give Alice an approved score so a course row exists
  UPDATE scores SET status = 'approved' WHERE id = 'a3000000-0000-0000-0000-0000000000c1';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-0000-0000-0000-000000000002","role":"authenticated"}', true);
  SELECT count(*) INTO v_courses FROM get_profile_courses('a3a3a3a3-0000-0000-0000-000000000001');
  RESET ROLE;

  IF v_courses < 1 THEN
    RAISE EXCEPTION 'AUD#3b FAIL: game-mate could not read shared-game player stats';
  END IF;
  RAISE NOTICE 'AUD#3b PASS: game-mate retains visibility';
END;
$$;
RESET ROLE;
UPDATE scores SET status = 'pending' WHERE id = 'a3000000-0000-0000-0000-0000000000c1';

-- === AUD#5: Carol cannot self-insert into a match ============================
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-0000-0000-0000-000000000003","role":"authenticated"}', true);
  BEGIN
    INSERT INTO match_players (match_id, user_id)
    VALUES ('a3000000-0000-0000-0000-0000000000dd', 'a3a3a3a3-0000-0000-0000-000000000003');
    RAISE EXCEPTION 'AUD#5 FAIL: outsider self-inserted into a match';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- RLS WITH CHECK rejects
  END;
  RESET ROLE;
  RAISE NOTICE 'AUD#5 PASS: outsider match self-insert rejected';
END;
$$;
RESET ROLE;

-- === AUD#5b: even Bob (game member, not creator) cannot self-insert =========
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a3a3a3a3-0000-0000-0000-000000000002","role":"authenticated"}', true);
  BEGIN
    INSERT INTO match_players (match_id, user_id)
    VALUES ('a3000000-0000-0000-0000-0000000000dd', 'a3a3a3a3-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'AUD#5b FAIL: non-creator game member self-inserted into a match';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- only the creator may insert
  END;
  RESET ROLE;
  RAISE NOTICE 'AUD#5b PASS: non-creator match self-insert rejected';
END;
$$;
RESET ROLE;

-- === AUD#10: the player cap holds (trigger raises on the 5th) ================
DO $$
DECLARE v_full uuid := 'a3000000-0000-0000-0000-0000000000bb';
BEGIN
  -- Match bb already has 2 players; add up to 4 as the creator (Alice),
  -- then the 5th must raise.
  INSERT INTO game_members (game_id, user_id) VALUES
    ('a3000000-0000-0000-0000-0000000000aa', 'a3a3a3a3-0000-0000-0000-000000000003');
  INSERT INTO matches (id, game_id, created_by, course_name, match_date)
  VALUES ('a3000000-0000-0000-0000-0000000000ee', 'a3000000-0000-0000-0000-0000000000aa', 'a3a3a3a3-0000-0000-0000-000000000001', 'Course', current_date);
  INSERT INTO match_players (match_id, user_id) VALUES
    ('a3000000-0000-0000-0000-0000000000ee', 'a3a3a3a3-0000-0000-0000-000000000001'),
    ('a3000000-0000-0000-0000-0000000000ee', 'a3a3a3a3-0000-0000-0000-000000000002'),
    ('a3000000-0000-0000-0000-0000000000ee', 'a3a3a3a3-0000-0000-0000-000000000003');
  -- 4th ok (a synthetic 4th user)
  INSERT INTO auth.users (instance_id, id, aud, role, email)
  VALUES ('00000000-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'authz-dave@test.local');
  INSERT INTO game_members (game_id, user_id) VALUES ('a3000000-0000-0000-0000-0000000000aa', 'a3a3a3a3-0000-0000-0000-000000000004');
  INSERT INTO match_players (match_id, user_id) VALUES ('a3000000-0000-0000-0000-0000000000ee', 'a3a3a3a3-0000-0000-0000-000000000004');
  BEGIN
    INSERT INTO auth.users (instance_id, id, aud, role, email)
    VALUES ('00000000-0000-0000-0000-000000000000', 'a3a3a3a3-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'authz-erin@test.local');
    INSERT INTO match_players (match_id, user_id) VALUES ('a3000000-0000-0000-0000-0000000000ee', 'a3a3a3a3-0000-0000-0000-000000000005');
    RAISE EXCEPTION 'AUD#10 FAIL: 5th player accepted';
  EXCEPTION
    WHEN raise_exception THEN NULL; -- 'Match is full (maximum 4 players)'
  END;
  RAISE NOTICE 'AUD#10 PASS: 5th player rejected by cap trigger';
END;
$$;

ROLLBACK;
