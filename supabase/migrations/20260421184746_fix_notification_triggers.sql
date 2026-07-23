-- ============================================================
-- Fix notification triggers: score approval + match scheduled
-- ============================================================

-- ------------------------------------------------------------
-- 1. trg_score_approved: skip no-op UPDATEs
-- ------------------------------------------------------------
-- OLD: trigger fires on every match_players UPDATE, even unrelated
-- column changes (handicap, etc). Function body already guards,
-- but the plpgsql call itself is wasteful.
-- NEW: trigger's WHEN clause filters at the trigger layer so the
-- function is only invoked when approved_at actually changes.

DROP TRIGGER IF EXISTS trg_score_approved ON match_players;
CREATE TRIGGER trg_score_approved
  AFTER UPDATE ON match_players
  FOR EACH ROW
  WHEN (OLD.approved_at IS DISTINCT FROM NEW.approved_at)
  EXECUTE FUNCTION notify_score_approved();

-- ------------------------------------------------------------
-- 2. Replace trg_match_scheduled with per-player trigger
-- ------------------------------------------------------------
-- OLD (broken): trigger fires on matches INSERT. It iterates
-- match_players to notify them — but match_players rows are
-- inserted in a SECOND statement after the match, so the loop
-- is empty and nobody gets notified.
-- NEW: trigger fires on match_players INSERT. Each added player
-- gets exactly one notification when they're added to a scheduled
-- league match. The match creator is excluded (they know they
-- scheduled their own match).

DROP TRIGGER IF EXISTS trg_match_scheduled ON matches;

CREATE OR REPLACE FUNCTION notify_match_player_added()
RETURNS TRIGGER AS $$
DECLARE
  v_match RECORD;
BEGIN
  SELECT m.status, m.course_name, m.league_id, m.match_date, m.created_by,
         l.name AS league_name
  INTO v_match
  FROM matches m
  LEFT JOIN leagues l ON l.id = m.league_id
  WHERE m.id = NEW.match_id;

  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_match.status IS DISTINCT FROM 'scheduled' THEN RETURN NEW; END IF;
  IF v_match.league_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.user_id = v_match.created_by THEN RETURN NEW; END IF;

  PERFORM create_notification(
    NEW.user_id,
    'match_scheduled',
    'You''ve been added to a match',
    'In ' || COALESCE(v_match.league_name, 'your league') ||
      ' at ' || COALESCE(v_match.course_name, 'TBA') ||
      ' on ' || COALESCE(to_char(v_match.match_date, 'Mon DD'), 'TBA'),
    jsonb_build_object(
      'match_id', NEW.match_id,
      'league_id', v_match.league_id,
      'league_name', v_match.league_name,
      'match_date', v_match.match_date
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_match_player_added ON match_players;
CREATE TRIGGER trg_match_player_added
  AFTER INSERT ON match_players
  FOR EACH ROW
  EXECUTE FUNCTION notify_match_player_added();
