-- ============================================================
-- Patch: add p_range parameter to get_profile_score_trend
-- ============================================================
-- Previously returned only the last 20 rounds. Now accepts:
--   'week'   → last 7 days
--   'month'  → last 30 days
--   'year'   → last 365 days
--   'recent' → last 20 rounds (default; preserves old behaviour)
--
-- recent_avg = average score within the selected range (or the last
-- 10 rounds when range='recent').
-- previous_avg = average for the prior equivalent window (prior 7/30/
-- 365 days, or rounds 11-20 for 'recent'). Negative `change` = you
-- scored better in the current window.
--
-- Safe to re-run (DROP + CREATE because return shape unchanged but
-- signature changed; Postgres requires DROP).
-- ============================================================

DROP FUNCTION IF EXISTS get_profile_score_trend(UUID);

CREATE OR REPLACE FUNCTION get_profile_score_trend(
  p_user_id UUID,
  p_range TEXT DEFAULT 'recent'
)
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
  v_days INT;
  v_start_date DATE;
  v_prior_start DATE;
BEGIN
  IF p_range IN ('week', 'month', 'year') THEN
    v_days := CASE p_range
      WHEN 'week'  THEN 7
      WHEN 'month' THEN 30
      WHEN 'year'  THEN 365
    END;
    v_start_date := (current_date - (v_days || ' days')::interval)::date;
    v_prior_start := (v_start_date - (v_days || ' days')::interval)::date;

    -- ORDER BY adds match_id as a tiebreaker so rows with the same
    -- match_date always plot in a stable order across calls.
    SELECT jsonb_agg(
             jsonb_build_object(
               'score', sub.score,
               'date',  sub.match_date,
               'match_id', sub.match_id
             ) ORDER BY sub.match_date ASC, sub.match_id ASC
           ),
           COUNT(*)
    INTO v_points, v_count
    FROM (
      SELECT s.score, m.match_date, s.match_id
      FROM scores s
      JOIN matches m ON m.id = s.match_id
      WHERE s.user_id = p_user_id
        AND s.status = 'approved'
        AND s.holes = 18
        AND m.match_date IS NOT NULL
        AND m.match_date >= v_start_date
    ) sub;

    SELECT AVG(s.score) INTO v_recent_avg
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND s.holes = 18
      AND m.match_date >= v_start_date;

    SELECT AVG(s.score) INTO v_previous_avg
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND s.holes = 18
      AND m.match_date >= v_prior_start
      AND m.match_date < v_start_date;
  ELSE
    -- 'recent' (default): last 20 approved 18-hole rounds
    SELECT jsonb_agg(
             jsonb_build_object(
               'score', sub.score,
               'date',  sub.match_date,
               'match_id', sub.match_id
             ) ORDER BY sub.match_date ASC
           ),
           COUNT(*)
    INTO v_points, v_count
    FROM (
      SELECT s.score, m.match_date, s.match_id
      FROM scores s
      JOIN matches m ON m.id = s.match_id
      WHERE s.user_id = p_user_id
        AND s.status = 'approved'
        AND s.holes = 18
        AND m.match_date IS NOT NULL
      ORDER BY m.match_date DESC, s.created_at DESC
      LIMIT 20
    ) sub;

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
    ) last10;

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
    ) prior10;
  END IF;

  RETURN jsonb_build_object(
    'range', p_range,
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
