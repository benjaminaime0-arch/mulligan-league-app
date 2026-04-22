-- ============================================================
-- Fix: privatize_leagues policies were self-referential and
-- returned zero rows for everyone.
-- ============================================================
-- privatize_leagues.sql made league_members SELECT depend on
-- league_members itself:
--
--   USING (EXISTS (SELECT 1 FROM league_members self
--                  WHERE self.league_id = league_members.league_id
--                    AND self.user_id   = auth.uid()))
--
-- When Postgres evaluates that, the inner SELECT re-enters the same
-- RLS policy, which needs the inner SELECT to succeed, which re-enters
-- the policy... Postgres doesn't error — it just returns no rows. So
-- every viewer saw zero members → zero leagues (since leagues's
-- policy also reads league_members) → zero matches / scores.
--
-- Fix: a SECURITY DEFINER helper that bypasses RLS when performing
-- the membership check. Policies now call the helper, so there's no
-- recursion at the SQL level.
--
-- Safe to re-run.
-- ============================================================

-- Helper 1: is the user a member of this league?
-- STABLE so the planner can cache within a single statement.
-- SECURITY DEFINER bypasses RLS on league_members (the whole point).
CREATE OR REPLACE FUNCTION is_league_member(p_league_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_members
    WHERE league_id = p_league_id
      AND user_id   = p_user_id
  );
$$;

-- Helper 2: can the user see this match? (i.e., member of its league)
-- Saves writing the join twice on match_players + scores policies.
CREATE OR REPLACE FUNCTION user_can_see_match(p_match_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM matches m
    JOIN league_members lm ON lm.league_id = m.league_id
    WHERE m.id       = p_match_id
      AND lm.user_id = p_user_id
  );
$$;

-- Grant execute to authenticated users (and anon, harmless — they
-- can call it but it'll return false for any league since anon has
-- no membership rows).
GRANT EXECUTE ON FUNCTION is_league_member(uuid, uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION user_can_see_match(uuid, uuid) TO authenticated, anon;

-- ============================================================
-- Rewrite the six SELECT policies to use the helpers.
-- ============================================================

-- 1. leagues
DROP POLICY IF EXISTS leagues_select_members ON leagues;
CREATE POLICY leagues_select_members
  ON leagues FOR SELECT
  USING (is_league_member(leagues.id, auth.uid()));

-- 2. league_members
DROP POLICY IF EXISTS league_members_select_members ON league_members;
CREATE POLICY league_members_select_members
  ON league_members FOR SELECT
  USING (is_league_member(league_members.league_id, auth.uid()));

-- 3. league_periods
DROP POLICY IF EXISTS league_periods_select_members ON league_periods;
CREATE POLICY league_periods_select_members
  ON league_periods FOR SELECT
  USING (is_league_member(league_periods.league_id, auth.uid()));

-- 4. matches
DROP POLICY IF EXISTS matches_select_members ON matches;
CREATE POLICY matches_select_members
  ON matches FOR SELECT
  USING (is_league_member(matches.league_id, auth.uid()));

-- 5. match_players
DROP POLICY IF EXISTS match_players_select_members ON match_players;
CREATE POLICY match_players_select_members
  ON match_players FOR SELECT
  USING (user_can_see_match(match_players.match_id, auth.uid()));

-- 6. scores
DROP POLICY IF EXISTS scores_select_members ON scores;
CREATE POLICY scores_select_members
  ON scores FOR SELECT
  USING (user_can_see_match(scores.match_id, auth.uid()));

-- ============================================================
-- Verification
-- ============================================================
-- As a user who IS a member of league X:
--   SELECT * FROM leagues WHERE id = X;          -- 1 row
--   SELECT * FROM league_members WHERE league_id = X;  -- roster
--   SELECT * FROM matches WHERE league_id = X;   -- league matches
-- As a user who is NOT a member of league Y:
--   SELECT * FROM leagues WHERE id = Y;          -- 0 rows
-- ============================================================
