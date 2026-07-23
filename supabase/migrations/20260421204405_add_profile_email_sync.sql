-- ============================================================
-- Sync profiles.email when auth.users.email changes
-- ============================================================
-- profiles.email is a denormalized copy of auth.users.email. If a
-- user changes their account email in Supabase Auth, the profile
-- row drifts until they reload a screen that happens to refresh it
-- (if any). This trigger mirrors the change automatically.
--
-- Note: initial profile creation on signup is presumably handled by
-- an existing auth.users INSERT trigger in the Dashboard (since
-- signups already work). This migration only adds the UPDATE path.
--
-- SECURITY DEFINER lets the function update profiles despite RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION sync_auth_email_to_profile()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles
  SET email = NEW.email
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_auth_email_to_profile ON auth.users;
CREATE TRIGGER trg_sync_auth_email_to_profile
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION sync_auth_email_to_profile();

-- ------------------------------------------------------------
-- One-shot reconciliation
-- ------------------------------------------------------------
-- In case any profiles already drifted, align them once on migration.
-- Safe / idempotent — no-op for rows that are already in sync.

UPDATE profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS DISTINCT FROM u.email;
