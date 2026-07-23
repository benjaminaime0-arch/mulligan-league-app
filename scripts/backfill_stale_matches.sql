-- ============================================================================
-- Backfill: resolve matches stuck by the dead 24h auto-validation (T0.1)
-- ============================================================================
-- Prod state on 2026-07-23: zero pending scores exist; the stuck entities are
-- 6 matches (Apr 25 – May 10) still status='scheduled' with ZERO scores, zero
-- approvals, last_edit_at NULL — scheduled outings that were never played.
-- Completing them would fabricate results; the correct resolution is
-- void-with-notice: cancel, and tell each affected member once (not per row).
--
-- The script is generic, not a hardcoded list of 6 ids:
--   A. Any pending score stale >24h  → resolved by auto_approve_stale_scores()
--      (the repaired cron function — migration 20260723160000 must be applied
--      first; today this set is empty, the call is a no-op safety net).
--   B. Any scheduled/in_progress match dated >7 days ago (Europe/Paris) with
--      zero recorded scores → status='cancelled' + one aggregate notification
--      per affected member.
--
-- DRY RUN CONTRACT
--   Running this file as-is only reports (PART 1) and the DO block exits
--   before writing. To apply, run inside one transaction:
--
--     BEGIN;
--     SET LOCAL mulligan.backfill_apply = 'on';
--     \i scripts/backfill_stale_matches.sql
--     COMMIT;  -- or ROLLBACK after reviewing the notices
--
-- Safe to re-run: the predicates exclude already-cancelled matches, and
-- notifications are only written for matches cancelled in the same run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1 — REPORT (read-only)
-- ----------------------------------------------------------------------------
SELECT
  m.id,
  m.status,
  m.match_date,
  g.name AS game_name,
  (SELECT count(*) FROM scores s WHERE s.match_id = m.id)             AS scores_total,
  (SELECT count(*) FROM scores s
    WHERE s.match_id = m.id AND s.status = 'pending'
      AND COALESCE(m.last_edit_at, s.created_at) < now() - interval '24 hours') AS scores_stale_pending,
  CASE
    WHEN EXISTS (SELECT 1 FROM scores s
                  WHERE s.match_id = m.id AND s.status = 'pending'
                    AND COALESCE(m.last_edit_at, s.created_at) < now() - interval '24 hours')
      THEN 'A: auto-approve + complete'
    WHEN NOT EXISTS (SELECT 1 FROM scores s WHERE s.match_id = m.id)
         AND m.match_date < (now() AT TIME ZONE 'Europe/Paris')::date - 7
      THEN 'B: cancel (never played)'
    ELSE 'untouched'
  END AS resolution
FROM matches m
JOIN games g ON g.id = m.game_id
WHERE m.status IN ('scheduled', 'in_progress')
  AND m.match_date < (now() AT TIME ZONE 'Europe/Paris')::date
ORDER BY m.match_date;

-- ----------------------------------------------------------------------------
-- PART 2 — APPLY (no-op unless mulligan.backfill_apply = 'on')
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_cancelled  uuid[];
  v_notified   int;
BEGIN
  IF COALESCE(current_setting('mulligan.backfill_apply', true), '') IS DISTINCT FROM 'on' THEN
    RAISE NOTICE 'DRY RUN — no writes. To apply: SET LOCAL mulligan.backfill_apply = ''on'' inside a transaction.';
    RETURN;
  END IF;

  -- A. Stale pending scores: delegate to the repaired cron function so the
  -- backfill and the steady-state path can never diverge.
  PERFORM auto_approve_stale_scores();

  -- B. Never-played matches older than 7 days (Europe/Paris) → cancelled.
  -- scheduled→cancelled is a permitted transition for the immutability
  -- trigger; no system gate needed, but auto_approve_stale_scores() above
  -- already set it for this transaction anyway.
  WITH cancelled AS (
    UPDATE matches m
    SET status = 'cancelled'
    WHERE m.status IN ('scheduled', 'in_progress')
      AND m.match_date < (now() AT TIME ZONE 'Europe/Paris')::date - 7
      AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.match_id = m.id)
    RETURNING m.id
  )
  SELECT array_agg(id) INTO v_cancelled FROM cancelled;

  IF v_cancelled IS NULL THEN
    RAISE NOTICE 'Backfill: no matches to cancel; stale-pending pass ran.';
    RETURN;
  END IF;

  -- One aggregate notification per affected member — never one per match.
  WITH affected AS (
    SELECT mp.user_id, count(*) AS n
    FROM match_players mp
    WHERE mp.match_id = ANY (v_cancelled)
    GROUP BY mp.user_id
  )
  INSERT INTO notifications (user_id, type, title, body, data)
  SELECT
    a.user_id,
    'match_cancelled',
    'Old matches cancelled',
    a.n || CASE WHEN a.n = 1 THEN ' scheduled match' ELSE ' scheduled matches' END
        || ' with no recorded scores ' || CASE WHEN a.n = 1 THEN 'was' ELSE 'were' END
        || ' cancelled to keep your games current. Standings are unaffected.',
    jsonb_build_object('match_ids', to_jsonb(v_cancelled), 'reason', 'auto_validation_backfill')
  FROM affected a;

  GET DIAGNOSTICS v_notified = ROW_COUNT;
  RAISE NOTICE 'Backfill: cancelled % match(es), notified % member(s).',
    array_length(v_cancelled, 1), v_notified;
END;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICATION (after COMMIT)
-- ----------------------------------------------------------------------------
-- Must return zero rows:
--   SELECT id, status, match_date FROM matches
--   WHERE status IN ('scheduled','in_progress')
--     AND match_date < (now() AT TIME ZONE 'Europe/Paris')::date - 7
--     AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.match_id = matches.id);
--
-- Must return zero:
--   SELECT count(*) FROM scores s JOIN matches m ON m.id = s.match_id
--   WHERE s.status = 'pending'
--     AND COALESCE(m.last_edit_at, s.created_at) < now() - interval '24 hours';
--
-- Notices delivered (one per member, not per match):
--   SELECT user_id, title, created_at FROM notifications
--   WHERE type = 'match_cancelled' ORDER BY created_at DESC;
-- ============================================================================
