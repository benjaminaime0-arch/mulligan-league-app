-- ============================================================
-- Profile dashboard RPCs: records, week stats, courses
-- ============================================================
-- Powers three new cards on /profile:
--   1. RecordsCard          → get_profile_records
--   2. WeekCalendarCard     → get_profile_week
--   3. CoursesCard          → get_profile_courses
--
-- Returns only APPROVED scores for personal records (so draft / pending
-- scores don't pollute "best round"). Weekly streak counts any match
-- the user submitted a score for, approved or not (intent-to-play
-- matters for the habit loop).
-- ============================================================

-- ------------------------------------------------------------
-- 1. get_profile_records: best round + top rival + longest streak
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_profile_records(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_best_score RECORD;
  v_top_rival RECORD;
  v_longest_streak INT;
BEGIN
  -- Best round: lowest approved score
  SELECT s.score, s.holes, s.match_id,
         COALESCE(m.course_name, l.course_name) AS course_name,
         m.match_date
  INTO v_best_score
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  LEFT JOIN leagues l ON l.id = m.league_id
  WHERE s.user_id = p_user_id AND s.status = 'approved'
  ORDER BY s.score ASC
  LIMIT 1;

  -- Top rival: opponent with the most head-to-head rounds (min 3).
  -- Tiebreak: more wins against them, then more rounds total.
  WITH user_scores AS (
    SELECT s.match_id, s.score AS my_score
    FROM scores s
    WHERE s.user_id = p_user_id AND s.status = 'approved'
  ),
  head_to_head AS (
    SELECT
      s.user_id AS opponent_id,
      us.my_score,
      s.score AS their_score
    FROM user_scores us
    JOIN scores s ON s.match_id = us.match_id
    WHERE s.user_id <> p_user_id
      AND s.status = 'approved'
  ),
  rival_stats AS (
    SELECT
      opponent_id,
      COUNT(*) AS total,
      SUM(CASE WHEN my_score < their_score THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN my_score > their_score THEN 1 ELSE 0 END) AS losses,
      SUM(CASE WHEN my_score = their_score THEN 1 ELSE 0 END) AS ties
    FROM head_to_head
    GROUP BY opponent_id
    HAVING COUNT(*) >= 3
  )
  SELECT
    rs.opponent_id AS user_id,
    COALESCE(p.username, p.first_name, 'Player') AS name,
    p.avatar_url,
    rs.wins,
    rs.losses,
    rs.ties,
    rs.total
  INTO v_top_rival
  FROM rival_stats rs
  JOIN profiles p ON p.id = rs.opponent_id
  ORDER BY rs.total DESC, rs.wins DESC
  LIMIT 1;

  -- Longest play streak: largest run of consecutive ISO weeks in which
  -- the user has at least one match with a score.
  -- Gap-and-islands pattern: subtract row_number * 7 days from each
  -- week; consecutive weeks share the same island value.
  WITH weeks_played AS (
    SELECT DISTINCT date_trunc('week', m.match_date)::date AS week
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND m.match_date IS NOT NULL
  ),
  numbered AS (
    SELECT week, ROW_NUMBER() OVER (ORDER BY week) AS rn
    FROM weeks_played
  ),
  islands AS (
    SELECT week, (week - (rn * interval '7 days'))::date AS island
    FROM numbered
  )
  SELECT COALESCE(MAX(cnt), 0) INTO v_longest_streak
  FROM (SELECT COUNT(*) AS cnt FROM islands GROUP BY island) t;

  RETURN jsonb_build_object(
    'best_score', CASE
      WHEN v_best_score.score IS NULL THEN NULL
      ELSE jsonb_build_object(
        'score', v_best_score.score,
        'holes', v_best_score.holes,
        'match_id', v_best_score.match_id,
        'course_name', v_best_score.course_name,
        'match_date', v_best_score.match_date
      )
    END,
    'top_rival', CASE
      WHEN v_top_rival.user_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'user_id', v_top_rival.user_id,
        'name', v_top_rival.name,
        'avatar_url', v_top_rival.avatar_url,
        'wins', v_top_rival.wins,
        'losses', v_top_rival.losses,
        'ties', v_top_rival.ties,
        'total', v_top_rival.total
      )
    END,
    'longest_streak_weeks', v_longest_streak
  );
END;
$$;

-- ------------------------------------------------------------
-- 2. get_profile_week: 7-day calendar + current streak + next match
-- ------------------------------------------------------------

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
  -- 7-day calendar ending today (Mon..Sun anchored on today).
  -- Each day: does the user have a scheduled/played match that day?
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
    (current_date - interval '6 days')::date,
    current_date,
    '1 day'::interval
  ) AS d(day);

  -- Current streak: consecutive weeks (back from this week) with >=1 match
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

    -- Safety bound (avoid runaway if something's off with the data)
    EXIT WHEN v_current_streak > 520;  -- 10 years
  END LOOP;

  -- Next upcoming match the user is a part of
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

-- ------------------------------------------------------------
-- 3. get_profile_courses: unique courses with play counts + PRs
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_profile_courses(p_user_id UUID)
RETURNS TABLE (
  course_name TEXT,
  times_played BIGINT,
  best_score INT,
  last_played_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(m.course_name, l.course_name, 'Unknown course')::TEXT AS course_name,
    COUNT(DISTINCT m.id) AS times_played,
    MIN(s.score) FILTER (WHERE s.status = 'approved')::INT AS best_score,
    MAX(m.match_date) AS last_played_date
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  LEFT JOIN leagues l ON l.id = m.league_id
  LEFT JOIN scores s ON s.match_id = m.id AND s.user_id = mp.user_id
  WHERE mp.user_id = p_user_id
  GROUP BY COALESCE(m.course_name, l.course_name, 'Unknown course')
  ORDER BY times_played DESC, MAX(m.match_date) DESC NULLS LAST;
END;
$$;
