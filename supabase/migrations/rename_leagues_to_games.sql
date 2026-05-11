-- Rename league tables → games to align with the new product vocabulary.
--
-- WHY: We renamed the user-facing concept from "League" → "Tournament" → "Game".
-- DB schema was left as `leagues` until now so the rename could be staged.
-- This migration completes the schema rename: tables, columns, RPC names,
-- triggers, and the join_requests.target_type enum value.
--
-- HOW: Function and trigger bodies reference tables/columns by NAME strings
-- (not oids), so a plain ALTER TABLE doesn't rewrite their internals. We
-- snapshot every league-touching function/trigger definition into temp
-- tables, drop them with CASCADE, do the renames, then regex-rewrite the
-- captured definitions and re-execute them.
--
-- Safe to re-run? No — single-shot. Wrap in BEGIN/COMMIT; entire migration
-- rolls back if any statement fails.
--
-- Verification queries at bottom.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Capture every function whose name or body references "league"
-- ────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _fn_backup ON COMMIT DROP AS
SELECT
  p.oid,
  p.proname                                         AS name,
  pg_get_function_identity_arguments(p.oid)          AS args,
  pg_get_functiondef(p.oid)                          AS def
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND (p.proname ~* '\mleague\M' OR pg_get_functiondef(p.oid) ~* '\mleague\M');

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Capture every trigger whose name, table, or def references "league"
-- ────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _trg_backup ON COMMIT DROP AS
SELECT
  t.tgname              AS name,
  c.relname             AS tbl,
  pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t
JOIN pg_class c     ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND ( t.tgname  ~* '\mleague\M'
     OR c.relname ~* '\mleague\M'
     OR pg_get_triggerdef(t.oid) ~* '\mleague\M' );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Drop the captured functions (CASCADE drops dependent triggers)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT name, args FROM _fn_backup LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.name, r.args);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Rename columns first (must be done while the old table name still exists)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leagues          RENAME COLUMN league_type TO game_type;
ALTER TABLE public.league_members   RENAME COLUMN league_id   TO game_id;
ALTER TABLE public.league_periods   RENAME COLUMN league_id   TO game_id;
ALTER TABLE public.matches          RENAME COLUMN league_id   TO game_id;
ALTER TABLE public.activity_events  RENAME COLUMN league_id   TO game_id;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Rename tables
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leagues        RENAME TO games;
ALTER TABLE public.league_members RENAME TO game_members;
ALTER TABLE public.league_periods RENAME TO game_periods;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Update join_requests data and check constraint ('league' → 'game')
-- ────────────────────────────────────────────────────────────────────────────
UPDATE public.join_requests
SET    target_type = 'game'
WHERE  target_type = 'league';

ALTER TABLE public.join_requests
  DROP CONSTRAINT IF EXISTS join_requests_target_type_check;

ALTER TABLE public.join_requests
  ADD CONSTRAINT join_requests_target_type_check
  CHECK (target_type = ANY (ARRAY['game'::text, 'match'::text]));

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Re-create functions with rewritten bodies
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r       record;
  new_def text;
BEGIN
  FOR r IN SELECT * FROM _fn_backup LOOP
    new_def := r.def;
    -- Order: longest tokens first so substring matches don't clobber compounds
    new_def := regexp_replace(new_def, '\mleague_members\M',  'game_members',  'g');
    new_def := regexp_replace(new_def, '\mleague_periods\M',  'game_periods',  'g');
    new_def := regexp_replace(new_def, '\mleague_type\M',     'game_type',     'g');
    new_def := regexp_replace(new_def, '\mp_league_id\M',     'p_game_id',     'g');
    new_def := regexp_replace(new_def, '\mleague_id\M',       'game_id',       'g');
    new_def := regexp_replace(new_def, '\mleagues\M',         'games',         'g');
    new_def := regexp_replace(new_def, '\mleague\M',          'game',          'g');
    EXECUTE new_def;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Re-create triggers (their CASCADE drops happened in step 3)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r       record;
  new_def text;
BEGIN
  FOR r IN SELECT * FROM _trg_backup LOOP
    new_def := r.def;
    new_def := regexp_replace(new_def, '\mleague_members\M',  'game_members',  'g');
    new_def := regexp_replace(new_def, '\mleague_periods\M',  'game_periods',  'g');
    new_def := regexp_replace(new_def, '\mleague_type\M',     'game_type',     'g');
    new_def := regexp_replace(new_def, '\mleague_id\M',       'game_id',       'g');
    new_def := regexp_replace(new_def, '\mleagues\M',         'games',         'g');
    new_def := regexp_replace(new_def, '\mleague\M',          'game',          'g');
    EXECUTE new_def;
  END LOOP;
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Verification queries (run manually after migration to confirm cleanliness)
-- ────────────────────────────────────────────────────────────────────────────
-- 1. No tables or columns named *league*:
--    SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%league%';
--    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND column_name ILIKE '%league%';
--
-- 2. No functions named *league* and no function body containing 'league':
--    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
--    WHERE n.nspname='public' AND (p.proname ILIKE '%league%' OR pg_get_functiondef(p.oid) ILIKE '%league%');
--
-- 3. No triggers named *league*:
--    SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname ILIKE '%league%';
--
-- 4. join_requests target_type is clean:
--    SELECT DISTINCT target_type FROM public.join_requests;
