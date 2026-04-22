-- ============================================================
-- Enforce league.total_cards_count as a hard cap per player
-- ============================================================
-- Until now, total_cards_count was only a label — the subtitle
-- read "Best 3 of 5 cards" but nothing in the DB stopped a player
-- from submitting 10, 20, or any number of approved scores in the
-- same league. This trigger makes the cap real:
--
--   On INSERT or UPDATE of scores, whenever a row transitions INTO
--   status='approved', count the player's existing approved scores
--   in that match's league. If they already have
--   total_cards_count approved, reject the change.
--
-- Scope notes:
--   • OLD approved rows are left alone — no cascading re-checks,
--     so re-approving an existing row (score edit flow) never
--     triggers a false positive.
--   • total_cards_count IS NULL → no cap, nothing changes.
--   • rejected / pending statuses are never counted, so a player
--     can still have an open pending 6th card; it just can't
--     become approved until they free a slot.
--   • Historical overflows (players with > cap approved from the
--     pre-enforcement era) stay in the DB untouched. The leaderboard
--     RPC handles hiding them from the ranking — see
--     fix_get_leaderboard_card_cap.sql.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_league_card_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_cap        int;
  v_count      int;
  v_league_id  uuid;
  v_becoming_approved boolean;
BEGIN
  -- Only care when THIS row is newly approved. Already-approved
  -- rows on UPDATE (status unchanged) must pass through untouched,
  -- otherwise the score-edit re-approval flow breaks.
  v_becoming_approved := (
    NEW.status = 'approved'
    AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')
  );
  IF NOT v_becoming_approved THEN
    RETURN NEW;
  END IF;

  -- Resolve this score's league + cap
  SELECT m.league_id, l.total_cards_count
  INTO v_league_id, v_cap
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  WHERE m.id = NEW.match_id;

  IF v_cap IS NULL THEN
    RETURN NEW; -- no cap configured on this league
  END IF;

  -- Count the player's OTHER approved scores in this league.
  SELECT COUNT(*) INTO v_count
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  WHERE m.league_id = v_league_id
    AND s.user_id   = NEW.user_id
    AND s.status    = 'approved'
    AND s.id       <> NEW.id;

  IF v_count >= v_cap THEN
    RAISE EXCEPTION
      'League card cap reached: player already has % approved scores (max %).',
      v_count, v_cap
      USING ERRCODE = 'check_violation',
            HINT    = 'Delete or un-approve an existing card before approving another.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_league_card_cap ON scores;
CREATE TRIGGER trg_enforce_league_card_cap
  BEFORE INSERT OR UPDATE ON scores
  FOR EACH ROW
  EXECUTE FUNCTION enforce_league_card_cap();
