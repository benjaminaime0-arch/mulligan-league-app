-- ============================================================
-- Leaderboard RPC: include user_id + avatar_url + username
-- ============================================================
-- Previous version (`fix_get_leaderboard_card_cap.sql`) returned only
-- position/player_name/best_score/total_score/rounds_counted/rounds_played.
-- The frontend's LeaderboardRow type has fields for `user_id` and
-- `avatar_url` but they always came back null, so every row
-- collapsed to the fallback initial-letter avatar (no profile
-- pictures anywhere on the leaderboard — league page, global
-- /leaderboard page, and anywhere else the RPC feeds into).
--
-- This rewrite:
--   - Adds `user_id uuid` so the row can link to /players/:id and
--     the "you" highlight can match by user id.
--   - Adds `avatar_url text` so the UI can render the real picture.
--   - Switches player_name preference to username → first_name →
--     'Player', matching how the rest of the app picks a display
--     name (previously concatenated first_name + last_name which
--     read as "null null" for users with only a username).
--
-- Signature change → DROP + CREATE (no CREATE OR REPLACE).
-- Safe to re-run (DROP IF EXISTS is a no-op when the sig matches).
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
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY pt.total_score ASC)::bigint                                AS "position",
    pt.user_id                                                                              AS user_id,
    COALESCE(p.username, p.first_name, 'Player')::text                                      AS player_name,
    p.avatar_url::text                                                                      AS avatar_url,
    pt.best_score::bigint,
    pt.total_score::bigint,
    pt.rounds_counted::bigint,
    pt.rounds_played::bigint
  FROM player_totals pt
  JOIN profiles p ON p.id = pt.user_id
  ORDER BY pt.total_score ASC;
END;
$$;
