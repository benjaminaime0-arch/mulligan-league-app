-- Qualify the final badge sort: RETURNS TABLE exposes badge_key as a
-- PL/pgSQL variable, and UNION ORDER BY needs a projected result column.
-- Membership checks, grants and badge calculations are unchanged.
CREATE OR REPLACE FUNCTION public.get_game_badges(p_game_id uuid)
 RETURNS TABLE(badge_key text, user_id uuid, player_name text, avatar_url text, value numeric, unit text, sub text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_role   text := current_setting('request.jwt.claim.role', true);
  v_format text;
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF v_caller IS NULL THEN RETURN; END IF;
    IF NOT is_game_member(p_game_id, v_caller) THEN RETURN; END IF;
  END IF;

  SELECT COALESCE(l.format, 'stroke_play')
  INTO v_format
  FROM games l
  WHERE l.id = p_game_id;

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
    LEFT JOIN games l ON l.id = m.game_id
    WHERE m.game_id = p_game_id
      AND s.status    = 'approved'
  ),
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
  SELECT badges.* FROM (
    SELECT * FROM best
    UNION ALL
    SELECT * FROM most_active
    UNION ALL
    SELECT * FROM most_consistent
  ) badges
  ORDER BY CASE badges.badge_key
    WHEN 'best_round'       THEN 1
    WHEN 'most_active'      THEN 2
    WHEN 'most_consistent'  THEN 3
    ELSE 99
  END;
END;
$function$
;

