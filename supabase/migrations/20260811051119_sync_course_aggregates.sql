-- ============================================================================
-- Course aggregates ↔ hole cards: divergence repair + sync trigger
-- ============================================================================
-- A full audit (2026-08-10, live prod) found courses.dist_yellow contradicting
-- SUM(course_holes.dist_yellow_m) on 44 of the 91 courses that carry hole
-- cards. courses.par: 0 divergent — the seeder repaired par when the card
-- disagreed, but for dist_yellow it only backfilled NULLs, so every résumé
-- distance that contradicted its card survived. Two failure classes:
--   * 18T: résumé total ≠ per-hole card sum (Fontainebleau 5644 vs 5667,
--     Gadancourt 6051 vs 5193, deltas from ±1 to −858).
--   * 9T: résumé stored the single-loop distance while the referential's
--     documented convention (which par follows everywhere: par 68 = 2×34)
--     is two-loop totals (Bois-le-Roi 2313 vs 2×2313 = 4626).
-- /courses/[slug] renders the header chip from courses.dist_yellow directly
-- above the hole card whose columns sum differently — user-visible.
--
-- Policy (the seeder's own par rule, extended): the per-hole card is the
-- finer-grained, internally-consistent source of truth; aggregates follow it.
--   * par: card sum × loop (loop = 2 for 9-row cards, two-loop convention).
--   * dist_yellow: same, but only when every hole distance is present and
--     the card is yellow-tee. tee_note'd cards are other tees — Morangis and
--     Paris International publish white-only cards, Roissy a black one —
--     so their dist_yellow keeps the résumé value.
--   * a card syncs only when its row count equals the declared courses.holes
--     (and is a supported 9/18 format). Writer contract: keep courses.holes
--     accurate and write cards in full statements. A partial card, or a
--     reseed that shrank a card but left stale high-numbered rows behind,
--     must never produce mixed-row aggregates — the trigger freezes instead,
--     and the t1_1/t2_3 invariants then surface the contradiction in CI.
-- The trigger keeps future card writes (reseeds included) in sync; the
-- generated seed's own courses-row fixes become harmless duplicates of it.
--
-- Cross-table aggregates can't be generated columns, hence the trigger.
-- course_holes is service-role-only writable, so it fires ~never outside
-- migrations.
--
-- Safe to re-run: OR REPLACE / DROP IF EXISTS / idempotent repair.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Recompute one course's aggregates from its hole card
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_course_aggregates(p_course_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_holes int;
  v record;
  v_loop int;
BEGIN
  -- Lock the course row before reading the card: concurrent writers to the
  -- same course serialize here, so the SUM below always sees the winning
  -- writer's committed rows (no lost update under READ COMMITTED). Also
  -- fetches the declared hole count for the completeness gate.
  SELECT holes INTO v_holes FROM courses WHERE id = p_course_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;  -- course is being deleted (card rows cascade after it)
  END IF;

  SELECT count(*)::int AS n,
         sum(par)::int AS par_sum,
         CASE WHEN bool_and(dist_yellow_m IS NOT NULL)
               AND count(*) FILTER (WHERE tee_note IS NOT NULL) = 0
              THEN sum(dist_yellow_m)::int
         END AS dist_sum
  INTO v
  FROM course_holes
  WHERE course_id = p_course_id;

  IF v.n NOT IN (9, 18) OR v.n IS DISTINCT FROM v_holes THEN
    RETURN;  -- incomplete/mixed/undeclared card: keep current aggregates
  END IF;
  v_loop := CASE WHEN v.n = 9 THEN 2 ELSE 1 END;

  UPDATE courses c
  SET par         = v.par_sum * v_loop,
      dist_yellow = COALESCE(v.dist_sum * v_loop, c.dist_yellow)
  WHERE c.id = p_course_id
    AND (c.par IS DISTINCT FROM v.par_sum * v_loop
         OR c.dist_yellow IS DISTINCT FROM COALESCE(v.dist_sum * v_loop, c.dist_yellow));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.sync_course_aggregates(uuid) FROM PUBLIC, anon, authenticated;
-- The trigger function below is SECURITY INVOKER, so this nested call is
-- EXECUTE-checked against the role performing the DML on course_holes.
-- service_role is that table's only non-superuser writer and gets no
-- default-privilege EXECUTE on postgres-created functions here (same reason
-- 20260731090000 had to re-grant get_leaderboard) — without this grant every
-- service-key card write would abort on the trigger.
GRANT EXECUTE ON FUNCTION public.sync_course_aggregates(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. One-off repair of the audited backlog
-- ---------------------------------------------------------------------------
SELECT public.sync_course_aggregates(course_id)
FROM (SELECT DISTINCT course_id FROM public.course_holes) t;

-- ---------------------------------------------------------------------------
-- 3. Keep them in sync
-- ---------------------------------------------------------------------------
-- Row-level AFTER trigger: a full-card statement re-syncs its course once per
-- row, but each call is a ≤18-row aggregate on a table written only by
-- migrations — simplicity wins over a three-way transition-table setup.
CREATE OR REPLACE FUNCTION public.course_holes_sync_course_aggregates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM sync_course_aggregates(COALESCE(NEW.course_id, OLD.course_id));
  IF TG_OP = 'UPDATE' AND NEW.course_id IS DISTINCT FROM OLD.course_id THEN
    PERFORM sync_course_aggregates(OLD.course_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.course_holes_sync_course_aggregates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS course_holes_sync_aggregates ON public.course_holes;
CREATE TRIGGER course_holes_sync_aggregates
  AFTER INSERT OR UPDATE OR DELETE ON public.course_holes
  FOR EACH ROW EXECUTE FUNCTION public.course_holes_sync_course_aggregates();

-- ============================================================================
-- Verification (run manually):
--   SELECT c.slug, c.dist_yellow, sum(h.dist_yellow_m) AS card,
--          count(*) AS n
--   FROM courses c JOIN course_holes h ON h.course_id = c.id
--   GROUP BY c.id
--   HAVING count(*) FILTER (WHERE h.tee_note IS NOT NULL) = 0
--      AND bool_and(h.dist_yellow_m IS NOT NULL)
--      AND c.dist_yellow IS DISTINCT FROM
--          sum(h.dist_yellow_m) * CASE WHEN count(*) = 9 THEN 2 ELSE 1 END;
--   -- 0 rows. Fontainebleau: dist_yellow 5644 → 5667.
--   SELECT dist_yellow FROM courses WHERE slug = 'golf-de-fontainebleau-fontainebleau';
--   SELECT has_function_privilege('service_role',
--          'public.sync_course_aggregates(uuid)', 'EXECUTE');  -- true
-- ============================================================================
