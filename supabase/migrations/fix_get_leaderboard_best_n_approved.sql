-- Fix get_leaderboard: add total_score, rounds_counted columns
-- and only count approved scores, with best-N logic

DROP FUNCTION IF EXISTS get_leaderboard(uuid);

CREATE OR REPLACE FUNCTION get_leaderboard(p_league_id uuid)
RETURNS TABLE (
  position bigint,
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
BEGIN
  -- Get the league's scoring_cards_count (best N to count)
  SELECT l.scoring_cards_count INTO v_scoring_cards
  FROM leagues l
  WHERE l.id = p_league_id;

  RETURN QUERY
  WITH approved_scores AS (
    SELECT
      s.user_id,
      s.score
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE m.league_id = p_league_id
      AND s.status = 'approved'
  ),
  ranked_scores AS (
    SELECT
      a.user_id,
      a.score,
      ROW_NUMBER() OVER (PARTITION BY a.user_id ORDER BY a.score ASC) AS rn,
      COUNT(*) OVER (PARTITION BY a.user_id) AS total_rounds
    FROM approved_scores a
  ),
  player_totals AS (
    SELECT
      rs.user_id,
      MIN(rs.score) AS best_score,
      SUM(rs.score)::bigint AS total_score,
      COUNT(*)::bigint AS rounds_counted,
      MAX(rs.total_rounds)::bigint AS rounds_played
    FROM ranked_scores rs
    WHERE v_scoring_cards IS NULL OR rs.rn <= v_scoring_cards
    GROUP BY rs.user_id
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY pt.total_score ASC)::bigint AS position,
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
