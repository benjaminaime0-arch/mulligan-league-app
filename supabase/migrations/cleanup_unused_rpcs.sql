-- ============================================================
-- Cleanup: drop RPCs that no longer have any frontend callers
-- ============================================================
-- `get_profile_week` was the backing RPC for the old
-- `components/profile/WeekCalendarCard.tsx`, which powered the
-- profile page's 7-day calendar strip. That component was replaced
-- with the shared `MatchCalendarSection` (which pulls full match
-- rosters + leagues directly via standard queries), so the RPC is
-- now orphaned.
--
-- Safe to re-run: `DROP FUNCTION IF EXISTS` is a no-op when absent.
-- ============================================================

DROP FUNCTION IF EXISTS get_profile_week(UUID);
