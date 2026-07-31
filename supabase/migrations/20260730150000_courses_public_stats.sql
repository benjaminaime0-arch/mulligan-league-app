-- ============================================================================
-- Course directory & course-aware stats (Phase F, features 5 & 7)
-- ============================================================================
-- /courses pages exist for Google: they render server-side for ANONYMOUS
-- visitors, so courses + course_holes SELECT widens to anon. Both are public
-- reference data (name, city, par, hole cards) — nothing personal; writes
-- stay service-role only. Player stats on those pages remain gated
-- (shares_game_with) and render only for the signed-in viewer.
--
-- courses.slug: stable, human-readable URL key generated from name + city
-- (unaccented, hyphenated), uniquified with a numeric suffix on collision.
--
-- Stats semantics (documented approximations, friend-league honesty):
--   * A course's stored par follows the seed's two-loop convention for
--     9-hole courses (par 68 = 2×34). A 9-hole ROUND on such a course is
--     therefore measured against par/2; an 18-hole round against par.
--   * "Conquered" (Parcours conquis): the player's best NET round on the
--     course beat or matched its par reference — net ≤ par means you played
--     to your handicap there.
--
-- Safe to re-run: OR REPLACE / IF NOT EXISTS / guarded backfill.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Public read for the reference tables
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS courses_select_anon ON public.courses;
CREATE POLICY courses_select_anon ON public.courses
  FOR SELECT TO anon USING (true);
GRANT SELECT ON public.courses TO anon;

DROP POLICY IF EXISTS course_holes_select_anon ON public.course_holes;
CREATE POLICY course_holes_select_anon ON public.course_holes
  FOR SELECT TO anon USING (true);
GRANT SELECT ON public.course_holes TO anon;

-- ---------------------------------------------------------------------------
-- 2. Slugs
-- ---------------------------------------------------------------------------
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS slug text;

DO $$
BEGIN
  -- unaccent may live in extensions (hosted) or public (local fallback).
  PERFORM set_config('search_path', 'public, extensions', true);

  WITH base AS (
    SELECT id,
           trim(both '-' from regexp_replace(
             lower(unaccent(name || ' ' || coalesce(city, ''))),
             '[^a-z0-9]+', '-', 'g'
           )) AS raw
    FROM public.courses
    WHERE slug IS NULL
  ),
  uniq AS (
    SELECT id, raw,
           ROW_NUMBER() OVER (PARTITION BY raw ORDER BY id) AS rn
    FROM base
  )
  UPDATE public.courses c
  SET slug = CASE WHEN u.rn = 1 THEN u.raw ELSE u.raw || '-' || u.rn END
  FROM uniq u
  WHERE c.id = u.id;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS courses_slug_uq ON public.courses (slug);

-- ---------------------------------------------------------------------------
-- 3. Per-course personal stats (feature 7)
-- ---------------------------------------------------------------------------
-- Rounds/best/avg for one player on one course. Approved rounds only.
-- Gated: visible to the player and their game-mates (same rule as every
-- profile stat since AUD#3).
CREATE OR REPLACE FUNCTION public.get_user_course_stats(p_user_id uuid, p_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT shares_game_with(p_user_id) THEN
    RETURN jsonb_build_object('visible', false);
  END IF;

  SELECT jsonb_build_object(
    'visible', true,
    'rounds', count(*),
    'best_gross', min(s.score),
    'best_net', min(s.score - COALESCE(mp.playing_handicap, 0)),
    'avg_vs_par', round(avg(s.score - par_ref)::numeric, 1),
    'last_played', max(m.match_date)
  ) INTO v_out
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  JOIN match_players mp ON mp.match_id = s.match_id AND mp.user_id = s.user_id
  JOIN LATERAL (
    SELECT CASE
      WHEN s.holes = 9 THEN c.par / 2.0
      ELSE c.par::numeric
    END AS par_ref
    FROM courses c
    WHERE c.id = p_course_id AND c.par IS NOT NULL
  ) pr ON true
  WHERE s.user_id = p_user_id
    AND s.status = 'approved'
    AND COALESCE(m.course_id,
                 (SELECT g.course_id FROM games g WHERE g.id = m.game_id)) = p_course_id;

  RETURN COALESCE(v_out, jsonb_build_object('visible', true, 'rounds', 0));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_user_course_stats(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Parcours conquis — the department grid (feature 7)
-- ---------------------------------------------------------------------------
-- Per IDF department: distinct referential courses the player has approved
-- rounds on, and how many of those are "conquered" (best net ≤ par ref).
CREATE OR REPLACE FUNCTION public.get_profile_course_conquests(p_user_id uuid)
RETURNS TABLE (dept_no text, courses_played bigint, conquered bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT shares_game_with(p_user_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH per_round AS (
    SELECT
      c.id AS course_id,
      c.dept_no AS dept,
      s.score - COALESCE(mp.playing_handicap, 0) AS net,
      CASE WHEN s.holes = 9 THEN c.par / 2.0 ELSE c.par::numeric END AS par_ref
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    JOIN match_players mp ON mp.match_id = s.match_id AND mp.user_id = s.user_id
    JOIN courses c
      ON c.id = COALESCE(m.course_id,
                         (SELECT g.course_id FROM games g WHERE g.id = m.game_id))
    WHERE s.user_id = p_user_id
      AND s.status = 'approved'
      AND c.par IS NOT NULL
  ),
  per_course AS (
    SELECT course_id, dept, bool_or(net <= par_ref) AS is_conquered
    FROM per_round
    GROUP BY course_id, dept
  )
  SELECT dept, count(*)::bigint, count(*) FILTER (WHERE is_conquered)::bigint
  FROM per_course
  WHERE dept IS NOT NULL
  GROUP BY dept;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_profile_course_conquests(uuid) TO authenticated;

-- ============================================================================
-- Verification (run manually):
--   SELECT slug, name FROM courses ORDER BY slug LIMIT 5;   -- all non-null
--   SELECT count(*) FROM courses WHERE slug IS NULL;        -- 0
--   SET ROLE anon; SELECT count(*) FROM courses; RESET ROLE;
-- ============================================================================
