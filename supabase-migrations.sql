-- ============================================================
-- Mulligan League Beta: Database Migrations
-- Run these in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- ============================================================
-- 1. ALTER matches table for casual match support
-- ============================================================

-- Make league_id nullable (casual matches have no league)
ALTER TABLE matches ALTER COLUMN league_id DROP NOT NULL;

-- Make period_id nullable (casual matches have no period)
ALTER TABLE matches ALTER COLUMN period_id DROP NOT NULL;

-- Add match_type column ('league' or 'casual')
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_type TEXT NOT NULL DEFAULT 'league';

-- Add invite_code for casual match sharing
ALTER TABLE matches ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- Index for invite code lookups
CREATE INDEX IF NOT EXISTS idx_matches_invite_code ON matches (invite_code) WHERE invite_code IS NOT NULL;

-- Index for match_type filtering
CREATE INDEX IF NOT EXISTS idx_matches_match_type ON matches (match_type);

-- ============================================================
-- 2. RLS policies for casual matches
-- ============================================================

-- Allow users to insert casual matches (no league required)
CREATE POLICY "Users can create casual matches"
  ON matches FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND match_type = 'casual'
    AND league_id IS NULL
  );

-- Allow users to view matches they are players in
-- (This may already exist — if so, the CREATE will fail safely)
CREATE POLICY "Users can view matches they participate in"
  ON matches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM match_players
      WHERE match_players.match_id = matches.id
      AND match_players.user_id = auth.uid()
    )
    OR matches.created_by = auth.uid()
  );

-- Allow match creator to update their casual matches
CREATE POLICY "Creators can update their casual matches"
  ON matches FOR UPDATE
  USING (
    auth.uid() = created_by
    AND match_type = 'casual'
  );

-- Allow users to join casual matches (insert into match_players)
CREATE POLICY "Users can join casual matches"
  ON match_players FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM matches
      WHERE matches.id = match_players.match_id
      AND matches.match_type = 'casual'
    )
  );

-- ============================================================
-- 3. get_player_round_history RPC
-- ============================================================

CREATE OR REPLACE FUNCTION get_player_round_history(p_user_id UUID)
RETURNS TABLE (
  round_date DATE,
  course_name TEXT,
  score INTEGER,
  holes INTEGER,
  match_type TEXT,
  league_name TEXT,
  match_id UUID,
  score_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.match_date::DATE as round_date,
    COALESCE(m.course_name, l.course_name, 'Unknown Course') as course_name,
    s.score,
    s.holes,
    COALESCE(m.match_type, 'league') as match_type,
    l.name as league_name,
    m.id as match_id,
    COALESCE(s.status, 'approved') as score_status
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  LEFT JOIN leagues l ON l.id = m.league_id
  WHERE s.user_id = p_user_id
  ORDER BY m.match_date DESC NULLS LAST, s.created_at DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Helper function to generate invite codes for casual matches
-- ============================================================

CREATE OR REPLACE FUNCTION generate_match_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code TEXT := '';
  i INTEGER;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::INTEGER, 1);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- NOTES:
--
-- If you get errors about existing policies, it means those
-- policies already exist. You can safely ignore those errors
-- or drop and recreate them.
--
-- If league_id already allows NULL, the ALTER will succeed
-- silently (no-op).
--
-- After running this, verify with:
--   SELECT column_name, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'matches';
-- ============================================================
