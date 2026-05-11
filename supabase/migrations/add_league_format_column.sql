-- ============================================================
-- Leagues: introduce a `format` scoring model column
-- ============================================================
-- Until now every league has implicitly been stroke play — lowest
-- total wins, best-of-N picks the lowest N cards. We're opening the
-- door to Stableford (and eventually match play) by making the
-- format explicit on the league row.
--
-- For this first cut only two values are allowed:
--   stroke_play — lowest total wins. Best-of-N picks the LOWEST N.
--                 (Status quo. Every existing league is backfilled.)
--   stableford  — highest total wins. Best-of-N picks the HIGHEST N.
--                 Points are entered as a pre-calculated total per
--                 round (user does the math on their paper card).
--
-- `get_leaderboard` and `get_league_badges` will be patched in
-- companion migrations to respect this column. Until those land,
-- every league behaves like stroke play even if format = stableford
-- (the column exists but isn't read anywhere yet).
--
-- Safe to re-run: IF NOT EXISTS + DO block for the constraint.
-- ============================================================

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'stroke_play';

-- Constraint in a DO block so we can DROP+ADD idempotently without
-- caring whether it already exists under a specific name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leagues_format_check'
  ) THEN
    ALTER TABLE leagues DROP CONSTRAINT leagues_format_check;
  END IF;

  ALTER TABLE leagues
    ADD CONSTRAINT leagues_format_check
    CHECK (format IN ('stroke_play', 'stableford'));
END $$;

-- Sanity-check backfill: any row that somehow ended up NULL (can't
-- happen via the ADD COLUMN default, but belt-and-suspenders for
-- manual edits) gets pushed to stroke_play.
UPDATE leagues SET format = 'stroke_play' WHERE format IS NULL;

COMMENT ON COLUMN leagues.format IS
  'Scoring model. stroke_play = lowest total wins (default). '
  'stableford = highest total wins, pre-calculated points entered '
  'per round. Drives direction of leaderboard sort + best-of-N cap '
  'selection in get_leaderboard/get_league_badges.';
