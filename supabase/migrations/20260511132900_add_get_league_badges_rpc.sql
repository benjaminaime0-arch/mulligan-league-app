-- ============================================================
-- League badges RPC: compute "honors" on read, no persistence
-- ============================================================
-- Badges are a projection of existing data, not a fact we store.
-- This RPC returns 0–N rows, one per earned badge, ordered by a
-- stable `badge_key` so the frontend can render them in a
-- predictable order without extra sorting.
--
-- MVP set (3 badges):
--   lowest_round    — single lowest approved score in the league.
--                     Always awarded if anyone has played.
--   most_active     — most approved cards submitted (min 2).
--   most_consistent — lowest STDDEV(score), min 3 rounds. Omitted
--                     entirely when no player has ≥3 approved
--                     scores (common in early-league weeks).
--
-- SECURITY DEFINER with a member-only gate (same pattern as the
-- patched `get_leaderboard`). Reuses `is_league_member` so the
-- access check stays consistent across read-side RPCs.
-- ============================================================

DROP FUNCTION IF EXISTS get_league_badges(uuid);

CREATE OR REPLACE FUNCTION get_league_badges(p_league_id uuid)
RETURNS TABLE (
  badge_key    text,
  user_id      uuid,
  player_name  text,
  avatar_url   text,
  value        numeric,
  unit         text,
  sub          text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text := current_setting('request.jwt.claim.role', true);
BEGIN
  -- Access gate. Service role always passes so edge functions keep
  -- working. Anon + non-members get nothing.
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF v_caller IS NULL THEN RETURN; END IF;
    IF NOT is_league_member(p_league_id, v_caller) THEN RETURN; END IF;
  END IF;

  -- Collected approved scores scoped to this league, once. Each
  -- badge subquery pulls from this CTE to keep the query plan tight.
  RETURN QUERY
  WITH approved AS (
    SELECT
      s.user_id,
      s.score,
      s.match_id,
      m.match_date,
      COALESCE(m.course_name, l.course_name) AS course_name
    FROM scores s
    JOIN matches  m ON m.id = s.match_id
    LEFT JOIN leagues l ON l.id = m.league_id
    WHERE m.league_id = p_league_id
      AND s.status    = 'approved'
  ),
  -- 1. Lowest round: the single best approved score. Tiebreak:
  -- earliest date (first to achieve it), then user_id for determinism.
  lowest AS (
    SELECT
      'lowest_round'::text                               AS badge_key,
      a.user_id,
      COALESCE(p.username, p.first_name, 'Player')::text AS player_name,
      p.avatar_url::text                                 AS avatar_url,
      a.score::numeric                                   AS value,
      'score'::text                                      AS unit,
      (
        COALESCE(a.course_name, 'Course TBA') ||
        CASE
          WHEN a.match_date IS NOT NULL
            THEN ' · ' || to_char(a.match_date, 'Mon DD')
          ELSE ''
        END
      )::text                                            AS sub
    FROM approved a
    JOIN profiles p ON p.id = a.user_id
    ORDER BY a.score ASC, a.match_date ASC NULLS LAST, a.user_id ASC
    LIMIT 1
  ),
  -- 2. Most active: most approved cards. Min 2 so a single-card
  -- player doesn't "win" by default in a brand-new league.
  most_active AS (
    SELECT
      'most_active'::text                                AS badge_key,
      t.user_id,
      COALESCE(p.username, p.first_name, 'Player')::text AS player_name,
      p.avatar_url::text                                 AS avatar_url,
      t.cnt::numeric                                     AS value,
      CASE WHEN t.cnt = 1 THEN 'round' ELSE 'rounds' END AS unit,
      'Most cards submitted'::text                       AS sub
    FROM (
      SELECT a.user_id, COUNT(*)::int AS cnt
      FROM approved a
      GROUP BY a.user_id
      HAVING COUNT(*) >= 2
      ORDER BY COUNT(*) DESC, a.user_id ASC
      LIMIT 1
    ) t
    JOIN profiles p ON p.id = t.user_id
  ),
  -- 3. Most consistent: lowest STDDEV across ≥3 approved scores.
  -- Rounded to 1 decimal on the way out so the UI can print it
  -- naturally ("±3.2"). Omitted when nobody has 3+ rounds.
  most_consistent AS (
    SELECT
      'most_consistent'::text                            AS badge_key,
      t.user_id,
      COALESCE(p.username, p.first_name, 'Player')::text AS player_name,
      p.avatar_url::text                                 AS avatar_url,
      ROUND(t.sd::numeric, 1)                            AS value,
      'spread'::text                                     AS unit,
      ('across ' || t.cnt || ' rounds')::text            AS sub
    FROM (
      SELECT
        a.user_id,
        STDDEV_SAMP(a.score::numeric) AS sd,
        COUNT(*)::int                 AS cnt
      FROM approved a
      GROUP BY a.user_id
      HAVING COUNT(*) >= 3
        AND STDDEV_SAMP(a.score::numeric) IS NOT NULL
      ORDER BY STDDEV_SAMP(a.score::numeric) ASC, a.user_id ASC
      LIMIT 1
    ) t
    JOIN profiles p ON p.id = t.user_id
  )
  SELECT * FROM lowest
  UNION ALL
  SELECT * FROM most_active
  UNION ALL
  SELECT * FROM most_consistent
  -- Stable render order regardless of how UNION ALL materialises:
  -- lowest is the headline badge, most_active is engagement,
  -- most_consistent is the "craft" badge. Frontend preserves this.
  ORDER BY CASE badge_key
    WHEN 'lowest_round'     THEN 1
    WHEN 'most_active'      THEN 2
    WHEN 'most_consistent'  THEN 3
    ELSE 99
  END;
END;
$$;

-- ============================================================
-- Verification
-- ============================================================
-- As a member of a league with some approved scores:
--   SELECT * FROM get_league_badges('<league-id>');
-- Expect 1–3 rows depending on how much has been played.
--
-- As a non-member (sign in, then):
--   SELECT * FROM get_league_badges('<other-league-id>');
-- Expect: zero rows (no leak).
-- ============================================================
