-- ============================================================================
-- Wire course_id through creation flows + profile stats + legacy backfill
-- ============================================================================
-- Three pieces:
--   1. create_game gains p_course_id (optional). The autocomplete already
--      surfaces the picked course's id — it was simply discarded before.
--   2. get_profile_courses groups by course_id when present (falling back to
--      the legacy text COALESCE) and now returns course id/city/par so the
--      UI can show verified course facts instead of raw text.
--   3. backfill_course_ids(): repairs legacy rows by matching course_name
--      text against the referential — exact lower(), then unaccented
--      case-insensitive equality, and only when the match is UNIQUE.
--      Exposed as a service-role function (re-runnable, returns counts)
--      and executed once here.
--
-- Safe to re-run: CREATE OR REPLACE + idempotent UPDATEs.
-- ============================================================================

-- unaccent lives in `extensions` on hosted Supabase and in `public` on the
-- local CLI stack; same portability dance as pg_trgm (see 20260724120000).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') THEN
    BEGIN
      CREATE EXTENSION unaccent WITH SCHEMA extensions;
    EXCEPTION WHEN OTHERS THEN
      CREATE EXTENSION IF NOT EXISTS unaccent;
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. create_game with optional course reference
-- ---------------------------------------------------------------------------
-- Same body as 20260723151000; the ONLY change is p_course_id, written
-- alongside the denormalized course_name. An id pointing at a nonexistent
-- course fails the FK and surfaces as a clean error JSON.
--
-- The old 8-param signature must be DROPPED, not left as an overload:
-- PostgREST resolves rpc('create_game', …) by name and an ambiguous
-- overload set turns every call into a 300 error.
DROP FUNCTION IF EXISTS public.create_game(text, text, integer, date, date, integer, integer, text);
CREATE OR REPLACE FUNCTION public.create_game(p_name text, p_course_name text, p_max_players integer, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_scoring_cards integer DEFAULT NULL::integer, p_total_cards integer DEFAULT NULL::integer, p_game_type text DEFAULT 'stroke_play'::text, p_course_id uuid DEFAULT NULL::uuid)
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
    course_id,
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
    p_course_id,
    v_user_id,
    p_max_players,
    COALESCE(p_game_type, 'stroke_play'),
    p_start_date,
    p_end_date,
    p_scoring_cards,
    p_total_cards
  )
  RETURNING id, invite_code INTO v_game_id, v_invite_code;

  -- Admin membership comes from the auto_add_game_admin_to_members trigger;
  -- the member-joined activity event from fn_activity_player_joined_game.

  RETURN json_build_object(
    'success', true,
    'game_id', v_game_id,
    'invite_code', v_invite_code
  );
EXCEPTION WHEN foreign_key_violation THEN
  RETURN json_build_object('success', false, 'error', 'Unknown course');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_game(text, text, integer, date, date, integer, integer, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_profile_courses, course_id-aware
-- ---------------------------------------------------------------------------
-- Grouping key: course_id when the match (or its game) carries one, else the
-- legacy text label — so two spellings of an unreferenced course still split,
-- but referenced rows aggregate correctly regardless of text drift.
-- Return shape is additive (old columns unchanged, in order) so existing
-- consumers keep working; new columns feed the upgraded CoursesCard.
DROP FUNCTION IF EXISTS public.get_profile_courses(uuid);
CREATE OR REPLACE FUNCTION public.get_profile_courses(p_user_id uuid)
 RETURNS TABLE(course_name text, times_played bigint, best_score integer, last_played_date date, course_id uuid, course_city text, course_par integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Caller gate (AUD#3): stats are visible to game-mates only.
  IF NOT shares_game_with(p_user_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(c.name, m.course_name, l.course_name, 'Unknown course')::TEXT AS course_name,
    COUNT(DISTINCT m.id) AS times_played,
    MIN(s.score) FILTER (WHERE s.status = 'approved')::INT AS best_score,
    MAX(m.match_date) AS last_played_date,
    c.id AS course_id,
    c.city AS course_city,
    c.par AS course_par
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  LEFT JOIN games l ON l.id = m.game_id
  LEFT JOIN courses c ON c.id = COALESCE(m.course_id, l.course_id)
  LEFT JOIN scores s ON s.match_id = m.id AND s.user_id = mp.user_id
  WHERE mp.user_id = p_user_id
  GROUP BY c.id, c.city, c.par,
           COALESCE(c.name, m.course_name, l.course_name, 'Unknown course')
  ORDER BY times_played DESC, MAX(m.match_date) DESC NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_profile_courses(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Legacy backfill: course_name text → course_id
-- ---------------------------------------------------------------------------
-- Deterministic only: exact lower() equality, then unaccented lower()
-- equality, and a candidate is applied only when it is UNIQUE across the
-- referential. No trigram/fuzzy matching here — a wrong course silently
-- attached to someone's game history is worse than a NULL.
CREATE OR REPLACE FUNCTION public.backfill_course_ids()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_games INT := 0;
  v_matches INT := 0;
BEGIN
  -- Service-role / maintenance only: not granted to clients below.

  WITH candidates AS (
    SELECT g.id AS game_id, MIN(c.id::text)::uuid AS course_id
    FROM public.games g
    JOIN public.courses c
      ON lower(trim(g.course_name)) = lower(c.name)
      OR unaccent(lower(trim(g.course_name))) = unaccent(lower(c.name))
    WHERE g.course_id IS NULL AND g.course_name IS NOT NULL
    GROUP BY g.id
    HAVING COUNT(DISTINCT c.id) = 1
  )
  UPDATE public.games g SET course_id = cand.course_id
  FROM candidates cand WHERE g.id = cand.game_id;
  GET DIAGNOSTICS v_games = ROW_COUNT;

  WITH candidates AS (
    SELECT m.id AS match_id, MIN(c.id::text)::uuid AS course_id
    FROM public.matches m
    JOIN public.courses c
      ON lower(trim(m.course_name)) = lower(c.name)
      OR unaccent(lower(trim(m.course_name))) = unaccent(lower(c.name))
    WHERE m.course_id IS NULL AND m.course_name IS NOT NULL
    GROUP BY m.id
    HAVING COUNT(DISTINCT c.id) = 1
  )
  UPDATE public.matches m SET course_id = cand.course_id
  FROM candidates cand WHERE m.id = cand.match_id;
  GET DIAGNOSTICS v_matches = ROW_COUNT;

  RETURN json_build_object('games_backfilled', v_games, 'matches_backfilled', v_matches);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.backfill_course_ids() FROM PUBLIC, anon, authenticated;

SELECT public.backfill_course_ids();

-- ============================================================================
-- Verification (run manually):
--   SELECT public.backfill_course_ids();          -- re-run: {0, 0} once done
--   SELECT count(*) FROM games   WHERE course_id IS NOT NULL;
--   SELECT count(*) FROM matches WHERE course_id IS NOT NULL;
--   SELECT * FROM get_profile_courses('<uuid>');  -- as a game-mate
-- ============================================================================
