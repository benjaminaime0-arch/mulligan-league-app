-- ============================================================
-- Notifications System Migration
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- ============================================================
-- 1. Notifications table
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}',
  read_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- ============================================================
-- 2. Push subscriptions table
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions (user_id);

-- ============================================================
-- 3. RLS policies for notifications
-- ============================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Block direct client inserts. SECURITY DEFINER trigger functions
-- bypass RLS by design and continue to work.
CREATE POLICY "Block direct client inserts on notifications"
  ON notifications FOR INSERT
  WITH CHECK (false);

-- ============================================================
-- 4. RLS policies for push_subscriptions
-- ============================================================

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own push subscriptions"
  ON push_subscriptions FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- 5. Helper: create notification for a user
-- ============================================================

CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT DEFAULT NULL,
  p_data JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO notifications (user_id, type, title, body, data)
  VALUES (p_user_id, p_type, p_title, p_body, p_data)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. Trigger: scores submitted → notify other match players
-- ============================================================

CREATE OR REPLACE FUNCTION notify_score_submitted()
RETURNS TRIGGER AS $$
DECLARE
  v_match RECORD;
  v_submitter_name TEXT;
  v_player RECORD;
BEGIN
  -- Get match info
  SELECT m.id, m.course_name, m.league_id, l.name AS league_name
  INTO v_match
  FROM matches m
  LEFT JOIN leagues l ON l.id = m.league_id
  WHERE m.id = NEW.match_id;

  -- Get submitter name
  SELECT COALESCE(p.username, p.first_name, 'Someone') INTO v_submitter_name
  FROM profiles p WHERE p.id = NEW.user_id;

  -- Notify all OTHER players in the match
  FOR v_player IN
    SELECT mp.user_id
    FROM match_players mp
    WHERE mp.match_id = NEW.match_id
      AND mp.user_id != NEW.user_id
  LOOP
    PERFORM create_notification(
      v_player.user_id,
      'score_submitted',
      'Scores submitted',
      v_submitter_name || ' submitted scores for ' || COALESCE(v_match.course_name, 'a match'),
      jsonb_build_object(
        'match_id', NEW.match_id,
        'league_id', v_match.league_id,
        'league_name', v_match.league_name
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only fire on first score insert for a match (avoid duplicate notifications)
DROP TRIGGER IF EXISTS trg_score_submitted ON scores;
CREATE TRIGGER trg_score_submitted
  AFTER INSERT ON scores
  FOR EACH ROW
  EXECUTE FUNCTION notify_score_submitted();

-- ============================================================
-- 7. Trigger: player approves scores → notify others
-- ============================================================

CREATE OR REPLACE FUNCTION notify_score_approved()
RETURNS TRIGGER AS $$
DECLARE
  v_match RECORD;
  v_approver_name TEXT;
  v_player RECORD;
BEGIN
  -- Only fire when approved_at changes from NULL to a value
  IF OLD.approved_at IS NOT NULL OR NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get match info
  SELECT m.id, m.course_name, m.league_id, m.status, l.name AS league_name
  INTO v_match
  FROM matches m
  LEFT JOIN leagues l ON l.id = m.league_id
  WHERE m.id = NEW.match_id;

  -- Get approver name
  SELECT COALESCE(p.username, p.first_name, 'Someone') INTO v_approver_name
  FROM profiles p WHERE p.id = NEW.user_id;

  -- Notify all OTHER players in the match
  FOR v_player IN
    SELECT mp.user_id
    FROM match_players mp
    WHERE mp.match_id = NEW.match_id
      AND mp.user_id != NEW.user_id
  LOOP
    PERFORM create_notification(
      v_player.user_id,
      'score_approved',
      v_approver_name || ' approved scores',
      'Scores approved for ' || COALESCE(v_match.course_name, 'a match'),
      jsonb_build_object(
        'match_id', NEW.match_id,
        'league_id', v_match.league_id,
        'league_name', v_match.league_name
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_score_approved ON match_players;
CREATE TRIGGER trg_score_approved
  AFTER UPDATE ON match_players
  FOR EACH ROW
  WHEN (OLD.approved_at IS DISTINCT FROM NEW.approved_at)
  EXECUTE FUNCTION notify_score_approved();

-- ============================================================
-- 8. Trigger: match completed → notify all players
-- ============================================================

CREATE OR REPLACE FUNCTION notify_match_completed()
RETURNS TRIGGER AS $$
DECLARE
  v_match RECORD;
  v_player RECORD;
BEGIN
  -- Only fire when status changes to 'completed'
  IF OLD.status = 'completed' OR NEW.status != 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT NEW.id AS id, NEW.course_name AS course_name, NEW.league_id AS league_id,
         l.name AS league_name
  INTO v_match
  FROM leagues l
  WHERE l.id = NEW.league_id;

  FOR v_player IN
    SELECT mp.user_id
    FROM match_players mp
    WHERE mp.match_id = NEW.id
  LOOP
    PERFORM create_notification(
      v_player.user_id,
      'match_completed',
      'Match completed!',
      'All scores approved for ' || COALESCE(NEW.course_name, 'your match') ||
        CASE WHEN v_match.league_name IS NOT NULL THEN ' in ' || v_match.league_name ELSE '' END,
      jsonb_build_object(
        'match_id', NEW.id,
        'league_id', NEW.league_id,
        'league_name', v_match.league_name
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_match_completed ON matches;
CREATE TRIGGER trg_match_completed
  AFTER UPDATE ON matches
  FOR EACH ROW
  EXECUTE FUNCTION notify_match_completed();

-- ============================================================
-- 9. Trigger: new member joins league → notify existing members
-- ============================================================

CREATE OR REPLACE FUNCTION notify_league_member_joined()
RETURNS TRIGGER AS $$
DECLARE
  v_new_member_name TEXT;
  v_league RECORD;
  v_member RECORD;
BEGIN
  -- Get new member name
  SELECT COALESCE(p.username, p.first_name, 'Someone') INTO v_new_member_name
  FROM profiles p WHERE p.id = NEW.user_id;

  -- Get league info
  SELECT l.id, l.name INTO v_league
  FROM leagues l WHERE l.id = NEW.league_id;

  IF v_league IS NULL THEN RETURN NEW; END IF;

  -- Notify all OTHER existing members
  FOR v_member IN
    SELECT lm.user_id
    FROM league_members lm
    WHERE lm.league_id = NEW.league_id
      AND lm.user_id != NEW.user_id
  LOOP
    PERFORM create_notification(
      v_member.user_id,
      'member_joined',
      v_new_member_name || ' joined ' || v_league.name,
      'A new player has joined your league.',
      jsonb_build_object(
        'league_id', NEW.league_id,
        'league_name', v_league.name,
        'new_member_id', NEW.user_id
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_league_member_joined ON league_members;
CREATE TRIGGER trg_league_member_joined
  AFTER INSERT ON league_members
  FOR EACH ROW
  EXECUTE FUNCTION notify_league_member_joined();

-- ============================================================
-- 10. Trigger: new match scheduled → notify league members
-- ============================================================

-- Fires per match_players INSERT so each newly-added player gets
-- exactly one "you've been added to a match" notification.
-- The previous design (fire on matches INSERT) was broken because
-- match_players rows are inserted in a second statement — the
-- function body looped over an empty set and nobody was notified.
CREATE OR REPLACE FUNCTION notify_match_player_added()
RETURNS TRIGGER AS $$
DECLARE
  v_match RECORD;
BEGIN
  SELECT m.status, m.course_name, m.league_id, m.match_date, m.created_by,
         l.name AS league_name
  INTO v_match
  FROM matches m
  LEFT JOIN leagues l ON l.id = m.league_id
  WHERE m.id = NEW.match_id;

  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_match.status IS DISTINCT FROM 'scheduled' THEN RETURN NEW; END IF;
  IF v_match.league_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.user_id = v_match.created_by THEN RETURN NEW; END IF;

  PERFORM create_notification(
    NEW.user_id,
    'match_scheduled',
    'You''ve been added to a match',
    'In ' || COALESCE(v_match.league_name, 'your league') ||
      ' at ' || COALESCE(v_match.course_name, 'TBA') ||
      ' on ' || COALESCE(to_char(v_match.match_date, 'Mon DD'), 'TBA'),
    jsonb_build_object(
      'match_id', NEW.match_id,
      'league_id', v_match.league_id,
      'league_name', v_match.league_name,
      'match_date', v_match.match_date
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_match_player_added ON match_players;
CREATE TRIGGER trg_match_player_added
  AFTER INSERT ON match_players
  FOR EACH ROW
  EXECUTE FUNCTION notify_match_player_added();

-- ============================================================
-- 11. RPC: mark notifications as read
-- ============================================================

CREATE OR REPLACE FUNCTION mark_notifications_read(p_notification_ids UUID[])
RETURNS VOID AS $$
BEGIN
  UPDATE notifications
  SET read_at = now()
  WHERE id = ANY(p_notification_ids)
    AND user_id = auth.uid()
    AND read_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS VOID AS $$
BEGIN
  UPDATE notifications
  SET read_at = now()
  WHERE user_id = auth.uid()
    AND read_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 12. RPC: get unread count
-- ============================================================

CREATE OR REPLACE FUNCTION get_unread_notification_count()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM notifications
  WHERE user_id = auth.uid()
    AND read_at IS NULL;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- NOTES:
--
-- Run this migration in your Supabase SQL Editor.
--
-- The notification types (plus join_* types from
-- add_join_requests_system.sql) are:
--   score_submitted   - Someone submitted scores for a match you're in
--   score_approved    - Someone approved scores for a match you're in
--   match_completed   - All players approved, match is finalized
--   member_joined     - A new player joined your league
--   match_scheduled   - You were added to a scheduled league match
--   join_request      - Someone wants to join your league/match (admin)
--   join_approved     - Your join request was accepted
--   join_rejected     - Your join request was declined
--
-- Each notification has a `data` JSONB field with relevant IDs
-- for navigation (match_id, league_id, request_id, etc.)
--
-- Dispatch to Web Push is handled by /api/push, invoked via a
-- Supabase Database Webhook on notifications INSERT (configured
-- in the Supabase Dashboard, not here).
-- ============================================================
