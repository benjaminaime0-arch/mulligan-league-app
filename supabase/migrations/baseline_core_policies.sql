-- ============================================================
-- Baseline: RLS policies for core tables (as of 2026-04-21)
-- ============================================================
-- Captures the RLS policies that were created in the Supabase
-- Dashboard and never version-controlled. This file reflects
-- the live production state — some of these policies have known
-- issues that are fixed in fix_core_rls_holes.sql.
--
-- Design context: the app is intentionally an "open golf
-- platform" — any authenticated user can SELECT any profile,
-- league, match, or score. Writes are scoped.
-- ============================================================

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Profiles are publicly readable" ON profiles;
CREATE POLICY "Profiles are publicly readable"
  ON profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS profiles_insert_own ON profiles;
CREATE POLICY profiles_insert_own
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_own ON profiles;
CREATE POLICY profiles_update_own
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);  -- added: prevent changing id mid-update

-- ------------------------------------------------------------
-- leagues
-- ------------------------------------------------------------

DROP POLICY IF EXISTS leagues_select_all ON leagues;
CREATE POLICY leagues_select_all
  ON leagues FOR SELECT
  USING (true);

DROP POLICY IF EXISTS leagues_insert_auth ON leagues;
CREATE POLICY leagues_insert_auth
  ON leagues FOR INSERT
  WITH CHECK (auth.uid() = admin_id);

DROP POLICY IF EXISTS leagues_update_admin ON leagues;
CREATE POLICY leagues_update_admin
  ON leagues FOR UPDATE
  USING (auth.uid() = admin_id);

DROP POLICY IF EXISTS leagues_delete_admin ON leagues;
CREATE POLICY leagues_delete_admin
  ON leagues FOR DELETE
  USING (auth.uid() = admin_id);

-- ------------------------------------------------------------
-- league_members
-- ------------------------------------------------------------

DROP POLICY IF EXISTS league_members_select_auth ON league_members;
CREATE POLICY league_members_select_auth
  ON league_members FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS league_members_insert ON league_members;
CREATE POLICY league_members_insert
  ON league_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS league_members_delete_self ON league_members;
CREATE POLICY league_members_delete_self
  ON league_members FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS league_members_delete_admin ON league_members;
CREATE POLICY league_members_delete_admin
  ON league_members FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = league_members.league_id AND l.admin_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- league_periods
-- ------------------------------------------------------------

DROP POLICY IF EXISTS league_periods_select_all ON league_periods;
CREATE POLICY league_periods_select_all
  ON league_periods FOR SELECT
  USING (true);

DROP POLICY IF EXISTS league_periods_insert_admin ON league_periods;
CREATE POLICY league_periods_insert_admin
  ON league_periods FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM leagues
    WHERE leagues.id = league_periods.league_id AND leagues.admin_id = auth.uid()
  ));

DROP POLICY IF EXISTS league_periods_delete_admin ON league_periods;
CREATE POLICY league_periods_delete_admin
  ON league_periods FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = league_periods.league_id AND l.admin_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- matches
-- ------------------------------------------------------------

DROP POLICY IF EXISTS matches_select_all ON matches;
CREATE POLICY matches_select_all
  ON matches FOR SELECT
  USING (true);

-- Note: this second SELECT policy is fully shadowed by matches_select_all
-- (USING(true) OR <anything> = true). Kept for parity with prod; removed
-- by fix_core_rls_holes.sql.
DROP POLICY IF EXISTS "Users can view matches they participate in" ON matches;
CREATE POLICY "Users can view matches they participate in"
  ON matches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM match_players
      WHERE match_players.match_id = matches.id
        AND match_players.user_id = auth.uid()
    )
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Users can create casual matches" ON matches;
CREATE POLICY "Users can create casual matches"
  ON matches FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND match_type = 'casual'
    AND league_id IS NULL
  );

DROP POLICY IF EXISTS matches_insert_member ON matches;
CREATE POLICY matches_insert_member
  ON matches FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM league_members lm
      WHERE lm.league_id = matches.league_id
        AND lm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Creators can update their casual matches" ON matches;
CREATE POLICY "Creators can update their casual matches"
  ON matches FOR UPDATE
  USING (auth.uid() = created_by AND match_type = 'casual');

DROP POLICY IF EXISTS matches_update_creator ON matches;
CREATE POLICY matches_update_creator
  ON matches FOR UPDATE
  USING (auth.uid() = created_by);

DROP POLICY IF EXISTS matches_delete_admin ON matches;
CREATE POLICY matches_delete_admin
  ON matches FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = matches.league_id AND l.admin_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- match_players
-- ------------------------------------------------------------

DROP POLICY IF EXISTS match_players_select_all ON match_players;
CREATE POLICY match_players_select_all
  ON match_players FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can join casual matches" ON match_players;
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

DROP POLICY IF EXISTS match_players_insert_member ON match_players;
CREATE POLICY match_players_insert_member
  ON match_players FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM matches m
      JOIN league_members lm ON lm.league_id = m.league_id
      WHERE m.id = match_players.match_id
        AND lm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS match_players_delete_admin ON match_players;
CREATE POLICY match_players_delete_admin
  ON match_players FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM matches m
    JOIN leagues l ON l.id = m.league_id
    WHERE m.id = match_players.match_id AND l.admin_id = auth.uid()
  ));

-- ------------------------------------------------------------
-- scores
-- ------------------------------------------------------------

DROP POLICY IF EXISTS scores_select_auth ON scores;
CREATE POLICY scores_select_auth
  ON scores FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS scores_insert_auth ON scores;
CREATE POLICY scores_insert_auth
  ON scores FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM match_players mp
      WHERE mp.match_id = scores.match_id
        AND mp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS scores_update_own ON scores;
CREATE POLICY scores_update_own
  ON scores FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS scores_delete_admin ON scores;
CREATE POLICY scores_delete_admin
  ON scores FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM matches m
    JOIN leagues l ON l.id = m.league_id
    WHERE m.id = scores.match_id AND l.admin_id = auth.uid()
  ));
