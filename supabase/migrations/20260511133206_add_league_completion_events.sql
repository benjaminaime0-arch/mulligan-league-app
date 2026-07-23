-- ============================================================
-- Emit league_winner + league_completed activity events
-- ============================================================
-- When the last approval lands that pushes every member of a league
-- up to their total_cards_count of approved scores, the league is
-- effectively complete. We want the activity feed to recognize that
-- moment and post two announcement events:
--
--   league_winner    → "Congrats <name> for the win"
--   league_completed → "All rounds completed"
--
-- Both inserted atomically from the trigger so the activity feed
-- naturally surfaces them at the top (most recent). Idempotent via a
-- guard check against a prior `league_completed` row for the same
-- league.
--
-- Trigger fires on `scores` AFTER UPDATE when status transitions
-- INTO 'approved'. Also fires on INSERT where status is already
-- approved (rare, but covered). Winner is resolved by calling the
-- existing `get_leaderboard` RPC — reuses the same first-N-
-- chronological + best-M-by-score logic that drives the UI.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION check_league_completion_on_score_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_league_id       uuid;
  v_admin_id        uuid;
  v_cap             int;
  v_member_count    int;
  v_complete_count  int;
  v_already_done    boolean;
  v_winner_id       uuid;
  v_winner_name     text;
  v_winner_total    bigint;
BEGIN
  -- Only care about transitions INTO approved. On INSERT, OLD is
  -- implicitly null so we check via TG_OP. On UPDATE, we require a
  -- transition (OLD.status != 'approved') so no-op approvals don't
  -- re-trigger the check needlessly.
  IF NEW.status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Resolve league + cap + admin.
  SELECT m.league_id, l.total_cards_count, l.admin_id
  INTO   v_league_id, v_cap, v_admin_id
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  WHERE m.id = NEW.match_id;

  IF v_league_id IS NULL OR v_cap IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotency: if we've already announced completion for this
  -- league, bail. A subsequent approval after a score edit won't
  -- re-post the "congrats" — once the league is done, it's done.
  SELECT EXISTS (
    SELECT 1
    FROM activity_events
    WHERE league_id = v_league_id
      AND event_type = 'league_completed'
  )
  INTO v_already_done;
  IF v_already_done THEN
    RETURN NEW;
  END IF;

  -- Count members + members who have reached the cap. If not
  -- everyone's filled their allowance with approved scores, the
  -- league isn't done.
  SELECT COUNT(*) INTO v_member_count
  FROM league_members
  WHERE league_id = v_league_id;

  IF v_member_count = 0 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_complete_count
  FROM (
    SELECT lm.user_id
    FROM league_members lm
    WHERE lm.league_id = v_league_id
    GROUP BY lm.user_id
    HAVING (
      SELECT COUNT(*)
      FROM scores s
      JOIN matches m2 ON m2.id = s.match_id
      WHERE m2.league_id = v_league_id
        AND s.user_id    = lm.user_id
        AND s.status     = 'approved'
    ) >= v_cap
  ) t;

  IF v_complete_count < v_member_count THEN
    RETURN NEW;
  END IF;

  -- All members hit cap with approved scores → announce.
  -- Winner comes from the live leaderboard (position=1). Reusing
  -- get_leaderboard keeps the winner-selection logic in ONE place
  -- so the feed can never contradict the standings.
  SELECT lb.user_id, lb.player_name, lb.total_score
  INTO   v_winner_id, v_winner_name, v_winner_total
  FROM get_leaderboard(v_league_id) lb
  WHERE lb."position" = 1
  LIMIT 1;

  IF v_winner_id IS NOT NULL THEN
    -- Winner event — actor is the winner; metadata carries their
    -- total for future richer rendering (e.g., "won with 285").
    INSERT INTO activity_events (
      event_type, league_id, actor_id, metadata
    )
    VALUES (
      'league_winner',
      v_league_id,
      v_winner_id,
      jsonb_build_object(
        'player_name', v_winner_name,
        'total_score', v_winner_total
      )
    );
  END IF;

  -- Completion event — no meaningful actor, so we use the league
  -- admin as a placeholder (the actor_id column is NOT NULL). The
  -- frontend ignores actor_name for this event_type and renders
  -- "All rounds completed" as a plain announcement row.
  INSERT INTO activity_events (
    event_type, league_id, actor_id, metadata
  )
  VALUES (
    'league_completed',
    v_league_id,
    v_admin_id,
    '{}'::jsonb
  );

  -- Flip the league's own status to 'completed' so the header
  -- progress bar stops counting days-left and the app can branch
  -- on status anywhere else it needs to. Guarded against no-op so
  -- the match-immutability trigger doesn't see a meaningless
  -- transition. Only updates when status was previously 'active'.
  UPDATE leagues
  SET status = 'completed'
  WHERE id = v_league_id
    AND status = 'active';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_check_league_completion_on_score_approval ON scores;
CREATE TRIGGER trg_check_league_completion_on_score_approval
  AFTER INSERT OR UPDATE OF status ON scores
  FOR EACH ROW
  EXECUTE FUNCTION check_league_completion_on_score_approval();

-- ============================================================
-- Verification
-- ============================================================
-- 1. Seed a league where all members have (cap - 1) approved scores.
-- 2. Approve the last outstanding score.
-- 3. Query activity_events for that league:
--    SELECT event_type, metadata, created_at
--    FROM activity_events
--    WHERE league_id = '<id>'
--    ORDER BY created_at DESC
--    LIMIT 5;
--    → expect: league_completed (top), league_winner (just under)
-- 4. Approve another score (e.g., after an admin un-approves + re-
--    approves) → no duplicate events (idempotency holds).
-- ============================================================
