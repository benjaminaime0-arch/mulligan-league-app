-- ============================================================================
-- T2.2 regression tests — solo practice rounds
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Covers migration 20260801110000_practice_rounds.sql:
--   T1  get_or_create_practice_game is lazy + idempotent (one per user)
--   T2  create_practice_match wires match + roster in one call
--   T3  containment: invisible to others (RLS), unjoinable (both join RPCs
--       answer exactly as if the game didn't exist)
--   T4  solo completion: approve_match_scores at 1/1 completes the match
--   T5  no Elo movement: rating_history stays empty (single-player match)
--   T6  inclusion: get_user_course_stats counts the practice round
--   T7  get_user_honors never surfaces the practice game
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- The whole file is one rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;
SET LOCAL search_path = public, extensions;

-- Fixed ids so failures are readable
INSERT INTO auth.users (instance_id, id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'a2220000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 't22-solo@test.local'),
  ('00000000-0000-0000-0000-000000000000', 'a2220000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 't22-outsider@test.local');

INSERT INTO courses (id, name, city, holes, par)
VALUES ('c2220000-0000-0000-0000-0000000000c1', 'T22 Practice Course', 'Testville', 18, 72);

-- ----------------------------------------------------------------------------
-- T1: lazy creation, idempotent — two calls, one game
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v1 json;
  v2 json;
  v_game games%ROWTYPE;
  v_members int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2220000-0000-0000-0000-000000000001","role":"authenticated"}', true);

  v1 := get_or_create_practice_game();
  v2 := get_or_create_practice_game();
  RESET ROLE;

  IF (v1->>'success')::boolean IS NOT TRUE OR (v2->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T1 FAIL: get_or_create_practice_game errored: % / %', v1, v2;
  END IF;
  IF v1->>'game_id' <> v2->>'game_id' THEN
    RAISE EXCEPTION 'T1 FAIL: second call minted a new practice game (% vs %)',
      v1->>'game_id', v2->>'game_id';
  END IF;

  SELECT * INTO v_game FROM games WHERE id = (v1->>'game_id')::uuid;
  IF NOT v_game.is_practice THEN
    RAISE EXCEPTION 'T1 FAIL: practice game not flagged is_practice';
  END IF;
  IF v_game.max_players IS DISTINCT FROM 1 OR v_game.status <> 'active' THEN
    RAISE EXCEPTION 'T1 FAIL: unexpected practice game shape (max_players=%, status=%)',
      v_game.max_players, v_game.status;
  END IF;

  -- auto_add_game_admin_to_members put the owner in; nobody else can be.
  SELECT count(*) INTO v_members FROM game_members WHERE game_id = v_game.id;
  IF v_members <> 1 THEN
    RAISE EXCEPTION 'T1 FAIL: practice game has % members, expected 1', v_members;
  END IF;

  RAISE NOTICE 'T1 PASS: practice game lazily created once (%)', v_game.id;
END;
$$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T2: create_practice_match — match + roster in one call
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v json;
  v_match matches%ROWTYPE;
  v_players int;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2220000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  v := create_practice_match('c2220000-0000-0000-0000-0000000000c1', NULL);
  RESET ROLE;

  IF (v->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T2 FAIL: create_practice_match: %', v;
  END IF;

  SELECT * INTO v_match FROM matches WHERE id = (v->>'match_id')::uuid;
  IF v_match.course_id IS DISTINCT FROM 'c2220000-0000-0000-0000-0000000000c1' THEN
    RAISE EXCEPTION 'T2 FAIL: course_id not carried onto the match';
  END IF;
  IF v_match.course_name <> 'T22 Practice Course' THEN
    RAISE EXCEPTION 'T2 FAIL: course_name is %, expected the course''s name', v_match.course_name;
  END IF;
  IF v_match.game_id IS DISTINCT FROM (v->>'game_id')::uuid THEN
    RAISE EXCEPTION 'T2 FAIL: match not attached to the practice game';
  END IF;

  SELECT count(*) INTO v_players FROM match_players WHERE match_id = v_match.id;
  IF v_players <> 1 THEN
    RAISE EXCEPTION 'T2 FAIL: % players on the practice match, expected 1', v_players;
  END IF;

  RAISE NOTICE 'T2 PASS: practice match created with solo roster (%)', v_match.id;
END;
$$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T3: containment — outsider can't see it or join it
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_practice_game uuid;
  v_code text;
  v_visible int;
  v_matches int;
  v json;
BEGIN
  SELECT id, invite_code INTO v_practice_game, v_code
  FROM games WHERE admin_id = 'a2220000-0000-0000-0000-000000000001' AND is_practice;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2220000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- RLS: the game and its match don't exist for the outsider.
  SELECT count(*) INTO v_visible FROM games WHERE id = v_practice_game;
  SELECT count(*) INTO v_matches FROM matches WHERE game_id = v_practice_game;

  -- Join by invite code: identical answer to a bogus code — no oracle.
  v := join_game_by_code(v_code);
  IF (v->>'success')::boolean IS TRUE OR v->>'error' <> 'Invalid invite code' THEN
    RESET ROLE;
    RAISE EXCEPTION 'T3 FAIL: join_game_by_code on a practice code returned %', v;
  END IF;

  -- Request-join by id: identical answer to a bogus id.
  v := request_join_game(v_practice_game);
  IF (v->>'success')::boolean IS TRUE OR v->>'error' <> 'Game not found' THEN
    RESET ROLE;
    RAISE EXCEPTION 'T3 FAIL: request_join_game on a practice game returned %', v;
  END IF;
  RESET ROLE;

  IF v_visible <> 0 THEN
    RAISE EXCEPTION 'T3 FAIL: outsider can SELECT the practice game';
  END IF;
  IF v_matches <> 0 THEN
    RAISE EXCEPTION 'T3 FAIL: outsider can SELECT the practice match';
  END IF;

  RAISE NOTICE 'T3 PASS: practice game invisible + unjoinable for others';
END;
$$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T4: solo completion — hole writes then approve at 1/1 completes
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_match uuid;
  v json;
  v_status text;
  v_score scores%ROWTYPE;
BEGIN
  SELECT m.id INTO v_match
  FROM matches m JOIN games g ON g.id = m.game_id
  WHERE g.is_practice AND g.admin_id = 'a2220000-0000-0000-0000-000000000001';

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2220000-0000-0000-0000-000000000001","role":"authenticated"}', true);

  v := upsert_score_hole(v_match, 'a2220000-0000-0000-0000-000000000001', 1, 4);
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RESET ROLE;
    RAISE EXCEPTION 'T4 FAIL: upsert_score_hole h1: %', v;
  END IF;
  v := upsert_score_hole(v_match, 'a2220000-0000-0000-0000-000000000001', 2, 5);
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RESET ROLE;
    RAISE EXCEPTION 'T4 FAIL: upsert_score_hole h2: %', v;
  END IF;

  -- The "Terminer la partie" path: sole player approves their own card.
  v := approve_match_scores(v_match);
  RESET ROLE;
  IF (v->>'success')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'T4 FAIL: approve_match_scores: %', v;
  END IF;

  SELECT status INTO v_status FROM matches WHERE id = v_match;
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'T4 FAIL: match status is %, expected completed at 1/1 approval', v_status;
  END IF;

  SELECT * INTO v_score FROM scores
  WHERE match_id = v_match AND user_id = 'a2220000-0000-0000-0000-000000000001';
  IF v_score.status <> 'approved' OR v_score.score <> 9 THEN
    RAISE EXCEPTION 'T4 FAIL: score row status=% score=% (expected approved / 9 = Σ holes)',
      v_score.status, v_score.score;
  END IF;

  RAISE NOTICE 'T4 PASS: solo approve completed the practice round';
END;
$$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T5: no Elo movement from a single-player match
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM rating_history rh
  WHERE rh.user_id IN ('a2220000-0000-0000-0000-000000000001',
                       'a2220000-0000-0000-0000-000000000002');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'T5 FAIL: % rating_history rows written for a solo round', v_n;
  END IF;
  RAISE NOTICE 'T5 PASS: no rating movement';
END;
$$;

-- ----------------------------------------------------------------------------
-- T6: inclusion — the practice round counts in course stats
-- ----------------------------------------------------------------------------
DO $$
DECLARE v jsonb;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    '{"sub":"a2220000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  v := get_user_course_stats('a2220000-0000-0000-0000-000000000001',
                             'c2220000-0000-0000-0000-0000000000c1');
  RESET ROLE;

  IF (v->>'visible')::boolean IS NOT TRUE OR (v->>'rounds')::int <> 1 THEN
    RAISE EXCEPTION 'T6 FAIL: course stats %, expected visible with 1 round', v;
  END IF;
  IF (v->>'best_gross')::int <> 9 THEN
    RAISE EXCEPTION 'T6 FAIL: best_gross %, expected 9', v->>'best_gross';
  END IF;
  RAISE NOTICE 'T6 PASS: practice round counted in course stats';
END;
$$;
RESET ROLE;

-- ----------------------------------------------------------------------------
-- T7: honors never surface the practice game
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n
  FROM get_user_honors('a2220000-0000-0000-0000-000000000001') h
  JOIN games g ON g.id = h.game_id
  WHERE g.is_practice;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'T7 FAIL: get_user_honors returned % practice-game badges', v_n;
  END IF;
  RAISE NOTICE 'T7 PASS: honors exclude the practice game';
END;
$$;

ROLLBACK;
