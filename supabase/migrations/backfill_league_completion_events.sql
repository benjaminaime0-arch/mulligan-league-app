-- ============================================================
-- Backfill: league_completed + league_winner events for leagues
-- that were already complete before the trigger existed
-- ============================================================
-- `add_league_completion_events.sql` installed a trigger that fires
-- on score approvals. Leagues where every player had already hit
-- their cap BEFORE the trigger was created never got a chance to
-- produce those events — the approvals they'd need to observe
-- already happened in the past.
--
-- This migration walks every league, checks whether it meets the
-- completion condition right now, and inserts the two events for
-- any that do. Idempotent via the same EXISTS check the trigger
-- uses, so re-running is a no-op once each eligible league has its
-- events.
-- ============================================================

-- Catch leagues that already have a league_completed activity event
-- from a prior run of this migration but whose `leagues.status` is
-- still 'active'. This happens when the first version of this
-- backfill inserted the events but didn't flip status, and the outer
-- loop below would skip those leagues on re-run (because they
-- already have the event). Run this first so those leagues come up
-- to date without replaying the whole loop.
UPDATE leagues
SET status = 'completed'
WHERE status = 'active'
  AND EXISTS (
    SELECT 1
    FROM activity_events ae
    WHERE ae.league_id = leagues.id
      AND ae.event_type = 'league_completed'
  );

DO $$
DECLARE
  r               record;
  v_member_count  int;
  v_complete_cnt  int;
  v_winner_id     uuid;
  v_winner_name   text;
  v_winner_total  bigint;
BEGIN
  FOR r IN
    SELECT l.id AS league_id, l.total_cards_count, l.admin_id
    FROM leagues l
    WHERE l.total_cards_count IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM activity_events ae
        WHERE ae.league_id = l.id
          AND ae.event_type = 'league_completed'
      )
  LOOP
    -- Member count (skip empty leagues).
    SELECT COUNT(*) INTO v_member_count
    FROM league_members
    WHERE league_id = r.league_id;

    IF v_member_count = 0 THEN
      CONTINUE;
    END IF;

    -- Count members who have >= total_cards_count approved scores
    -- in this league.
    SELECT COUNT(*) INTO v_complete_cnt
    FROM (
      SELECT lm.user_id
      FROM league_members lm
      WHERE lm.league_id = r.league_id
      GROUP BY lm.user_id
      HAVING (
        SELECT COUNT(*)
        FROM scores s
        JOIN matches m ON m.id = s.match_id
        WHERE m.league_id = r.league_id
          AND s.user_id   = lm.user_id
          AND s.status    = 'approved'
      ) >= r.total_cards_count
    ) t;

    IF v_complete_cnt < v_member_count THEN
      CONTINUE;
    END IF;

    -- Complete → find winner (position 1 in leaderboard) + announce.
    SELECT lb.user_id, lb.player_name, lb.total_score
    INTO   v_winner_id, v_winner_name, v_winner_total
    FROM get_leaderboard(r.league_id) lb
    WHERE lb."position" = 1
    LIMIT 1;

    IF v_winner_id IS NOT NULL THEN
      INSERT INTO activity_events (
        event_type, league_id, actor_id, metadata
      )
      VALUES (
        'league_winner',
        r.league_id,
        v_winner_id,
        jsonb_build_object(
          'player_name', v_winner_name,
          'total_score', v_winner_total
        )
      );
    END IF;

    INSERT INTO activity_events (
      event_type, league_id, actor_id, metadata
    )
    VALUES (
      'league_completed',
      r.league_id,
      r.admin_id,
      '{}'::jsonb
    );

    -- Flip status to match — see rationale in
    -- add_league_completion_events.sql.
    UPDATE leagues
    SET status = 'completed'
    WHERE id = r.league_id
      AND status = 'active';
  END LOOP;
END $$;

-- ============================================================
-- Verify after running:
--   SELECT l.name, ae.event_type, ae.created_at
--   FROM activity_events ae
--   JOIN leagues l ON l.id = ae.league_id
--   WHERE ae.event_type IN ('league_completed', 'league_winner')
--   ORDER BY l.name, ae.created_at DESC;
-- ============================================================
