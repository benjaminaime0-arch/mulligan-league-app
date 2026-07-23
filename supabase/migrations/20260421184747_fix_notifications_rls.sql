-- ============================================================
-- CRITICAL: Close RLS hole on notifications INSERT
-- ============================================================
-- The original add_notifications_system.sql created this policy:
--   CREATE POLICY "System can insert notifications"
--     ON notifications FOR INSERT WITH CHECK (true);
--
-- This allowed ANY authenticated client to insert notifications
-- for ANY user_id (e.g. phishing/spoofing). SECURITY DEFINER
-- trigger functions bypass RLS by design, so the permissive
-- policy was never needed. This migration replaces it with a
-- restrictive policy that blocks all direct client INSERTs
-- while preserving trigger-based inserts.
-- ============================================================

DROP POLICY IF EXISTS "System can insert notifications" ON notifications;

CREATE POLICY "Block direct client inserts on notifications"
  ON notifications FOR INSERT
  WITH CHECK (false);

-- Verify: try inserting as a regular user — should fail.
-- The SECURITY DEFINER trigger functions (notify_score_submitted,
-- notify_score_approved, notify_match_completed, notify_league_member_joined,
-- notify_match_player_added) continue to work because they run with
-- elevated privileges that bypass RLS.
