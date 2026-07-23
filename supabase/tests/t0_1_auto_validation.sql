-- ============================================================================
-- T0.1 regression tests — 24h auto-validation pipeline
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Runs as postgres (RLS bypassed — these tests exercise triggers and the
-- maintenance functions, not policies; policy tests live with T0.3).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- The whole file is one rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

-- Fixed ids so failures are readable
-- Users must exist in auth.users (profiles.id FKs it); handle_new_user
-- creates the profiles rows.
INSERT INTO auth.users (instance_id, id, aud, role, email)
VALUES
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 't01-player-a@test.local'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 't01-player-b@test.local');

-- A game with A as admin (direct inserts; RPC surface is covered elsewhere)
INSERT INTO games (id, name, course_name, admin_id, max_players, game_type, status)
VALUES ('33333333-3333-3333-3333-333333333333', 'T0.1 Test Game', 'Test Course', '11111111-1111-1111-1111-111111111111', 4, 'stroke_play', 'active');
-- auto_add_game_admin_to_members added A; add B
INSERT INTO game_members (game_id, user_id, role)
VALUES ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'member');

-- ----------------------------------------------------------------------------
-- T1: a match idle >24h with pending scores auto-validates end to end
-- ----------------------------------------------------------------------------
INSERT INTO matches (id, game_id, created_by, course_name, match_date, status)
VALUES ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Test Course', current_date - 3, 'scheduled');
INSERT INTO match_players (match_id, user_id) VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222');
INSERT INTO scores (match_id, user_id, score, holes, status) VALUES
  ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', 85, 18, 'pending'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 90, 18, 'pending');
-- Freeze the activity clock past the window (bump trigger set it to now())
UPDATE matches SET last_edit_at = now() - interval '25 hours'
WHERE id = '44444444-4444-4444-4444-444444444444';

-- The exact statement pg_cron runs — before the fix this raised
-- check_violation ('Match status can only become completed…')
SELECT auto_approve_stale_scores();

DO $$
DECLARE
  v_pending int;
  v_status  text;
  v_unapproved_players int;
BEGIN
  SELECT count(*) INTO v_pending FROM scores
  WHERE match_id = '44444444-4444-4444-4444-444444444444' AND status <> 'approved';
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: % score(s) not approved after auto_approve_stale_scores()', v_pending;
  END IF;

  SELECT status INTO v_status FROM matches WHERE id = '44444444-4444-4444-4444-444444444444';
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'T1 FAIL: match status is %, expected completed', v_status;
  END IF;

  SELECT count(*) INTO v_unapproved_players FROM match_players
  WHERE match_id = '44444444-4444-4444-4444-444444444444' AND approved_at IS NULL;
  IF v_unapproved_players <> 0 THEN
    RAISE EXCEPTION 'T1 FAIL: % match_players left unapproved', v_unapproved_players;
  END IF;

  -- Auto-validated scores are marked by approved_by IS NULL + approved_at set
  IF EXISTS (SELECT 1 FROM scores
             WHERE match_id = '44444444-4444-4444-4444-444444444444'
               AND (approved_at IS NULL OR approved_by IS NOT NULL)) THEN
    RAISE EXCEPTION 'T1 FAIL: auto-approved scores must have approved_at set and approved_by NULL';
  END IF;

  RAISE NOTICE 'T1 PASS: stale pending match auto-validated';
END;
$$;

-- ----------------------------------------------------------------------------
-- T2: recent activity keeps the confirmation window open
-- ----------------------------------------------------------------------------
INSERT INTO matches (id, game_id, created_by, course_name, match_date, status)
VALUES ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Test Course', current_date - 3, 'scheduled');
INSERT INTO match_players (match_id, user_id) VALUES
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111'),
  ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222');
-- Old submission (created_at back-dated) but the match was edited 1h ago:
INSERT INTO scores (match_id, user_id, score, holes, status, created_at) VALUES
  ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 82, 18, 'pending', now() - interval '30 hours');
UPDATE matches SET last_edit_at = now() - interval '1 hour'
WHERE id = '55555555-5555-5555-5555-555555555555';

SELECT auto_approve_stale_scores();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM scores
             WHERE match_id = '55555555-5555-5555-5555-555555555555' AND status = 'approved') THEN
    RAISE EXCEPTION 'T2 FAIL: score approved despite match activity 1h ago (window must follow last_edit_at)';
  END IF;
  RAISE NOTICE 'T2 PASS: recent edit keeps the 24h window open';
END;
$$;

-- ----------------------------------------------------------------------------
-- T3: without the system gate, completion is still blocked (security property)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    -- No trigger depth, no admin (auth.uid() is NULL here), no GUC in this
    -- transaction?  The GUC IS set transaction-locally by the T1/T2 calls
    -- above — so isolate: reset it first.
    PERFORM set_config('mulligan.system_update', '', true);
    UPDATE matches SET status = 'completed'
    WHERE id = '55555555-5555-5555-5555-555555555555';
    RAISE EXCEPTION 'T3 FAIL: direct completion succeeded without admin/system gate';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'T3 PASS: non-system completion still raises check_violation';
  END;
END;
$$;

-- ----------------------------------------------------------------------------
-- T4: auto_complete_stale_matches completes an idle match that has scores
-- ----------------------------------------------------------------------------
-- Reuse T2's match: approve its score via the normal (trigger-depth) path is
-- out of scope here; set it directly, then age the match.
UPDATE scores SET status = 'approved', approved_at = now()
WHERE match_id = '55555555-5555-5555-5555-555555555555';
UPDATE matches SET status = 'in_progress', last_edit_at = now() - interval '26 hours'
WHERE id = '55555555-5555-5555-5555-555555555555';

SELECT * FROM auto_complete_stale_matches();

DO $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM matches WHERE id = '55555555-5555-5555-5555-555555555555';
  IF v_status <> 'completed' THEN
    RAISE EXCEPTION 'T4 FAIL: stale match with scores is %, expected completed', v_status;
  END IF;
  RAISE NOTICE 'T4 PASS: auto_complete_stale_matches unblocked';
END;
$$;

ROLLBACK;
