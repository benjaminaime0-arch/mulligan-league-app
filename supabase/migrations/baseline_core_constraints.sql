-- ============================================================
-- Baseline: constraints, indexes, and triggers for core tables
-- ============================================================
-- Exported from the live Supabase DB on 2026-04-21. Captures
-- schema that was created in the Dashboard but never version-
-- controlled. NOTE: CREATE TABLE definitions and RLS policies
-- live in separate files (baseline_core_schema.sql and
-- baseline_core_policies.sql) — run this AFTER those.
--
-- Triggers that call functions defined in OTHER migration files
-- (notify_*, fn_activity_*, check_*) will only work if those
-- migrations have also been applied.
--
-- HISTORICAL NOTE: this file originally also declared `on_match_insert`
-- and `on_score_insert` triggers that called on_match_created /
-- on_score_submitted. Both were removed by
-- cleanup_activity_log_shadow_system.sql — they wrote to a dead
-- activity_log table the app never read. Do not reintroduce.
-- ============================================================

-- ------------------------------------------------------------
-- Foreign keys, UNIQUE, CHECK
-- ------------------------------------------------------------

-- league_members
ALTER TABLE league_members ADD CONSTRAINT league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE league_members ADD CONSTRAINT league_members_league_id_user_id_key UNIQUE (league_id, user_id);
ALTER TABLE league_members ADD CONSTRAINT league_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])));
ALTER TABLE league_members ADD CONSTRAINT league_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- league_periods
ALTER TABLE league_periods ADD CONSTRAINT league_periods_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE league_periods ADD CONSTRAINT league_periods_league_id_week_number_key UNIQUE (league_id, week_number);
ALTER TABLE league_periods ADD CONSTRAINT league_periods_status_check CHECK ((status = ANY (ARRAY['upcoming'::text, 'active'::text, 'completed'::text])));

-- leagues
ALTER TABLE leagues ADD CONSTRAINT leagues_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES profiles(id);
ALTER TABLE leagues ADD CONSTRAINT leagues_dates_order CHECK (((start_date IS NULL) OR (end_date IS NULL) OR (start_date <= end_date)));
ALTER TABLE leagues ADD CONSTRAINT leagues_invite_code_key UNIQUE (invite_code);
ALTER TABLE leagues ADD CONSTRAINT leagues_max_players_check CHECK (((max_players >= 2) AND (max_players <= 10)));
ALTER TABLE leagues ADD CONSTRAINT leagues_scoring_cards_range CHECK (((scoring_cards_count IS NULL) OR ((scoring_cards_count >= 1) AND (scoring_cards_count <= 10))));
ALTER TABLE leagues ADD CONSTRAINT leagues_scoring_le_total_cards CHECK (((scoring_cards_count IS NULL) OR (total_cards_count IS NULL) OR (scoring_cards_count <= total_cards_count)));
ALTER TABLE leagues ADD CONSTRAINT leagues_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'paused'::text, 'completed'::text])));
ALTER TABLE leagues ADD CONSTRAINT leagues_total_cards_range CHECK (((total_cards_count IS NULL) OR ((total_cards_count >= 1) AND (total_cards_count <= 10))));

-- match_players
ALTER TABLE match_players ADD CONSTRAINT match_players_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE match_players ADD CONSTRAINT match_players_match_id_user_id_key UNIQUE (match_id, user_id);
ALTER TABLE match_players ADD CONSTRAINT match_players_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- matches
ALTER TABLE matches ADD CONSTRAINT matches_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
ALTER TABLE matches ADD CONSTRAINT matches_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE matches ADD CONSTRAINT matches_period_id_fkey FOREIGN KEY (period_id) REFERENCES league_periods(id) ON DELETE CASCADE;
ALTER TABLE matches ADD CONSTRAINT matches_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text])));

