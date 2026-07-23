-- ============================================================
-- Patch: rebuild immutability trigger after the casual-match purge
-- ============================================================
-- fix_core_rls_holes.sql defined enforce_match_creator_field_immutability()
-- which validated several columns on UPDATE — one of them was
-- matches.match_type. purge_casual_match_legacy.sql dropped that
-- column. PL/pgSQL resolves NEW.<col> at runtime, so the trigger
-- itself didn't fail at migration time, but the NEXT non-admin
-- UPDATE on matches would throw "column match_type does not exist".
--
-- This patch rewrites the function with match_type removed. It also
-- drops the casual-match bypass that was briefly added in the old
-- patch_match_immutability_casual_creator.sql — casual matches no
-- longer exist, so every match now has a league_id and an admin.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_match_creator_field_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- System update (called from inside another trigger, e.g. the
  -- score-approval flow flipping status completed ↔ in_progress) → allow
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- League admin → allow any change on their league's matches
  IF NEW.league_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = NEW.league_id AND l.admin_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  -- Otherwise: enforce immutability on key columns
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'Match status can only change via the score-approval flow'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.league_id IS DISTINCT FROM NEW.league_id THEN
    RAISE EXCEPTION 'Match league cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.period_id IS DISTINCT FROM NEW.period_id THEN
    RAISE EXCEPTION 'Match period cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'Match creator cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
