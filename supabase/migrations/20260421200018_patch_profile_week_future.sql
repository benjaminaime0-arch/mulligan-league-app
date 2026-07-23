-- ============================================================
-- Patch: shift week calendar to today + next 6 days
-- ============================================================
-- Previous version looked backward (today - 6 days .. today).
-- New version looks forward (today .. today + 6 days) so the
-- week view glances at what's coming up, with today always
-- as the leftmost day. Streak logic is unchanged (still
-- retrospective — that's what a streak is).
--
-- Run this after add_profile_dashboard_rpcs.sql.
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
  -- 7-day calendar: today + next 6 days (today is always leftmost).
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', d.day,
      'has_match', EXISTS (
        SELECT 1 FROM match_players mp
        JOIN matches m ON m.id = mp.match_id
        WHERE mp.user_id = p_user_id AND m.match_date = d.day
      )
    ) ORDER BY d.day
  ) INTO v_calendar
  FROM generate_series(
    current_date,
    (current_date + interval '6 days')::date,
    '1 day'::interval
  ) AS d(day);

  -- Current streak: consecutive weeks (back from this week) with >=1 match.
  -- Unchanged from original — streaks are retrospective.
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

    EXIT WHEN v_current_streak > 520; -- 10 years, safety bound
  END LOOP;

  -- Next upcoming match
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
