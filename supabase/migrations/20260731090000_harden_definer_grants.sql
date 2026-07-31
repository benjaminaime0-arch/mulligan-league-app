-- ============================================================================
-- Post-deploy hardening: EXECUTE grants on the Phase A-G definer functions
-- ============================================================================
-- The security advisor flagged the new SECURITY DEFINER functions as
-- executable by anon (via PUBLIC's default EXECUTE). None are exploitable —
-- every one gates on auth.uid()/membership internally — but anon has no
-- business calling any of them, and the trigger/maintenance bodies have no
-- business being client-callable at all (triggers run as table owner).
--
-- get_leaderboard keeps an explicit service_role grant: the season OG card
-- (/api/og/season) calls it with the service key, and revoking PUBLIC would
-- otherwise take that path down.
--
-- Also pins search_path on sync_game_format (advisor: mutable search_path),
-- which the Phase D redefinition left unpinned.
--
-- Safe to re-run: REVOKE/GRANT/ALTER are idempotent.
-- ============================================================================

-- Trigger bodies + rating engine: no client execution, period.
REVOKE EXECUTE ON FUNCTION public.sync_score_from_holes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.freeze_playing_handicap() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.snapshot_match_player_team() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_match_live() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rate_match_on_completion() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rate_match(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_game_format() FROM PUBLIC, anon, authenticated;

-- Member-gated RPCs: authenticated only (their GRANTs already exist).
REVOKE EXECUTE ON FUNCTION public.upsert_score_hole(uuid, uuid, int, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_match_scorecard(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_leaderboard(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.match_play_state(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_match_play_board(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ryder_score(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_member_team(uuid, uuid, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_head_to_head(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_game_recap(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_course_stats(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_profile_course_conquests(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.allocate_strokes(uuid, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.round_basis_score(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_profile_courses(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_game(text, text, integer, date, date, integer, integer, text, uuid, text, boolean) FROM PUBLIC, anon;

-- The season OG card reads the board with the service key.
GRANT EXECUTE ON FUNCTION public.get_leaderboard(uuid) TO service_role;

-- Advisor: function_search_path_mutable on the Phase D redefinition.
ALTER FUNCTION public.sync_game_format() SET search_path = public;

-- ============================================================================
-- Verification (run manually):
--   SELECT proname, proacl FROM pg_proc
--    WHERE proname IN ('rate_match','upsert_score_hole','get_leaderboard');
-- ============================================================================
