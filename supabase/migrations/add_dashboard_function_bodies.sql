-- ============================================================
-- Dashboard-authored function bodies
-- ============================================================
-- Four functions that were created via the Supabase Dashboard SQL
-- Editor and never checked into git. Their triggers live in
-- baseline_core_constraints.sql; this file captures the CALLEES.
--
-- Run order:
--   1. baseline_core_schema.sql       (tables exist)
--   2. baseline_core_constraints.sql  (triggers reference these functions)
--   3. add_dashboard_function_bodies.sql ← this file
--
-- With this file, every piece of business logic currently running
-- on the production DB is in version control.
--
-- ⚠ NOTE: on_match_created and on_score_submitted write to a table
-- called `public.activity_log`. That table is NOT in any migration
-- file in this folder — it was created in the Dashboard. There is
-- a DIFFERENT table called `public.activity_events` (tracked in
-- add_activity_events.sql) that writes similar rows. You have two
-- parallel activity-tracking systems. Worth consolidating — see
-- the "Known cleanup" section at the bottom.
-- ============================================================

-- ------------------------------------------------------------
-- check_match_completion
-- ------------------------------------------------------------
-- Called by trigger `on_score_status_change` (AFTER UPDATE OF status
-- ON scores WHERE NEW.status='approved').
-- If every match player has an approved score, marks the match
-- as completed.

CREATE OR REPLACE FUNCTION public.check_match_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_match_id UUID;
  v_total_players INT;
  v_approved_scores INT;
BEGIN
  v_match_id := NEW.match_id;

  SELECT COUNT(*) INTO v_total_players
  FROM match_players
  WHERE match_id = v_match_id;

  SELECT COUNT(*) INTO v_approved_scores
  FROM scores
  WHERE match_id = v_match_id AND status = 'approved';

  IF v_total_players > 0 AND v_approved_scores >= v_total_players THEN
    UPDATE matches
    SET status = 'completed'
    WHERE id = v_match_id AND status != 'completed';
  END IF;

  RETURN NEW;
END;
$fn$;

-- ------------------------------------------------------------
-- check_match_player_limit
-- ------------------------------------------------------------
-- Called by trigger `trg_check_match_player_limit` (BEFORE INSERT
-- ON match_players). Hard caps matches at 4 players. Not SECURITY
-- DEFINER — runs as the caller, which is fine because it's a
-- read + validation only, no writes.

CREATE OR REPLACE FUNCTION public.check_match_player_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.match_players
  WHERE match_id = NEW.match_id;

  IF v_count >= 4 THEN
    RAISE EXCEPTION 'Match is full (maximum 4 players)';
  END IF;

  RETURN NEW;
END;
$fn$;

-- ------------------------------------------------------------
-- on_match_created
-- ------------------------------------------------------------
-- Called by trigger `on_match_insert` (AFTER INSERT ON matches).
-- Logs a 'match_created' row into public.activity_log.

CREATE OR REPLACE FUNCTION public.on_match_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
BEGIN
  INSERT INTO public.activity_log (league_id, user_id, action_type, metadata)
  VALUES (
    NEW.league_id,
    NEW.created_by,
    'match_created',
    json_build_object(
      'match_date', NEW.match_date,
      'course',     NEW.course_name
    )::jsonb
  );

  RETURN NEW;
END;
$fn$;

-- ------------------------------------------------------------
-- on_score_submitted
-- ------------------------------------------------------------
-- Called by trigger `on_score_insert` (AFTER INSERT ON scores).
-- Logs a 'score_submitted' row into public.activity_log.

CREATE OR REPLACE FUNCTION public.on_score_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  v_league_id UUID;
BEGIN
  SELECT m.league_id INTO v_league_id
  FROM public.matches m
  WHERE m.id = NEW.match_id;

  INSERT INTO public.activity_log (league_id, user_id, action_type, metadata)
  VALUES (
    v_league_id,
    NEW.user_id,
    'score_submitted',
    json_build_object(
      'score',    NEW.score,
      'holes',    NEW.holes,
      'match_id', NEW.match_id
    )::jsonb
  );

  RETURN NEW;
END;
$fn$;

-- ============================================================
-- Known cleanup: activity_log vs activity_events
-- ============================================================
-- The two functions above write to `public.activity_log`, but
-- the app's activity feed (src/app/profile/page.tsx, the
-- get_activity_feed RPC in add_activity_events.sql) reads from
-- `public.activity_events`. Meaning:
--   • activity_log is written to by the Dashboard-authored
--     triggers above but never read by the app.
--   • activity_events is written to by the git-tracked triggers
--     (fn_activity_player_joined_league, fn_activity_match_created,
--     fn_activity_score_approved) and read by get_activity_feed.
--
-- Practically: every match create fires BOTH on_match_created
-- (writes to activity_log) AND trg_activity_match_created (writes
-- to activity_events). Double work, but no user-visible conflict.
--
-- Recommended follow-up (not in this migration):
--   1. Export the schema of activity_log, commit to git.
--   2. Decide which system is canonical.
--   3. Either:
--      a) Drop activity_log + these two triggers (if unused), OR
--      b) Migrate activity_events readers to activity_log, drop
--         activity_events + its triggers.
-- ============================================================
