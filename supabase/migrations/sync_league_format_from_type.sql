-- ============================================================
-- Sync `leagues.format` from the existing `league_type` column
-- ============================================================
-- Back-story: `league_type` has been a free-form cosmetic string
-- (stroke_play, stableford, match_play, foursome, …) that the UI
-- displayed but nothing computed on. `format` is the new column
-- that actually drives leaderboard + badge math, constrained to
-- stroke_play | stableford for now.
--
-- To avoid breaking the existing create-league RPC signature, we
-- keep `p_league_type` as the user-facing input and mirror the two
-- supported values into `format` via a trigger. Everything outside
-- those two drops to stroke_play — safest default for legacy rows.
--
-- Backfill runs once for existing data; trigger handles new inserts
-- and updates going forward.
--
-- Safe to re-run.
-- ============================================================

-- Backfill: project existing `league_type` values into `format`.
-- Only rewrites rows that are still at the default so explicit
-- manual edits to `format` (if any) aren't stomped.
UPDATE leagues
SET format = CASE
  WHEN league_type = 'stableford'  THEN 'stableford'
  ELSE 'stroke_play'
END
WHERE format IS NULL OR format = 'stroke_play';

-- Trigger: keep format in sync with league_type on INSERT / UPDATE.
-- Fires BEFORE so the CHECK constraint sees the final value.
CREATE OR REPLACE FUNCTION sync_league_format()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.league_type = 'stableford' THEN
    NEW.format := 'stableford';
  ELSE
    -- Unknown / legacy / unsupported types all map to stroke_play
    -- for computation purposes. The UI still displays the pretty
    -- league_type label (e.g. "Foursome"), but the engine treats
    -- it like stroke play until we ship the real per-format logic.
    NEW.format := 'stroke_play';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_league_format ON leagues;
CREATE TRIGGER trg_sync_league_format
  BEFORE INSERT OR UPDATE OF league_type ON leagues
  FOR EACH ROW
  EXECUTE FUNCTION sync_league_format();

-- ============================================================
-- Verification
-- ============================================================
-- After running, every league has format matching league_type
-- (mapped through the CASE above):
--   SELECT league_type, format, COUNT(*)
--   FROM leagues GROUP BY 1, 2;
-- ============================================================
