-- Rename league → game across the ENTIRE schema to match the renamed app code.
--
-- WHY: The product was rebranded League → Game. The 2026-05-11 commit renamed
-- every "league" reference in the TypeScript app (tables games/game_members/
-- game_periods, columns game_id/game_type, RPCs create_game / get_game_badges /
-- generate_game_periods / get_game_activity_feed / join_game_by_code /
-- request_join_game). The DB was deliberately left on the old `leagues` schema so
-- the rename could be staged. This migration completes it on the live schema; the
-- app cannot work against production until it runs.
--
-- This REPLACES an earlier broken draft, which would have failed or corrupted:
--   1. It called pg_get_functiondef() over every public routine UNGUARDED, so it
--      errored on the citext max()/min() aggregates that live in `public`
--      (pg_get_functiondef throws on aggregates) — aborting on its first stmt.
--   2. It rewrote with word-boundary regex (\mleague\M). `_` is a word char in
--      Postgres regex, so create_league / get_league_badges / is_league_member are
--      single words and the pattern matched NONE of them — function NAMES were
--      never renamed, so the app's RPC calls would 404.
--   3. It ignored all RLS policies and both views entirely, which would have left
--      member access pointing at renamed tables/functions (silent breakage).
--
-- HOW: Snapshot every league-touching function / trigger / policy into temp
-- tables, drop them, rename the 5 columns + 3 tables + fix join_requests, then
-- recreate each object with a plain SUBSTRING rewrite league→game. `game` is the
-- exact, total replacement for every compound identifier (league_members →
-- game_members, league_id → game_id, league_type → game_type, leagues → games,
-- create_league → create_game, is_league_member → is_game_member, …), so a plain
-- replace is correct and complete; word boundaries are exactly what broke the old
-- draft. The two views are recreated explicitly (rename + league-free output
-- columns) and re-granted. check_function_bodies is disabled so the ~32 functions
-- (which call one another) can be recreated in any order.
--
-- Policy capture is by DEPENDENCY (pg_depend on a dropped function), not text:
-- scores_select_members and match_players_select_members call user_can_see_match
-- (whose body references league, so it is dropped+recreated) but contain no
-- "league" text — a text-only capture would miss them and CASCADE would silently
-- delete them.
--
-- Functions are all effectively PUBLIC EXECUTE today, so recreating them at the
-- default (also PUBLIC EXECUTE) preserves access — no GRANT replay needed.
-- SECURITY DEFINER is preserved by pg_get_functiondef. Table/column RENAMEs keep
-- their ACLs + RLS. Only the recreated views need explicit re-GRANT.
--
-- Safe to re-run? No — single-shot. Fully atomic: any failure rolls the whole
-- transaction back, leaving production untouched.
--
-- Verification queries are at the very bottom (run after COMMIT).

BEGIN;

-- Recreate functions in any order despite their inter-references.
SET LOCAL check_function_bodies = off;

-- Substring rewrite helper (session-temp). Three case variants cover identifiers,
-- comments, and user-facing string literals (e.g. notification text).
CREATE OR REPLACE FUNCTION pg_temp.rw(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $rw$
  SELECT replace(replace(replace($1, 'league', 'game'), 'League', 'Game'), 'LEAGUE', 'GAME')
$rw$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Snapshot league-touching FUNCTIONS. Normal functions only (prokind='f'),
--    MATERIALIZED so pg_get_functiondef is never evaluated on the citext
--    max()/min() aggregates (which would raise "X is an aggregate function").
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _fn_backup ON COMMIT DROP AS
WITH cand AS MATERIALIZED (
  SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.prokind = 'f'
)
SELECT oid, proname, args, pg_get_functiondef(oid) AS def
FROM cand
WHERE proname ILIKE '%league%' OR pg_get_functiondef(oid) ILIKE '%league%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Snapshot TRIGGERS that call any snapshotted function (tgfoid), or whose
--    name / table / definition mentions league.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _trg_backup ON COMMIT DROP AS
SELECT t.tgname AS name, c.relname AS tbl, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t
JOIN pg_class     c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE NOT t.tgisinternal AND n.nspname = 'public'
  AND ( t.tgfoid IN (SELECT oid FROM _fn_backup)
     OR t.tgname  ILIKE '%league%'
     OR c.relname ILIKE '%league%'
     OR pg_get_triggerdef(t.oid) ILIKE '%league%' );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Snapshot POLICIES that depend on a snapshotted function (pg_depend — catches
--    the user_can_see_match policies that contain no "league" text), or reference
--    league in their expressions, or sit on a table being renamed. Build the DROP
--    (old names) and CREATE (rewritten names) statements now.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _pol_backup ON COMMIT DROP AS
SELECT
  pol.polname AS name,
  cls.relname AS tbl,
  format('DROP POLICY %I ON public.%I', pol.polname, cls.relname) AS drop_sql,
  format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s %s %s',
    pg_temp.rw(pol.polname),
    pg_temp.rw(cls.relname),
    CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
    CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                    WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
    COALESCE((SELECT string_agg(CASE WHEN rr.rolname IS NULL THEN 'public'
                                     ELSE quote_ident(rr.rolname) END, ', ')
                FROM unnest(pol.polroles) pid
                LEFT JOIN pg_roles rr ON rr.oid = pid), 'public'),
    CASE WHEN pol.polqual IS NOT NULL
         THEN 'USING (' || pg_temp.rw(pg_get_expr(pol.polqual, pol.polrelid)) || ')'
         ELSE '' END,
    CASE WHEN pol.polwithcheck IS NOT NULL
         THEN 'WITH CHECK (' || pg_temp.rw(pg_get_expr(pol.polwithcheck, pol.polrelid)) || ')'
         ELSE '' END
  ) AS create_sql
