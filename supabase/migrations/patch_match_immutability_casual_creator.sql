-- ============================================================
-- Patch: allow casual match creators to bypass the immutability trigger
-- ============================================================
-- fix_core_rls_holes.sql added a trigger that blocks non-admins from
-- changing match.status, league_id, period_id, etc. It correctly
-- allows:
--   • updates happening inside another trigger (pg_trigger_depth > 1)
--   • updates by the admin of the match's league
--
-- But it forgot casual matches. A casual match has league_id = NULL
-- and no separate admin — the creator IS the admin for all
-- practical purposes. The previous trigger blocked the creator from
-- editing their own casual match, which surfaced as "Failed to save
-- scores" when submit_match_scores tried to reset match.status from
-- 'completed' back to 'in_progress' after a score edit.
--
-- This patch adds a third bypass: if league_id IS NULL and
-- created_by = auth.uid(), allow the update through.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_match_creator_field_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- System update (called from inside another trigger) → allow
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- League admin → allow
  IF NEW.league_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = NEW.league_id AND l.admin_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  -- Casual match creator → allow (they're effectively the admin)
  IF NEW.league_id IS NULL AND NEW.created_by = auth.uid() THEN
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
  IF OLD.match_type IS DISTINCT FROM NEW.match_type THEN
    RAISE EXCEPTION 'Match type cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
