-- ============================================================
-- Grant service_role access to public tables
-- ============================================================
-- /api/og/round/[matchId] was failing with:
--   "permission denied for table matches"
-- …even though it uses SUPABASE_SERVICE_ROLE_KEY. In Supabase the
-- service_role is *supposed* to have ALL privileges by default, but
-- when tables were originally created in the Dashboard the default
-- grants didn't propagate to service_role for every table.
--
-- This migration explicitly grants the service role its standard
-- privileges across the public schema. Safe to re-run.
--
-- service_role already bypasses RLS; this is about the raw GRANT
-- layer (separate from RLS).
-- ============================================================

-- Usage on the schema
GRANT USAGE ON SCHEMA public TO service_role;

-- Read/write on existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

-- Sequences (for uuid/serial generation when inserting)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Ensure future tables also get these grants automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- Same story for anon and authenticated — ensure Supabase's standard
-- Dashboard defaults are in place. Read-only for anon + authenticated
-- is up to RLS (which we've already locked down per-table).
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- Verification:
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'matches';
-- Expected: rows for anon, authenticated, service_role with SELECT at minimum.
