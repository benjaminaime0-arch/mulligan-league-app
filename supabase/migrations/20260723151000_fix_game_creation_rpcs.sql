-- ============================================================================
-- Fix RPCs broken in production (T0.2 discoveries)
-- ============================================================================
-- Two independent production bugs surfaced while exporting the Dashboard-
-- authored RPCs and running the core-loop replay:
--   A. Game creation (create_game / generate_game_periods / advance_game_period)
--   B. Player search (search_players) — see the bottom of this file.
-- Both are faithfully broken in the export snapshot (20260723150000); this
-- migration carries the corrected versions so a fresh replay ends working
-- and prod can be updated to match.
-- ============================================================================
-- (A) Game creation — broken in production since ~Apr 21
-- ============================================================================
-- WHY
-- Verified against prod on 2026-07-23 (BEGIN…ROLLBACK probe): calling
-- create_game as an authenticated user fails with
--   23505 duplicate key "league_members_league_id_user_id_key"
-- and the latest row in games is dated 2026-04-17. Two independent breaks
-- stacked up under the Dashboard-authored create_game:
--
--   1. fix_core_rls_holes (Apr 21) added the auto_add_game_admin_to_members
--      trigger, which inserts the admin's game_members row on games INSERT.
--      create_game still performs its own identical insert → unique violation
--      → the whole transaction aborts. No game has been created since.
--   2. Behind that error, create_game / generate_game_periods /
--      advance_game_period still INSERT INTO activity_log — a table dropped
--      by cleanup_activity_log_shadow_system (Apr 21). Even without (1),
--      creation would fail here.
--
-- FIX (minimal, keeps signatures and return shapes identical):
--   * create_game: drop the manual game_members insert (the trigger owns it)
--     and the activity_log insert. The member-joined activity event is
--     already emitted by the fn_activity_player_joined_game trigger on
--     game_members, so the feed loses nothing.
--   * generate_game_periods: drop the activity_log insert. Everything else
--     (admin gate, ≥2 members, N-1 weekly periods, activation) unchanged.
--   * advance_game_period: drop both activity_log inserts. The function has
--     no callers today but is the natural seed for R2's recurring periods —
--     leaving it broken is a trap.
--
-- Safe to re-run: CREATE OR REPLACE only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_game(p_name text, p_course_name text, p_max_players integer, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_scoring_cards integer DEFAULT NULL::integer, p_total_cards integer DEFAULT NULL::integer, p_game_type text DEFAULT 'stroke_play'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_game_id UUID;
  v_invite_code TEXT;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  INSERT INTO public.games (
    name,
    course_name,
    admin_id,
    max_players,
    game_type,
    start_date,
    end_date,
    scoring_cards_count,
    total_cards_count
  )
  VALUES (
    p_name,
    p_course_name,
    v_user_id,
    p_max_players,
    COALESCE(p_game_type, 'stroke_play'),
    p_start_date,
    p_end_date,
    p_scoring_cards,
    p_total_cards
  )
  RETURNING id, invite_code INTO v_game_id, v_invite_code;

  -- Admin membership is created by the auto_add_game_admin_to_members
  -- trigger (fix_core_rls_holes); inserting it here again is what broke
  -- game creation. The member-joined activity event comes from the
  -- fn_activity_player_joined_game trigger on game_members.

  RETURN json_build_object(
    'success', true,
    'game_id', v_game_id,
    'invite_code', v_invite_code
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_game_periods(p_game_id uuid, p_start_date date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_game public.games%ROWTYPE;
  v_member_count INTEGER;
  v_num_weeks INTEGER;
  v_week INTEGER;
  v_week_start DATE;
  v_week_end DATE;
  v_period_status TEXT;
BEGIN
  -- Verify admin
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id;
  IF v_game.admin_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Only the game admin can generate periods');
  END IF;

  -- Count members
  SELECT COUNT(*) INTO v_member_count FROM public.game_members WHERE game_id = p_game_id;
  IF v_member_count < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Need at least 2 players to start the game');
  END IF;

  -- Delete existing upcoming periods (safe to regenerate)
  DELETE FROM public.game_periods WHERE game_id = p_game_id AND status = 'upcoming';

  -- Calculate weeks: N-1 weeks for N players (minimum 1)
  v_num_weeks := GREATEST(v_member_count - 1, 1);

  -- Generate weekly periods
  FOR v_week IN 1..v_num_weeks LOOP
    v_week_start := p_start_date + ((v_week - 1) * 7);
    v_week_end := v_week_start + 6;

    IF v_week = 1 THEN
      v_period_status := 'active';
    ELSE
      v_period_status := 'upcoming';
    END IF;

    INSERT INTO public.game_periods (game_id, week_number, name, start_date, end_date, status)
    VALUES (p_game_id, v_week, 'Week ' || v_week, v_week_start, v_week_end, v_period_status);
  END LOOP;

  -- Activate the game
  UPDATE public.games SET status = 'active' WHERE id = p_game_id;

  RETURN json_build_object(
    'success', true,
    'weeks_generated', v_num_weeks,
    'start_date', p_start_date,
    'end_date', p_start_date + ((v_num_weeks - 1) * 7) + 6
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_game_period(p_game_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_period public.game_periods%ROWTYPE;
  v_next_period public.game_periods%ROWTYPE;
BEGIN
  -- Find current active period
  SELECT * INTO v_current_period
  FROM public.game_periods
  WHERE game_id = p_game_id AND status = 'active'
  ORDER BY week_number LIMIT 1;

  IF v_current_period IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active period found');
  END IF;

  -- Complete current period
  UPDATE public.game_periods SET status = 'completed' WHERE id = v_current_period.id;

  -- Find next period
  SELECT * INTO v_next_period
  FROM public.game_periods
  WHERE game_id = p_game_id AND week_number = v_current_period.week_number + 1;

  IF v_next_period IS NOT NULL THEN
    -- Activate next period
    UPDATE public.game_periods SET status = 'active' WHERE id = v_next_period.id;
    RETURN json_build_object('success', true, 'new_week', v_next_period.week_number);
  ELSE
    -- Game is complete
    UPDATE public.games SET status = 'completed' WHERE id = p_game_id;
    RETURN json_build_object('success', true, 'game_completed', true);
  END IF;
END;
$function$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Probe (run in BEGIN…ROLLBACK impersonating an authenticated user):
--   SELECT set_config('request.jwt.claims',
--     '{"sub":"<real-user-uuid>","role":"authenticated"}', true);
--   SELECT create_game('__probe__', '__probe__', 4);
--   -- expect {"success":true, "game_id":..., "invite_code":...}
--   SELECT generate_game_periods((<that game_id>)::uuid);
--   -- expect success once a 2nd member exists
--
-- Read-only: bodies no longer reference activity_log:
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND prokind='f'
--     AND pg_get_functiondef(p.oid) ILIKE '%activity_log%';
--   -- expect zero rows
-- ============================================================================

-- ============================================================================
-- (B) Player search — search_players raised 42804 on EVERY call
-- ============================================================================
-- search_players declares RETURNS TABLE(... handicap numeric) but
-- profiles.handicap is `integer`, so RETURN QUERY raised
--   42804 structure of query does not match function result type
--   (Returned type integer does not match expected type numeric in column 8)
-- on every invocation — player search (PlayerSearchBar) has been dead in
-- production. Verified against prod 2026-07-23. Fix: cast handicap to
-- numeric so the row shape matches the declared return type. Signature and
-- return columns unchanged.
CREATE OR REPLACE FUNCTION public.search_players(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, username text, first_name text, last_name text, avatar_url text, club text, town text, handicap numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.id, p.username, p.first_name, p.last_name,
         p.avatar_url, p.club, p.town, p.handicap::numeric
  FROM profiles p
  WHERE p.username   ILIKE '%' || p_query || '%'
     OR p.first_name ILIKE '%' || p_query || '%'
     OR p.last_name  ILIKE '%' || p_query || '%'
  LIMIT p_limit;
END;
$function$;
-- Verification: SELECT count(*) FROM search_players('a', 5);  -- no 42804
-- ============================================================================
