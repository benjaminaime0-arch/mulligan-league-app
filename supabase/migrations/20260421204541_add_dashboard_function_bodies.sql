-- ============================================================
-- Dashboard-authored function bodies
-- ============================================================
-- Two functions that were created via the Supabase Dashboard SQL
-- Editor and never checked into git. Their triggers live in
-- baseline_core_constraints.sql; this file captures the CALLEES.
--
-- Run order:
--   1. baseline_core_schema.sql       (tables exist)
--   2. baseline_core_constraints.sql  (triggers reference these functions)
--   3. add_dashboard_function_bodies.sql ← this file
--
-- HISTORICAL: originally also contained on_match_created and
-- on_score_submitted that wrote to a dead activity_log table.
-- Both removed by cleanup_activity_log_shadow_system.sql.
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

