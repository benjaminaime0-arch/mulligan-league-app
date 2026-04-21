-- ============================================================
-- Close INSERT hole on activity_events
-- ============================================================
-- The original policy in add_activity_events.sql:40-42 was:
--   CREATE POLICY "Authenticated users can insert activity"
--     ON activity_events FOR INSERT
--     WITH CHECK (auth.uid() IS NOT NULL);
--
-- This let ANY authenticated user insert activity events for
-- ANY league — they could fabricate "player X approved scores"
-- entries against leagues they have no relationship with, to
-- deceive admins and corrupt the audit trail.
--
-- All legitimate activity inserts happen via SECURITY DEFINER
-- triggers (fn_activity_player_joined_league, fn_activity_match_created,
-- fn_activity_score_approved). Those bypass RLS by design, so
-- blocking direct client INSERTs breaks nothing.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can insert activity" ON activity_events;

CREATE POLICY "Block direct client inserts on activity_events"
  ON activity_events FOR INSERT
  WITH CHECK (false);

-- Verification: try as an authenticated user
--   INSERT INTO activity_events (event_type, league_id, actor_id, metadata)
--   VALUES ('player_joined_league', 'some-uuid', auth.uid(), '{}'::jsonb);
-- → expected: "new row violates row-level security policy"
--
-- Then verify triggers still fire: add a league_member or insert a match.
-- activity_events should still populate normally.
