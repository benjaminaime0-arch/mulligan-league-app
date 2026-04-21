-- ============================================================
-- Baseline: CREATE TABLE definitions for core tables (2026-04-21)
-- ============================================================
-- Column-level schema for the 7 core tables that were created in the
-- Supabase Dashboard and never version-controlled. Run this BEFORE
-- baseline_core_constraints.sql (which adds FKs/CHECKs referencing
-- these tables) and baseline_core_policies.sql (which adds RLS).
--
-- Paired files:
--   1. baseline_core_schema.sql       ← this file (columns + PKs)
--   2. baseline_core_constraints.sql  (FKs, UNIQUE, CHECK, indexes, triggers)
--   3. baseline_core_policies.sql     (RLS policies)
--
-- Post-baseline migrations in this folder may ADD COLUMN on top of
-- these tables (e.g. matches.last_edit_at comes from
-- add_match_auto_complete_24h.sql). Those use IF NOT EXISTS so they
-- remain idempotent whether the column is already here or not.
-- ============================================================

-- Tables use uuid_generate_v4() which comes from the uuid-ossp extension.
-- Supabase enables this by default but we declare explicitly for safety.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Trigram index on profiles.first_name + last_name (in baseline_core_constraints.sql)
-- requires pg_trgm. Declare here alongside the extensions.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- profiles
-- ------------------------------------------------------------
-- One row per auth.users entry. id === auth.users.id.

CREATE TABLE IF NOT EXISTS profiles (
  id         uuid PRIMARY KEY,
  email      text NOT NULL,
  first_name text NOT NULL,
  last_name  text,
  club       text,
  handicap   integer,
  avatar_url text,
  created_at timestamp with time zone DEFAULT now(),
  town       text,
  username   text
);

-- ------------------------------------------------------------
-- leagues
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leagues (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                text NOT NULL,
  course_name         text NOT NULL,
  admin_id            uuid NOT NULL,
  max_players         integer NOT NULL,
  invite_code         text NOT NULL DEFAULT upper(substr(replace((uuid_generate_v4())::text, '-'::text, ''::text), 1, 6)),
  league_type         text NOT NULL DEFAULT 'stroke_play'::text,
  status              text NOT NULL DEFAULT 'pending'::text,
  created_at          timestamp with time zone DEFAULT now(),
  start_date          date,
  end_date            date,
  scoring_cards_count integer,
  total_cards_count   integer
);

-- ------------------------------------------------------------
-- league_members
-- ------------------------------------------------------------
-- Junction table between leagues and profiles. The role column is a
-- text CHECK ('admin' | 'member') — declared in constraints file.

CREATE TABLE IF NOT EXISTS league_members (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id uuid NOT NULL,
  user_id   uuid NOT NULL,
  role      text NOT NULL DEFAULT 'member'::text,
  joined_at timestamp with time zone DEFAULT now()
);

-- ------------------------------------------------------------
-- league_periods
-- ------------------------------------------------------------
-- Weekly (or per-period) slices of a league season. week_number is
-- unique within a league.

CREATE TABLE IF NOT EXISTS league_periods (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   uuid NOT NULL,
  week_number integer NOT NULL,
  name        text NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'upcoming'::text,
  created_at  timestamp with time zone DEFAULT now()
);

-- ------------------------------------------------------------
-- matches
-- ------------------------------------------------------------
-- Every match lives inside a league (league_id + period_id set).
-- last_edit_at is added by add_match_auto_complete_24h.sql and is
-- included here for snapshot parity.
--
-- Historical: this table used to have `match_type` ('league' | 'casual')
-- and `invite_code` columns to support a casual-match feature. That
-- feature was retired; columns + related RLS were removed by
-- purge_casual_match_legacy.sql. Not recreated here.

CREATE TABLE IF NOT EXISTS matches (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id    uuid,
  period_id    uuid,
  course_name  text NOT NULL,
  match_date   date NOT NULL,
  match_time   time without time zone,
  created_by   uuid NOT NULL,
  status       text NOT NULL DEFAULT 'scheduled'::text,
  created_at   timestamp with time zone DEFAULT now(),
  last_edit_at timestamp with time zone
);

-- ------------------------------------------------------------
-- match_players
-- ------------------------------------------------------------
-- Membership of a user in a match. approved_at tracks when this
-- player has approved the final scores.

CREATE TABLE IF NOT EXISTS match_players (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id    uuid NOT NULL,
  user_id     uuid NOT NULL,
  joined_at   timestamp with time zone DEFAULT now(),
  approved_at timestamp with time zone
);

-- ------------------------------------------------------------
-- scores
-- ------------------------------------------------------------
-- One row per player per match. submitted_by distinguishes "whose
-- score" (user_id) from "who entered it" (submitted_by — typically
-- the match scorer). status ('pending' | 'approved') is the source
-- of truth for approval state.
--
-- A `validated boolean` column existed in an earlier design but was
-- dropped via cleanup_scores_validated_column.sql; not recreated here.

CREATE TABLE IF NOT EXISTS scores (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id     uuid NOT NULL,
  user_id      uuid NOT NULL,
  score        integer NOT NULL,
  holes        integer NOT NULL DEFAULT 18,
  created_at   timestamp with time zone DEFAULT now(),
  status       text DEFAULT 'pending'::text,
  approved_by  uuid,
  approved_at  timestamp with time zone,
  submitted_by uuid
);

-- ------------------------------------------------------------
-- RLS enable
-- ------------------------------------------------------------
-- Policies themselves live in baseline_core_policies.sql. Enabling
-- RLS here keeps the "table exists with RLS on" invariant tight —
-- running this file before policies is safe because with RLS on and
-- no policies, all access is denied to normal users, matching what
-- Supabase shows when a fresh table is created.

ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues         ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_periods  ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores          ENABLE ROW LEVEL SECURITY;
