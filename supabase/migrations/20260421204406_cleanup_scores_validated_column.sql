-- ============================================================
-- Drop unused scores.validated column
-- ============================================================
-- Legacy boolean from an earlier scoring design. No code paths
-- read or write it:
--   $ grep -rn "validated" src/                 → 0 hits
--   $ grep -rn "validated" supabase/migrations/ → 0 hits
-- The current approval flow uses scores.status ('pending' |
-- 'approved'). If the DROP errors because a VIEW or FUNCTION in
-- the Dashboard references `validated`, investigate before
-- forcing the drop.
-- ============================================================

ALTER TABLE scores DROP COLUMN IF EXISTS validated;
