-- ============================================================
-- Leaderboard RPC: always include every league member
-- ============================================================
-- Previous version (`fix_get_leaderboard_with_avatar.sql`) returned
-- only players who had approved scores. Brand-new leagues with
-- members but no rounds played showed "The board is empty" even
-- though the roster was right there.
--
-- New behaviour:
--   - Start the result set from `league_members` (left side).
--   - LEFT JOIN the player_totals CTE so members with zero rounds
--     still appear — their score/rounds fields come back as 0
--     (or NULL for best_score, which the UI renders as "–").
--   - Sort: players with at least one counted round first (ordered
--     by total_score ASC — stroke play = lower is better); then
--     everyone else. Stable tiebreak on username so the ordering
--     is deterministic.
--
-- Signature unchanged vs previous revision, so the frontend's
-- LeaderboardRow type still matches without edits.
--
-- Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS get_leaderboard(uuid);

CREATE OR REPLACE FUNCTION get_leaderboard(p_league_id uuid)
RETURNS TABLE (
  "position" bigint,
  user_id uuid,
  player_name text,
  avatar_url text,
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
  v_total_cards   int;
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
      AND s.status    = 'approved'
  ),
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
  eligible AS (
    SELECT c.user_id, c.score
    FROM chrono c
    WHERE v_total_cards IS NULL OR c.chrono_rn <= v_total_cards
  ),
  ranked AS (
    SELECT
      e.user_id,
      e.score,
      ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.score ASC) AS rn,
      COUNT(*)    OVER (PARTITION BY e.user_id) AS eligible_count
    FROM eligible e
  ),
  player_totals AS (
    SELECT
      r.user_id,
      MIN(r.score)                    AS best_score,
      SUM(r.score)::bigint            AS total_score,
      COUNT(*)::bigint                AS rounds_counted,
      MAX(r.eligible_count)::bigint   AS rounds_played
    FROM ranked r
    WHERE v_scoring_cards IS NULL OR r.rn <= v_scoring_cards
    GROUP BY r.user_id
  ),
  -- Anchor the board on league_members so everyone shows up, not
  -- just those with approved scores. Explicit ::bigint casts match
  -- the RETURNS TABLE signature — without the best_score cast
  -- Postgres throws "structure of query does not match function
  -- result type" because MIN(scores.score) comes back as integer.
  board AS (
    SELECT
      lm.user_id,
      pt.best_score::bigint                  AS best_score,
      COALESCE(pt.total_score, 0)::bigint    AS total_score,
      COALESCE(pt.rounds_counted, 0)::bigint AS rounds_counted,
      COALESCE(pt.rounds_played, 0)::bigint  AS rounds_played
    FROM league_members lm
    LEFT JOIN player_totals pt ON pt.user_id = lm.user_id
    WHERE lm.league_id = p_league_id
  )
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY
        -- Players with at least one counted round first.
        CASE WHEN b.rounds_counted > 0 THEN 0 ELSE 1 END,
        -- Within each bucket, stroke play = lower total is better.
        b.total_score ASC,
        -- Stable tiebreak so position numbering doesn't shuffle
        -- between renders when two members have identical scores.
        p.username ASC NULLS LAST,
        b.user_id ASC
    )::bigint                                                  AS "position",
    b.user_id                                                  AS user_id,
    COALESCE(p.username, p.first_name, 'Player')::text         AS player_name,
    p.avatar_url::text                                         AS avatar_url,
    b.best_score,
    b.total_score,
    b.rounds_counted,
    b.rounds_played
  FROM board b
  JOIN profiles p ON p.id = b.user_id
  ORDER BY
    CASE WHEN b.rounds_counted > 0 THEN 0 ELSE 1 END,
    b.total_score ASC,
    p.username ASC NULLS LAST,
    b.user_id ASC;
END;
$$;