FROM pg_policy pol
JOIN pg_class     cls ON pol.polrelid = cls.oid
JOIN pg_namespace n   ON cls.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND ( EXISTS (SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                  AND d.refclassid = 'pg_proc'::regclass
                  AND d.refobjid IN (SELECT oid FROM _fn_backup))
     OR pg_get_expr(pol.polqual,      pol.polrelid) ILIKE '%league%'
     OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%league%'
     OR cls.relname ILIKE '%league%' );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Drop the two convenience views (recreated, renamed + clean, at the end).
-- ─────────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.my_leagues_with_period;
DROP VIEW IF EXISTS public.my_upcoming_matches;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Drop snapshotted policies (before the functions they depend on).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT drop_sql FROM _pol_backup LOOP EXECUTE r.drop_sql; END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Drop snapshotted triggers.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT name, tbl FROM _trg_backup LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', r.name, r.tbl);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Drop snapshotted functions. CASCADE mops up SQL-function interdependencies
--    (is_league_member ← user_can_see_match ← get_user_honors); every cascaded
--    object is itself snapshotted above and recreated below.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT proname, args FROM _fn_backup LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.proname, r.args);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Rename columns (while the old table names still exist).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leagues         RENAME COLUMN league_type TO game_type;
ALTER TABLE public.league_members  RENAME COLUMN league_id   TO game_id;
ALTER TABLE public.league_periods  RENAME COLUMN league_id   TO game_id;
ALTER TABLE public.matches         RENAME COLUMN league_id   TO game_id;
ALTER TABLE public.activity_events RENAME COLUMN league_id   TO game_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Rename tables.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leagues        RENAME TO games;
ALTER TABLE public.league_members RENAME TO game_members;
ALTER TABLE public.league_periods RENAME TO game_periods;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. join_requests: swap the check constraint, THEN migrate the value. The drop
--     must precede the UPDATE — otherwise writing 'game' violates the still-active
--     old constraint (which only allowed 'league'/'match').
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.join_requests DROP CONSTRAINT IF EXISTS join_requests_target_type_check;
UPDATE public.join_requests SET target_type = 'game' WHERE target_type = 'league';
ALTER TABLE public.join_requests ADD  CONSTRAINT join_requests_target_type_check
  CHECK (target_type = ANY (ARRAY['game'::text, 'match'::text]));

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Recreate functions with rewritten names + bodies.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT def FROM _fn_backup LOOP EXECUTE pg_temp.rw(r.def); END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. Recreate triggers (rewritten name / table / target function).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT def FROM _trg_backup LOOP EXECUTE pg_temp.rw(r.def); END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. Recreate policies (rewritten name / table / expressions / function calls).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT create_sql FROM _pol_backup LOOP EXECUTE r.create_sql; END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. Recreate the two views (renamed + league-free output columns) and restore
--     the anon/authenticated/service_role grants a fresh view would otherwise lose.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE VIEW public.my_games_with_period AS
  SELECT g.id, g.name, g.course_name, g.admin_id, g.max_players, g.invite_code,
         g.game_type, g.status, g.created_at,
         gp.name        AS current_period_name,
         gp.start_date  AS period_start,
         gp.end_date    AS period_end,
         gp.week_number AS current_week,
         (SELECT count(*) FROM game_members WHERE game_members.game_id = g.id) AS player_count,
         (SELECT count(*) FROM game_periods WHERE game_periods.game_id = g.id) AS total_weeks
    FROM games g
    JOIN game_members gm ON gm.game_id = g.id
    LEFT JOIN game_periods gp ON gp.game_id = g.id AND gp.status = 'active'::text
   WHERE gm.user_id = auth.uid();

CREATE VIEW public.my_upcoming_matches AS
  SELECT m.id, m.game_id, m.period_id, m.course_name, m.match_date, m.match_time,
         m.created_by, m.status, m.created_at,
         gp.name        AS period_name,
         g.name         AS game_name,
         g.course_name  AS game_course
    FROM matches m
    JOIN game_periods gp ON gp.id = m.period_id
    JOIN games g         ON g.id = m.game_id
    JOIN match_players mp ON mp.match_id = m.id
   WHERE mp.user_id = auth.uid() AND m.match_date >= CURRENT_DATE
   ORDER BY m.match_date;

GRANT SELECT ON public.my_games_with_period TO anon, authenticated, service_role;
GRANT SELECT ON public.my_upcoming_matches  TO anon, authenticated, service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification (run after COMMIT — all should return zero rows / expected values)
-- ─────────────────────────────────────────────────────────────────────────────
-- No league-named tables or views:
--   SELECT table_name FROM information_schema.tables  WHERE table_schema='public' AND table_name  ILIKE '%league%';
-- No league-named columns:
--   SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND column_name ILIKE '%league%';
-- No league-named/-bodied functions (guard prokind to skip aggregates):
--   WITH c AS MATERIALIZED (SELECT oid, proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND p.prokind='f')
--   SELECT proname FROM c WHERE proname ILIKE '%league%' OR pg_get_functiondef(oid) ILIKE '%league%';
-- No league-named triggers:
--   SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname ILIKE '%league%';
-- No league in any policy expression:
--   SELECT policyname FROM pg_policies WHERE schemaname='public' AND (qual ILIKE '%league%' OR with_check ILIKE '%league%');
-- target_type clean:
--   SELECT DISTINCT target_type FROM public.join_requests;
-- The 6 renamed RPCs exist:
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public'
--     AND proname IN ('create_game','get_game_badges','generate_game_periods','get_game_activity_feed','join_game_by_code','request_join_game');
-- Row counts intact: games=3, game_members=11, game_periods=3, matches=36, scores=77.
