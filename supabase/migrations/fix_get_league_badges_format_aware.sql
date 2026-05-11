-- ============================================================
-- League badges RPC: direction-aware for stroke vs stableford
-- ============================================================
-- The "Lowest round" badge only makes sense in stroke play. In
-- Stableford the single-round standout is the HIGHEST total. We
-- rename the winning-round badge to `best_round` (works for both)
-- and the RPC picks min or max based on `leagues.format`.
--
-- Frontend change: `lowest_round` in the badge_key union becomes
-- `best_round`. Component switches on it to render the right label
-- ("Lowest round" for stroke, "Best round" for stableford).
--
-- `most_active` and `most_consistent` are format-agnostic — card
-- counts and score variance mean the same thing regardless of
-- whether lower or higher totals win.
--
-- Access gate inherited; safe to re-run.
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
  v_format text;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF v_caller IS NULL THEN RETURN; END IF;
    IF NOT is_league_member(p_league_id, v_caller) THEN RETURN; END IF;
  END IF;

  SELECT COALESCE(l.format, 'stroke_play')
  INTO v_format
  FROM leagues l
  WHERE l.id = p_league_id;

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
  -- Best single round — direction-aware. Stroke = lowest, Stableford
  -- = highest. Tiebreak is earliest date (first to hit it), then
  -- user_id. Emits `best_round` either way; the frontend switches
  -- its label based on league format.
  best AS (
    SELECT
      'best_round'::text                                 AS badge_key,
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
    ORDER BY
      CASE WHEN v_format = 'stableford' THEN -a.score ELSE a.score END ASC,
      a.match_date ASC NULLS LAST,
      a.user_id ASC
    LIMIT 1
  ),
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
  SELECT * FROM best
  UNION ALL
  SELECT * FROM most_active
  UNION ALL
  SELECT * FROM most_consistent
  ORDER BY CASE badge_key
    WHEN 'best_round'       THEN 1
    WHEN 'most_active'      THEN 2
    WHEN 'most_consistent'  THEN 3
    ELSE 99
  END;
END;
$$;

-- ============================================================
-- get_user_honors delegates to get_league_badges via LATERAL join.
-- The rewrite above changes the badge_key emitted from 'lowest_round'
-- to 'best_round', and the honors function's ORDER BY still references
-- the old name. Re-create it in place so the CASE stays in sync —
-- otherwise the user-honors rows end up ordered as `ELSE 99`
-- (alphabetical-by-key instead of badge-priority).
-- ============================================================

DROP FUNCTION IF EXISTS get_user_honors(uuid);

CREATE OR REPLACE FUNCTION get_user_honors(p_user_id uuid)
RETURNS TABLE (
  league_id      uuid,
  league_name    text,
  league_format  text,
  badge_key      text,
  value          numeric,
  unit           text,
  sub            text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  -- `league_format` rides along so the /profile trophy shelf can
  -- flip label/unit per row ("Lowest round 82" in one league,
  -- "Best round 37 pts" in another). A single-league-type view like
  -- `BadgesCard` on the league page already knows the format from
  -- its parent and doesn't need this column.
  SELECT
    l.id                                AS league_id,
    l.name                              AS league_name,
    COALESCE(l.format, 'stroke_play')   AS league_format,
    b.badge_key,
    b.value,
    b.unit,
    b.sub
  FROM league_members lm
  JOIN leagues l ON l.id = lm.league_id
  CROSS JOIN LATERAL get_league_badges(l.id) b
  WHERE lm.user_id = p_user_id
    AND b.user_id  = p_user_id
  ORDER BY
    l.name ASC,
    CASE b.badge_key
      WHEN 'best_round'       THEN 1
      WHEN 'most_active'      THEN 2
      WHEN 'most_consistent'  THEN 3
      ELSE 99
    END;
$$;
