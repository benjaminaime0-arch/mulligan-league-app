-- ============================================================
-- Remove the shadow activity_log system
-- ============================================================
-- Background: the app tracks activity through the activity_events
-- table (see add_activity_events.sql, read by get_activity_feed
-- RPC, shown in the /profile activity carousel).
--
-- There was a parallel, older activity_log table written to by two
-- Dashboard-authored trigger functions. Nothing in the app reads
-- from activity_log — it was dead writes on every match create and
-- every score insert, doubling DB work for zero user value.
--
-- Verified unused:
--   $ grep -rn activity_log src/                 → 0 hits
--   $ grep -rn activity_log supabase/migrations/ → only the body
--     of on_match_created / on_score_submitted (which we're dropping)
--
-- After this migration, the only activity system is activity_events.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Drop triggers that call the dead functions
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS on_match_insert ON public.matches;
DROP TRIGGER IF EXISTS on_score_insert ON public.scores;

-- ------------------------------------------------------------
-- 2. Drop the dead functions
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.on_match_created();
DROP FUNCTION IF EXISTS public.on_score_submitted();

-- ------------------------------------------------------------
-- 3. Drop the table
-- ------------------------------------------------------------
-- CASCADE covers any incidental policies/indexes attached to it.
-- Safe because we've already confirmed nothing reads from it.

DROP TABLE IF EXISTS public.activity_log CASCADE;

-- ------------------------------------------------------------
-- Post-migration invariants
-- ------------------------------------------------------------
-- - check_match_completion + check_match_player_limit remain (they
--   are unrelated to activity_log — they gate match completion and
--   the 4-player cap respectively).
-- - activity_events and all its fn_activity_* triggers are untouched.
-- - Next match INSERT should only fire trg_activity_match_created
--   (writes to activity_events), not the now-deleted on_match_insert.
-- ============================================================
