-- ============================================================================
-- Retire the dead legacy approval path (match_approvals / score_approvals)
-- ============================================================================
-- The score-approval model moved to match_players.approved_at +
-- scores.status long ago. Left behind, unused:
--   * match_approvals, score_approvals — 0 rows in prod, no inbound FKs, not
--     in the realtime publication, no app reads/writes, but authenticated
--     still held table grants + permissive INSERT policies (client-writable
--     dead tables).
--   * approve_score(uuid) — sole writer of score_approvals; PUBLIC-executable
--     via PostgREST; sets scores.status='approved' OUTSIDE the sanctioned
--     approve_match_scores flow (bypasses the approved_at machinery). No callers.
--   * check_and_finalize_match_scores(uuid) — sole reader of match_approvals;
--     PUBLIC-executable; no callers.
--
-- Dropping all four closes the PUBLIC-execute authz surface and the
-- client-writable tables in one stroke. Functions first (plpgsql bodies
-- aren't dependency-tracked, so order can't fail); policies/indexes drop with
-- their tables. The historical snapshot migration (20260723150000) is left
-- as-is — a fresh db reset replays create-then-drop and ends correct.
--
-- Pre-verified in prod at authoring time: both tables 0 rows, no calls to
-- either function. Safe to re-run: IF EXISTS throughout.
-- ============================================================================

DROP FUNCTION IF EXISTS public.approve_score(uuid);
DROP FUNCTION IF EXISTS public.check_and_finalize_match_scores(uuid);
DROP TABLE IF EXISTS public.score_approvals;
DROP TABLE IF EXISTS public.match_approvals;
