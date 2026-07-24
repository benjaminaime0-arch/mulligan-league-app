-- ============================================================
-- Patch: enrich each day in the week calendar with match details
-- ============================================================
-- Previous behaviour: calendar had has_match per day, and the
-- "Next up" tile always showed the next upcoming match. Users
-- couldn't see other days' matches without leaving the profile.
--
-- New behaviour: each day in the calendar carries the full details
-- (match_id, match_time, course_name, league_name) of the first
-- match that day. The client treats the calendar as a day-selector;
-- tapping a dot updates the tile below to show that day's match.
--
-- Implementation: single LEFT JOIN on a CTE of "matches in the
-- next 7 days for this user" — no per-day subqueries.
--
-- Safe to re-run (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION get_profile_week(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_calendar JSONB;
  v_current_streak INT := 0;
  v_next_match RECORD;
  v_week_cursor DATE;
  v_has_match BOOLEAN;
BEGIN
  -- 7-day calendar (today + 6). Each day carries the first
  -- match's details when the user has one that day.
  WITH day_matches AS (
    SELECT DISTINCT ON (m.match_date)
      m.match_date,
      m.id AS match_id,
      m.match_time,
      COALESCE(m.course_name, l.course_name) AS course_name,
      l.name AS league_name
    FROM match_players mp
    JOIN matches m ON m.id = mp.match_id
    LEFT JOIN leagues l ON l.id = m.league_id
    WHERE mp.user_id = p_user_id
      AND m.match_date >= current_date
      AND m.match_date <= (current_date + interval '6 days')::date
    ORDER BY m.match_date, m.match_time NULLS LAST
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', d.day,
      'has_match', dm.match_id IS NOT NULL,
      'match_id', dm.match_id,
      'match_time', dm.match_time,
      'course_name', dm.course_name,
      'league_name', dm.league_name
    ) ORDER BY d.day
  ) INTO v_calendar
  FROM generate_series(
    current_date,
    (current_date + interval '6 days')::date,
    '1 day'::interval
  ) AS d(day)
  LEFT JOIN day_matches dm ON dm.match_date = d.day;

  -- Streak logic unchanged
  v_week_cursor := date_trunc('week', current_date)::date;
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM match_players mp
      JOIN matches m ON m.id = mp.match_id
      WHERE mp.user_id = p_user_id
        AND date_trunc('week', m.match_date)::date = v_week_cursor
    ) INTO v_has_match;

    EXIT WHEN NOT v_has_match;
    v_current_streak := v_current_streak + 1;
    v_week_cursor := (v_week_cursor - interval '7 days')::date;

    EXIT WHEN v_current_streak > 520;
  END LOOP;

  -- Keep next_match in response for back-compat (current component
  -- ignores it after this patch).
  SELECT m.id, m.match_date, m.match_time,
         COALESCE(m.course_name, l.course_name) AS course_name,
         l.name AS league_name
  INTO v_next_match
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  LEFT JOIN leagues l ON l.id = m.league_id
  WHERE mp.user_id = p_user_id
    AND m.status IN ('scheduled', 'in_progress')
    AND m.match_date >= current_date
  ORDER BY m.match_date ASC, m.match_time ASC NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'current_streak_weeks', v_current_streak,
    'calendar', COALESCE(v_calendar, '[]'::jsonb),
    'next_match', CASE
      WHEN v_next_match.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'match_id', v_next_match.id,
        'match_date', v_next_match.match_date,
        'match_time', v_next_match.match_time,
        'course_name', v_next_match.course_name,
        'league_name', v_next_match.league_name
      )
    END
  );
END;
$$;
