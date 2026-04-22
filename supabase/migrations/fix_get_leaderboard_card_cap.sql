-- ============================================================
-- Leaderboard: honor total_cards_count as a chronological cap
-- ============================================================
-- Previous RPC (fix_get_leaderboard_best_n_approved.sql) read only
-- scoring_cards_count (the "3"), never total_cards_count (the "5").
-- That's why a league advertising "Best 3 of 5" rendered "3/10" for
-- a player who had played 10 times.
--
-- New behaviour:
--   1. Take the player's approved scores, ordered chronologically
--      by match_date then created_at (stable: scores submitted
--      earlier are "your first cards").
--   2. Keep only the first total_cards_count — those are the
--      player's eligible cards. Anything beyond the cap is
--      historical noise, not counted.
--   3. From the eligible slice, take the best scoring_cards_count
--      cards as Total.
--
-- rounds_played now reports eligible cards (<= total_cards_count),
-- so the board reads "3/5" as the subtitle promises. Full history
-- stays available via get_player_round_history.
--
-- Matches the trigger in add_enforce_league_card_cap.sql which
-- blocks future overflows at the source.
-- ============================================================

DROP FUNCTION IF EXISTS get_leaderboard(uuid);

-- NOTE: "position" is quoted because Postgres reserves it as a
-- function-call shape (POSITION(x IN y)) and refuses it as a bare
-- column name inside RETURNS TABLE on some server versions. Quoting
-- forces identifier parsing. The output column name is still
-- `position` — no frontend change needed.
CREATE OR REPLACE FUNCTION get_leaderboard(p_league_id uuid)
RETURNS TABLE (
  "position" bigint,
  player_name text,
  best_score bigint,
  total_score bigint,
  rounds_counted bigint,
  rounds_played bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_scoring_cards int;
  v_total_cards int;
BEGIN
  SELECT l.scoring_cards_count, l.total_cards_count
  INTO v_scoring_cards, v_total_cards
  FROM leagues l
  WHERE l.id = p_league_id;

  RETURN QUERY
  WITH approved_scores AS (
    SELECT
      s.id,
      s.user_id,
      s.score,
      m.match_date,
      s.created_at
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE m.league_id = p_league_id
      AND s.status = 'approved'
  ),
  -- Chronological order per player. Stable tiebreakers (created_at,
  -- then id) so "first 5" is deterministic across calls.
  chrono AS (
    SELECT
      a.id,
      a.user_id,
      a.score,
      ROW_NUMBER() OVER (
        PARTITION BY a.user_id
        ORDER BY a.match_date ASC NULLS LAST, a.created_at ASC, a.id ASC
      ) AS chrono_rn
    FROM approved_scores a
  ),
  -- Keep only the first N cards per player (the cap). Everything
  -- past the cap is historical overflow and excluded from scoring.
  eligible AS (
    SELECT c.user_id, c.score
    FROM chrono c
    WHERE v_total_cards IS NULL OR c.chrono_rn <= v_total_cards
  ),
  -- Rank eligible cards by score; best-N will feed Total.
  ranked AS (
    SELECT
      e.user_id,
      e.score,
      ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.score ASC) AS rn,
      COUNT(*) OVER (PARTITION BY e.user_id) AS eligible_count
    FROM eligible e
  ),
  player_totals AS (
    SELECT
      r.user_id,
      MIN(r.score) AS best_score,
      SUM(r.score)::bigint AS total_score,
      COUNT(*)::bigint AS rounds_counted,
      MAX(r.eligible_count)::bigint AS rounds_played
    FROM ranked r
    WHERE v_scoring_cards IS NULL OR r.rn <= v_scoring_cards
    GROUP BY r.user_id
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY pt.total_score ASC)::bigint AS "position",
    COALESCE(p.first_name || ' ' || p.last_name, 'Player')::text AS player_name,
    pt.best_score::bigint,
    pt.total_score::bigint,
    pt.rounds_counted::bigint,
    pt.rounds_played::bigint
  FROM player_totals pt
  JOIN profiles p ON p.id = pt.user_id
  ORDER BY pt.total_score ASC;
END;
$$;
