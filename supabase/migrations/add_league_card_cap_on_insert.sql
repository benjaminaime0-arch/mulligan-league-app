-- ============================================================
-- Enforce league card cap at score INSERT time (only)
-- ============================================================
-- Replaces the broader `enforce_league_card_cap` trigger that we
-- dropped in `drop_league_card_cap_trigger.sql`. The old version
-- fired on any transition *into* status='approved' and blocked the
-- normal `approve_match_scores` RPC whenever it touched a 6th-card
-- row — that broke approvals across every match in the league for
-- anyone who hit the cap.
--
-- This new version is tighter:
--   - BEFORE INSERT only. Updates (approval flow flipping pending
--     → approved) are never blocked.
--   - Counts the user's existing APPROVED scores in this match's
--     league. If they're already at `total_cards_count`, the insert
--     rejects — i.e. they can't even create a new pending card.
--   - Existing pending scores keep flowing through approval without
--     any collateral damage.
--
-- Effect on the product: a player at 5/5 approved in a league
-- literally can't submit a 6th score — the `submit_match_scores`
-- RPC call fails with a descriptive error the UI can surface. They
-- remain members of the league and can still play socially; only
-- the score-submission path is gated.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_league_card_cap_on_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_league_id uuid;
  v_cap       int;
  v_approved  int;
BEGIN
  -- Resolve the league + cap for this score's match.
  SELECT m.league_id, l.total_cards_count
  INTO v_league_id, v_cap
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  WHERE m.id = NEW.match_id;

  -- No cap configured → allow.
  IF v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- How many approved scores does this user already have in this
  -- league? Pending/rejected don't count against the cap — the
  -- semantic is "you can only have N approved cards count."
  SELECT COUNT(*)
  INTO v_approved
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  WHERE m.league_id = v_league_id
    AND s.user_id   = NEW.user_id
    AND s.status    = 'approved';

  IF v_approved >= v_cap THEN
    RAISE EXCEPTION
      'League card cap reached: you already have % approved cards (max %).',
      v_approved, v_cap
      USING ERRCODE = 'check_violation',
            HINT    = 'Delete or un-approve an existing card before submitting another.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_league_card_cap_on_insert ON scores;
CREATE TRIGGER trg_enforce_league_card_cap_on_insert
  BEFORE INSERT ON scores
  FOR EACH ROW
  EXECUTE FUNCTION enforce_league_card_cap_on_insert();

-- ============================================================
-- Verification (as a capped user)
-- ============================================================
-- 1. User A has 5 approved scores in league L with cap=5.
-- 2. INSERT INTO scores (match_id, user_id, score, status)
--      VALUES ('<a-new-match-in-L>', '<A>', 90, 'pending');
--    → expect: ERROR "League card cap reached: ..."
-- 3. Approval of an EXISTING pending score still succeeds:
--    UPDATE scores SET status='approved' WHERE id = '<pending-id>';
--    → no error (trigger is INSERT-only).
-- ============================================================
