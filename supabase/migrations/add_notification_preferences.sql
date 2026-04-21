-- ============================================================
-- Notification preferences: per-type push opt-out
-- ============================================================
-- Lets users mute individual notification types while keeping
-- the master push subscription active. Opt-out model: absence
-- of a row means "enabled".
-- ============================================================

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, notification_type)
);

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user
  ON user_notification_preferences (user_id);

-- ------------------------------------------------------------
-- RLS: user manages own
-- ------------------------------------------------------------

ALTER TABLE user_notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own notification preferences"
  ON user_notification_preferences;
CREATE POLICY "Users manage own notification preferences"
  ON user_notification_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- RPC: should_send_push
-- ------------------------------------------------------------
-- Called by /api/push before dispatching web-push to the OS.
-- Returns true if no preference row exists (opt-out default),
-- or the row's push_enabled value otherwise.

CREATE OR REPLACE FUNCTION should_send_push(
  p_user_id UUID,
  p_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled BOOLEAN;
BEGIN
  SELECT push_enabled INTO v_enabled
  FROM user_notification_preferences
  WHERE user_id = p_user_id AND notification_type = p_type;

  -- No row → default to enabled
  RETURN COALESCE(v_enabled, true);
END;
$$;

-- ------------------------------------------------------------
-- RPC: get_my_notification_preferences
-- ------------------------------------------------------------
-- Returns all rows for the current user so the UI can render
-- toggles. Defaults (unstored types) are filled in client-side.

CREATE OR REPLACE FUNCTION get_my_notification_preferences()
RETURNS TABLE (
  notification_type TEXT,
  push_enabled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.notification_type, p.push_enabled
  FROM user_notification_preferences p
  WHERE p.user_id = auth.uid();
END;
$$;

-- ------------------------------------------------------------
-- RPC: set_notification_preference
-- ------------------------------------------------------------
-- Upsert a single preference row for the current user.

CREATE OR REPLACE FUNCTION set_notification_preference(
  p_type TEXT,
  p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO user_notification_preferences (user_id, notification_type, push_enabled, updated_at)
  VALUES (auth.uid(), p_type, p_enabled, now())
  ON CONFLICT (user_id, notification_type)
  DO UPDATE SET push_enabled = EXCLUDED.push_enabled, updated_at = now();
END;
$$;