-- profiles
ALTER TABLE profiles ADD CONSTRAINT profiles_email_key UNIQUE (email);
ALTER TABLE profiles ADD CONSTRAINT profiles_handicap_check CHECK (((handicap >= 0) AND (handicap <= 54)));
ALTER TABLE profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- scores
ALTER TABLE scores ADD CONSTRAINT scores_holes_check CHECK ((holes = ANY (ARRAY[9, 18])));
ALTER TABLE scores ADD CONSTRAINT scores_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE scores ADD CONSTRAINT scores_match_id_user_id_key UNIQUE (match_id, user_id);
ALTER TABLE scores ADD CONSTRAINT scores_score_check CHECK (((score > 0) AND (score <= 200)));
ALTER TABLE scores ADD CONSTRAINT scores_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id);
ALTER TABLE scores ADD CONSTRAINT scores_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_league_members_league ON public.league_members USING btree (league_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user ON public.league_members USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_league_periods_league ON public.league_periods USING btree (league_id);
CREATE INDEX IF NOT EXISTS idx_league_periods_status ON public.league_periods USING btree (league_id, status);
CREATE INDEX IF NOT EXISTS idx_leagues_invite ON public.leagues USING btree (invite_code);
CREATE INDEX IF NOT EXISTS idx_match_players_match ON public.match_players USING btree (match_id);
CREATE INDEX IF NOT EXISTS idx_match_players_user ON public.match_players USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_matches_date ON public.matches USING btree (match_date);
CREATE INDEX IF NOT EXISTS idx_matches_invite_code ON public.matches USING btree (invite_code) WHERE (invite_code IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_matches_league ON public.matches USING btree (league_id);
CREATE INDEX IF NOT EXISTS idx_matches_match_type ON public.matches USING btree (match_type);
CREATE INDEX IF NOT EXISTS idx_matches_period ON public.matches USING btree (period_id);
-- Trigram index on profile names for search — requires pg_trgm extension
CREATE INDEX IF NOT EXISTS idx_profiles_name_trgm
  ON public.profiles USING gin ((((first_name || ' '::text) || COALESCE(last_name, ''::text))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_scores_match_id ON public.scores USING btree (match_id);
CREATE INDEX IF NOT EXISTS idx_scores_user ON public.scores USING btree (user_id);

-- Unique indexes (backing the UNIQUE constraints above — Postgres creates
-- these automatically, but we list them so db state matches declaration)
-- CREATE UNIQUE INDEX league_members_league_id_user_id_key ...   (auto)
-- CREATE UNIQUE INDEX league_periods_league_id_week_number_key ... (auto)
-- CREATE UNIQUE INDEX leagues_invite_code_key ...                  (auto)
-- CREATE UNIQUE INDEX match_players_match_id_user_id_key ...       (auto)
-- CREATE UNIQUE INDEX profiles_email_key ...                       (auto)
-- CREATE UNIQUE INDEX scores_match_id_user_id_key ...              (auto)

-- Case-insensitive username uniqueness (not a constraint, a functional index)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles USING btree (lower(username));

-- ------------------------------------------------------------
-- Triggers defined in the Dashboard (not in other migrations)
-- ------------------------------------------------------------
-- These call functions whose source we don't have in git:
--   on_match_created()
--   on_score_submitted()
--   check_match_completion()
--   check_match_player_limit()
-- TODO: export those function bodies and add to a follow-up migration.

-- Only re-create the dashboard-managed triggers that aren't already
-- covered by our in-git migrations. Triggers for notifications and
-- activity_events are defined in add_notifications_system.sql,
-- add_activity_events.sql, and fix_notification_triggers.sql.

DROP TRIGGER IF EXISTS on_score_status_change ON public.scores;
CREATE TRIGGER on_score_status_change
  AFTER UPDATE OF status ON public.scores
  FOR EACH ROW
  WHEN ((NEW.status = 'approved'::text))
  EXECUTE FUNCTION check_match_completion();

DROP TRIGGER IF EXISTS trg_check_match_player_limit ON public.match_players;
CREATE TRIGGER trg_check_match_player_limit
  BEFORE INSERT ON public.match_players
  FOR EACH ROW
  EXECUTE FUNCTION check_match_player_limit();
