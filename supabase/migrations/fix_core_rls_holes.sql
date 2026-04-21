-- ============================================================
-- Tighten core table RLS — close 2 HIGH and 2 MEDIUM holes
-- ============================================================
-- Run AFTER the baseline_core_policies.sql is in place.
--
-- Findings addressed:
--   🔴 HIGH   league_members INSERT lets anyone self-join any league
--             (bypasses the join_requests admin-approval flow)
--   🔴 HIGH   matches_update_creator lets creator change any column
--             including status='completed' and league_id
--   🟠 MED    Dead SELECT policy on matches (shadowed by matches_select_all)
--   🟠 MED    Dead UPDATE policy on matches (shadowed by matches_update_creator)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Auto-add admin to league_members on league creation
-- ------------------------------------------------------------
-- Without this, step 2 (locking INSERT) would break league
-- creation because the client currently inserts the admin as a
-- league_member right after creating the league. This trigger
-- makes that client insert unnecessary (and idempotent — the
-- client insert, if still present, hits ON CONFLICT DO NOTHING).

CREATE OR REPLACE FUNCTION auto_add_league_admin_to_members()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.admin_id IS NOT NULL THEN
    INSERT INTO league_members (league_id, user_id, role)
    VALUES (NEW.id, NEW.admin_id, 'admin')
    ON CONFLICT (league_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_add_league_admin ON leagues;
CREATE TRIGGER trg_auto_add_league_admin
  AFTER INSERT ON leagues
  FOR EACH ROW
  EXECUTE FUNCTION auto_add_league_admin_to_members();

-- Backfill: any existing leagues whose admin isn't a member yet.
-- Safe to re-run (ON CONFLICT DO NOTHING).
INSERT INTO league_members (league_id, user_id, role)
SELECT id, admin_id, 'admin'
FROM leagues
WHERE admin_id IS NOT NULL
ON CONFLICT (league_id, user_id) DO NOTHING;

-- ------------------------------------------------------------
-- 2. Block direct client INSERT on league_members
-- ------------------------------------------------------------
-- All joins must flow through:
--   request_join_league → admin approves → approve_join_request RPC
-- The RPCs are SECURITY DEFINER and bypass RLS by design.
-- Admin self-join is handled by the trigger above.

DROP POLICY IF EXISTS league_members_insert ON league_members;

CREATE POLICY league_members_insert_blocked
  ON league_members FOR INSERT
  WITH CHECK (false);

-- ------------------------------------------------------------
-- 3. Prevent match creator from changing immutable columns
-- ------------------------------------------------------------
-- Creator can edit presentation fields (course_name, match_date,
-- match_time, invite_code). They CANNOT change:
--   - status (force-complete a match)
--   - league_id (move a match to a different league)
--   - period_id (reassign to a different period)
--   - created_by (hand off ownership)
--   - match_type (flip league ↔ casual)
-- League admin bypasses all of these.
-- System triggers (e.g. check_match_completion) run inside
-- another trigger (pg_trigger_depth > 1) and are allowed through.

CREATE OR REPLACE FUNCTION enforce_match_creator_field_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- Called from within another trigger's UPDATE → system change, allow
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- League admin of this match's league → allow all
  IF NEW.league_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = NEW.league_id AND l.admin_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  -- Creator (or any other non-admin path) → enforce immutable columns
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'Match status can only change via the score-approval flow'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.league_id IS DISTINCT FROM NEW.league_id THEN
    RAISE EXCEPTION 'Match league cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.period_id IS DISTINCT FROM NEW.period_id THEN
    RAISE EXCEPTION 'Match period cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'Match creator cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.match_type IS DISTINCT FROM NEW.match_type THEN
    RAISE EXCEPTION 'Match type cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_match_creator_immutability ON matches;
CREATE TRIGGER trg_enforce_match_creator_immutability
  BEFORE UPDATE ON matches
  FOR EACH ROW
  EXECUTE FUNCTION enforce_match_creator_field_immutability();

-- ------------------------------------------------------------
-- 4. Drop dead/shadowed policies on matches
-- ------------------------------------------------------------
-- matches_select_all USING(true) fully shadows "Users can view
-- matches they participate in" (any OR true = true). Keeping
-- the narrower one around creates the illusion of participant-
-- gating when in fact the broad policy serves the rows anyway.

DROP POLICY IF EXISTS "Users can view matches they participate in" ON matches;

-- matches_update_creator lets the creator update any match they
-- made. "Creators can update their casual matches" is strictly
-- narrower and never the binding policy — drop it.
DROP POLICY IF EXISTS "Creators can update their casual matches" ON matches;

-- ============================================================
-- Verification checklist (run manually after applying)
-- ============================================================
-- 1. Create a new league as user A
--    → expect: league_members row auto-created with role='admin'
-- 2. As user B, try:
--      INSERT INTO league_members (league_id, user_id) VALUES ('<A_league>', auth.uid());
--    → expect: RLS violation
-- 3. As user B, go through request_join_league + user A approves
--    → expect: league_members row appears (via SECURITY DEFINER)
-- 4. As match creator user A, try:
--      UPDATE matches SET status = 'completed' WHERE id = '<my_match>';
--    → expect: "Match status can only change via the score-approval flow"
-- 5. As match creator user A:
--      UPDATE matches SET course_name = 'New Course' WHERE id = '<my_match>';
--    → expect: success
-- 6. Submit + approve all scores in the match
--    → expect: status → 'completed' via check_match_completion trigger
--             (pg_trigger_depth > 1 allows through)
-- ============================================================
