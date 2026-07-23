-- ============================================================
-- Auto-complete matches 24h after last edit
-- ============================================================
-- Rule: a match completes when EITHER
--   (a) everyone approves (handled by existing check_match_completion
--       trigger on scores.status → 'approved'), OR
--   (b) 24 hours pass without any score edit (this file)
--
-- Design:
--   - Track last_edit_at on matches (column).
--   - Trigger on scores INSERT/UPDATE bumps matches.last_edit_at.
--   - Scheduled job (pg_cron) runs every 15 min and completes
--     matches where last_edit_at < now() - interval '24 hours'
--     AND at least one score exists AND status != 'completed'.
--
-- Requires: pg_cron extension. Supabase enables it on most plans
-- (Database → Extensions → pg_cron). If you can't enable it,
-- swap step 3 for a Supabase Edge Function + scheduled trigger.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Track last_edit_at on matches
-- ------------------------------------------------------------

ALTER TABLE matches ADD COLUMN IF NOT EXISTS last_edit_at TIMESTAMPTZ;

-- Backfill: set last_edit_at to the latest score's created_at, or now() if
-- there are no scores yet. Prevents existing matches from immediately
-- auto-completing on the first cron tick.
UPDATE matches
SET last_edit_at = COALESCE(
  (SELECT MAX(s.created_at) FROM scores s WHERE s.match_id = matches.id),
  now()
)
WHERE last_edit_at IS NULL;

-- ------------------------------------------------------------
-- 2. Trigger: bump last_edit_at when scores change
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION bump_match_last_edit_at()
RETURNS TRIGGER AS $$
DECLARE
  v_match_id UUID;
BEGIN
  v_match_id := COALESCE(NEW.match_id, OLD.match_id);

  UPDATE matches
  SET last_edit_at = now()
  WHERE id = v_match_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_bump_match_last_edit ON scores;
CREATE TRIGGER trg_bump_match_last_edit
  AFTER INSERT OR UPDATE OR DELETE ON scores
  FOR EACH ROW
  EXECUTE FUNCTION bump_match_last_edit_at();

-- ------------------------------------------------------------
-- 3. Function: auto-complete stale matches
-- ------------------------------------------------------------
-- Runs as SECURITY DEFINER so the status update bypasses the RLS
-- immutability trigger (pg_trigger_depth() will be > 1 anyway if
-- called from cron's trigger context, but SECURITY DEFINER is
-- defense in depth).

CREATE OR REPLACE FUNCTION auto_complete_stale_matches()
RETURNS TABLE (completed_match_id UUID) AS $$
BEGIN
  RETURN QUERY
  UPDATE matches m
  SET status = 'completed'
  WHERE m.status IN ('scheduled', 'in_progress')
    AND m.last_edit_at IS NOT NULL
    AND m.last_edit_at < now() - interval '24 hours'
    AND EXISTS (
      SELECT 1 FROM scores s WHERE s.match_id = m.id
    )
  RETURNING m.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Schedule via pg_cron (every 15 minutes)
-- ------------------------------------------------------------
-- If pg_cron isn't available in your Supabase plan, comment this
-- section out and call auto_complete_stale_matches() from a
-- Supabase Edge Function scheduled via Database Webhooks / cron.

-- Enable extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any previous schedule of the same job
DO $$
BEGIN
  PERFORM cron.unschedule('mulligan_auto_complete_stale_matches')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'mulligan_auto_complete_stale_matches'
  );
END $$;

SELECT cron.schedule(
  'mulligan_auto_complete_stale_matches',
  '*/15 * * * *',  -- every 15 min
  $$SELECT auto_complete_stale_matches();$$
);

-- ------------------------------------------------------------
-- Verification
-- ------------------------------------------------------------
-- 1. Create a match, submit a score, wait 24h (or manually update
--    last_edit_at to now() - interval '25 hours')
--      UPDATE matches SET last_edit_at = now() - interval '25 hours'
--      WHERE id = '<match_id>';
--    Wait for the next cron tick (≤15 min) or run:
--      SELECT auto_complete_stale_matches();
--    → expect: status = 'completed'
-- 2. Check cron is scheduled:
--      SELECT * FROM cron.job WHERE jobname = 'mulligan_auto_complete_stale_matches';
-- 3. View runs:
--      SELECT * FROM cron.job_run_details
--      WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'mulligan_auto_complete_stale_matches')
--      ORDER BY start_time DESC LIMIT 10;
-- ============================================================
