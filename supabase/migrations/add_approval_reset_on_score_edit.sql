-- ============================================================
-- Editing a score re-opens the approval cycle
-- ============================================================
-- Rule: if a player edits their score (or another player's score)
-- AFTER the match has been fully approved, everyone must re-approve.
-- Implementation is at the DB level so it's correct regardless of
-- which client / RPC path the edit comes through.
--
-- Two parts:
-- 1. Loosen the match-immutability trigger so `completed → in_progress`
--    is allowed for any caller (needed for the rollback). Forward
--    transitions into `completed` still require trigger context
--    (i.e. check_match_completion) OR a league admin override.
-- 2. New trigger `reset_approvals_on_score_edit` fires after a score
--    UPDATE when the score value or holes changed. It:
--      • clears every other score in the match back to 'pending'
--      • nulls out every match_players.approved_at
--      • rolls back matches.status from 'completed' to 'in_progress'
--    so the UI shows everyone needs to re-approve.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Rewrite the immutability trigger with semantic transitions
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_match_creator_field_immutability()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin BOOLEAN := false;
BEGIN
  -- Called from inside another trigger → system change, always allow
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- League admin of this match's league → can override any rule
  IF NEW.league_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM leagues l
    WHERE l.id = NEW.league_id AND l.admin_id = auth.uid()
  ) THEN
    v_is_admin := true;
  END IF;

  -- ─────────────────────────────────────────────────────────
  -- Status transitions
  -- Allowed for any caller:
  --   scheduled   → in_progress   (someone started playing)
  --   in_progress → scheduled     (undo — admin-like reset)
  --   completed   → in_progress   (score edit re-opens approval)
  -- Completion (→ completed) must come from a trigger (pg_trigger_depth > 1)
  -- OR a league admin (force-complete override).
  -- ─────────────────────────────────────────────────────────
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'completed' AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Match status can only become completed via the score-approval flow'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Other transitions allowed; fall through
  END IF;

  -- Immutable columns (unchanged)
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

  -- (match_type column is gone after purge_casual_match_legacy.sql)

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 2. Reset approvals when a score is edited
-- ------------------------------------------------------------
-- Fires on AFTER UPDATE ON scores when score value or holes change.
-- Not firing on pure status changes (approve/unapprove) — those are
-- the approval flow itself.

CREATE OR REPLACE FUNCTION reset_approvals_on_score_edit()
RETURNS TRIGGER AS $$
BEGIN
  -- Reset every OTHER score in the match back to pending. The edited
  -- score keeps whatever status/approved_by the caller just wrote.
  UPDATE scores
  SET status = 'pending',
      approved_by = NULL,
      approved_at = NULL
  WHERE match_id = NEW.match_id
    AND id != NEW.id
    AND status = 'approved';

  -- Clear all player approvals
  UPDATE match_players
  SET approved_at = NULL
  WHERE match_id = NEW.match_id;

  -- Roll back match from completed if applicable. The immutability
  -- trigger allows completed → in_progress (see above).
  UPDATE matches
  SET status = 'in_progress'
  WHERE id = NEW.match_id AND status = 'completed';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_reset_approvals_on_score_edit ON scores;
CREATE TRIGGER trg_reset_approvals_on_score_edit
  AFTER UPDATE ON scores
  FOR EACH ROW
  WHEN (
    OLD.score IS DISTINCT FROM NEW.score
    OR OLD.holes IS DISTINCT FROM NEW.holes
  )
  EXECUTE FUNCTION reset_approvals_on_score_edit();

-- ============================================================
-- Verification
-- ============================================================
-- 1. Find a completed match with approved scores.
-- 2. As one of the players, UPDATE their score value:
--      UPDATE scores SET score = score + 1
--      WHERE match_id = '<id>' AND user_id = '<my_id>';
-- 3. Check the match + other scores:
--      SELECT status FROM matches WHERE id = '<id>';
--        -- expected: 'in_progress'
--      SELECT user_id, status FROM scores WHERE match_id = '<id>';
--        -- expected: everyone except me is 'pending'
--      SELECT user_id, approved_at FROM match_players WHERE match_id = '<id>';
--        -- expected: approved_at = NULL for everyone
-- ============================================================
