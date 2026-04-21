-- ============================================================
-- Remove all casual-match legacy (schema + RLS + data + helper)
-- ============================================================
-- Casual matches were a feature where users could create matches
-- outside a league, share an invite code, and have people join via
-- the code. The product now only supports league matches. The UI
-- stopped creating casual matches long ago, leaving:
--   • matches.match_type column (always 'league' now)
--   • matches.invite_code column (unused for league matches —
--     league invites live on leagues.invite_code)
--   • 3 RLS policies that only fire for match_type='casual'
--   • 2 indexes on the unused columns
--   • generate_match_invite_code() helper function
--   • A couple of test casual match rows in the DB
--
-- This migration removes all of it. Run order:
--   1. DELETE casual match rows (FK CASCADE handles match_players + scores)
--   2. DROP the casual-only policies
--   3. DROP the dead indexes
--   4. DROP the columns
--   5. Replace get_player_round_history (it references match_type)
--   6. DROP generate_match_invite_code()
--
-- Safe to re-run (idempotent — uses IF EXISTS everywhere).
-- ============================================================

-- 1. Purge casual match rows. FK CASCADE on match_players + scores
-- means we don't need to manually delete those.
DELETE FROM matches WHERE match_type = 'casual';

-- 2. Drop casual-only RLS policies
DROP POLICY IF EXISTS "Users can create casual matches" ON matches;
DROP POLICY IF EXISTS "Creators can update their casual matches" ON matches;
DROP POLICY IF EXISTS "Users can join casual matches" ON match_players;

-- 3. Drop indexes on the columns we're about to drop
DROP INDEX IF EXISTS idx_matches_invite_code;
DROP INDEX IF EXISTS idx_matches_match_type;

-- 4. Drop the columns
ALTER TABLE matches DROP COLUMN IF EXISTS match_type;
ALTER TABLE matches DROP COLUMN IF EXISTS invite_code;

-- 5. get_player_round_history currently selects match_type — rewrite
-- without it. Callers treat everything as a league match now.
CREATE OR REPLACE FUNCTION get_player_round_history(p_user_id UUID)
RETURNS TABLE (
  round_date DATE,
  course_name TEXT,
  score INTEGER,
  holes INTEGER,
  league_name TEXT,
  match_id UUID,
  score_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.match_date::DATE AS round_date,
    COALESCE(m.course_name, l.course_name, 'Unknown Course') AS course_name,
    s.score,
    s.holes,
    l.name AS league_name,
    m.id AS match_id,
    COALESCE(s.status, 'approved') AS score_status
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  LEFT JOIN leagues l ON l.id = m.league_id
  WHERE s.user_id = p_user_id
  ORDER BY m.match_date DESC NULLS LAST, s.created_at DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Helper function is no longer needed
DROP FUNCTION IF EXISTS generate_match_invite_code();

-- ============================================================
-- Verification (run manually)
-- ============================================================
-- \d matches        -- should no longer show match_type or invite_code columns
-- SELECT COUNT(*) FROM matches WHERE match_type = 'casual';
--   -- expect error "column match_type does not exist" (success!)
-- \df generate_match_invite_code
--   -- expect 0 rows
-- ============================================================
