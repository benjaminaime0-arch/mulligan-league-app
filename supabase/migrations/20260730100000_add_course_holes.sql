-- ============================================================================
-- Per-hole course data + course FKs on games/matches (Phase A, features 1 & 6)
-- ============================================================================
-- course_holes carries the physical scorecard of a course routing: par, HCP
-- stroke index and yellow-tee distance per hole. It is the foundation for
-- per-hole score entry (Phase B), stroke allocation / net scoring (Phase C)
-- and match play (Phase D). Seeded from Golfs_Ile_de_France.xlsx by
-- 20260730101000_seed_course_holes.sql (generated — see
-- scripts/course_holes_mapping.md for the reviewed sheet→course mapping).
--
-- games.course_id / matches.course_id are additive FKs; course_name text
-- stays as the denormalized display value and the free-text escape hatch
-- (a course not in the referential keeps course_id NULL). ON DELETE SET NULL:
-- reference data should never be able to cascade user data away.
--
-- Like courses, course_holes is public reference data: readable by any
-- authenticated user, writable only by the service role.
--
-- Safe to re-run: IF NOT EXISTS / OR REPLACE throughout.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.course_holes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  hole_number   smallint NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  par           smallint NOT NULL CHECK (par BETWEEN 3 AND 6),
  -- NULL = the course does not publish stroke indexes (or publishes
  -- contradictory ones — see the seed script's duplicate-HCP rule).
  hcp_index     smallint CHECK (hcp_index BETWEEN 1 AND 18),
  dist_yellow_m smallint,
  -- 'blanc' when the published card is white-tee only (e.g. Morangis);
  -- NULL = yellow, the default tee for the whole referential.
  tee_note      text,
  UNIQUE (course_id, hole_number)
);

ALTER TABLE public.course_holes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS course_holes_select_authenticated ON public.course_holes;
CREATE POLICY course_holes_select_authenticated ON public.course_holes
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.course_holes FROM anon, authenticated;
GRANT SELECT ON public.course_holes TO authenticated;

-- Course FKs. games writes go through create_game (SECURITY DEFINER) so no
-- client grant is needed; matches are inserted directly by the creator and
-- matches has table-level authenticated grants, which cover the new column.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL;

-- Course-centric reads (profile course stats, /courses pages) filter by these.
CREATE INDEX IF NOT EXISTS games_course_id_idx   ON public.games (course_id)   WHERE course_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS matches_course_id_idx ON public.matches (course_id) WHERE course_id IS NOT NULL;

-- ============================================================================
-- Verification (run manually):
--   SELECT count(*) FROM public.course_holes;                      -- 0 until seed
--   \d public.course_holes
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name IN ('games','matches') AND column_name = 'course_id';
-- ============================================================================
