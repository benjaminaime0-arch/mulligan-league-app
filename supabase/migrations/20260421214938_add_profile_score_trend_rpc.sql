-- ============================================================
-- get_profile_score_trend: data for the ScoreTrendCard
-- ============================================================
-- Returns the user's last 20 approved 18-hole scores plus summary
-- averages for the first and second halves so the UI can render:
--   • a spark line over the 20 points
--   • "You're X strokes better than 10 rounds ago"
--
-- Note: handicap is self-reported (profiles.handicap). The *actual*
-- trajectory lives in approved scores. This RPC gives the client
-- enough to visualise that trajectory.
-- ============================================================

CREATE OR REPLACE FUNCTION get_profile_score_trend(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points JSONB;
  v_count INT;
  v_recent_avg NUMERIC;
  v_previous_avg NUMERIC;
BEGIN
  -- Last 20 approved 18-hole rounds, oldest → newest (for left-to-right chart)
  WITH ordered AS (
    SELECT s.score, m.match_date, s.match_id
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND s.holes = 18
      AND m.match_date IS NOT NULL
    ORDER BY m.match_date DESC, s.created_at DESC
    LIMIT 20
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'score', score,
        'date', match_date,
        'match_id', match_id
      )
      ORDER BY match_date ASC
    ),
    COUNT(*)
  INTO v_points, v_count
  FROM ordered;

  -- Recent avg = last 10 rounds (most recent)
  SELECT AVG(score) INTO v_recent_avg
  FROM (
    SELECT s.score
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND s.holes = 18
      AND m.match_date IS NOT NULL
    ORDER BY m.match_date DESC, s.created_at DESC
    LIMIT 10
  ) sub;

  -- Previous avg = rounds 11-20 (the 10 before the recent 10)
  SELECT AVG(score) INTO v_previous_avg
  FROM (
    SELECT s.score
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND s.holes = 18
      AND m.match_date IS NOT NULL
    ORDER BY m.match_date DESC, s.created_at DESC
    OFFSET 10 LIMIT 10
  ) sub;

  RETURN jsonb_build_object(
    'points', COALESCE(v_points, '[]'::jsonb),
    'total_rounds', v_count,
    'recent_avg', CASE WHEN v_recent_avg IS NULL THEN NULL ELSE ROUND(v_recent_avg, 1) END,
    'previous_avg', CASE WHEN v_previous_avg IS NULL THEN NULL ELSE ROUND(v_previous_avg, 1) END,
    'change', CASE
      WHEN v_recent_avg IS NULL OR v_previous_avg IS NULL THEN NULL
      ELSE ROUND(v_recent_avg - v_previous_avg, 1)
    END
  );
END;
$$;
