-- ============================================================
-- Make leagues private: restrict SELECT to members
-- ============================================================
-- Today's policy is "open golf platform" — any authenticated user
-- can SELECT every row on leagues, league_members, league_periods,
-- matches, match_players, scores. That means visiting another
-- player's profile (or hitting the API directly) exposes leagues
-- they're in that the viewer has no business seeing.
--
-- New rule: a league and everything inside it (periods, matches,
-- players, scores) is only visible to its members. Joining still
-- happens via invite_code → request_join_league → admin approval.
--
-- Safe to re-run: DROP POLICY IF EXISTS + CREATE POLICY.
-- ============================================================

-- 1. leagues — only members see the league row
DROP POLICY IF EXISTS leagues_select_all ON leagues;
DROP POLICY IF EXISTS leagues_select_members ON leagues;
CREATE POLICY leagues_select_members
  ON leagues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = leagues.id AND lm.user_id = auth.uid()
    )
  );

-- 2. league_members — you only see rosters of leagues you're in
DROP POLICY IF EXISTS league_members_select_auth ON league_members;
DROP POLICY IF EXISTS league_members_select_members ON league_members;
CREATE POLICY league_members_select_members
  ON league_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members self
      WHERE self.league_id = league_members.league_id AND self.user_id = auth.uid()
    )
  );

-- 3. league_periods — members only
DROP POLICY IF EXISTS league_periods_select_all ON league_periods;
DROP POLICY IF EXISTS league_periods_select_members ON league_periods;
CREATE POLICY league_periods_select_members
  ON league_periods FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = league_periods.league_id AND lm.user_id = auth.uid()
    )
  );

-- 4. matches — members of the match's league only
-- (casual matches are gone after purge_casual_match_legacy.sql, so
-- every match now has league_id NOT NULL; no legacy branch needed.)
DROP POLICY IF EXISTS matches_select_all ON matches;
DROP POLICY IF EXISTS matches_select_members ON matches;
CREATE POLICY matches_select_members
  ON matches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = matches.league_id AND lm.user_id = auth.uid()
    )
  );

-- 5. match_players — members of that match's league
DROP POLICY IF EXISTS match_players_select_all ON match_players;
DROP POLICY IF EXISTS match_players_select_members ON match_players;
CREATE POLICY match_players_select_members
  ON match_players FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM matches m
      JOIN league_members lm ON lm.league_id = m.league_id
      WHERE m.id = match_players.match_id AND lm.user_id = auth.uid()
    )
  );

-- 6. scores — members of that match's league
DROP POLICY IF EXISTS scores_select_auth ON scores;
DROP POLICY IF EXISTS scores_select_members ON scores;
CREATE POLICY scores_select_members
  ON scores FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM matches m
      JOIN league_members lm ON lm.league_id = m.league_id
      WHERE m.id = scores.match_id AND lm.user_id = auth.uid()
    )
  );

-- ============================================================
-- Follow-up: the profile RPCs (get_profile_records, _courses,
-- _score_trend, get_player_round_history) are SECURITY DEFINER
-- and bypass RLS. When called for a *different* user id, they
-- currently leak rows from leagues the caller isn't in. Patch
-- those in a separate migration to filter by caller membership.
-- ============================================================
