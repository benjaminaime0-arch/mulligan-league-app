-- ============================================================
-- Join Requests: Table + RLS + RPCs + Notifications
-- ============================================================
-- Consolidates the join-request SQL that was previously scattered
-- across loose files in ~/Documents/Claude/Projects/Mulligan/
-- (untracked). This is now the single source of truth.
--
-- Depends on: add_notifications_system.sql (for create_notification)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('league', 'match')),
  target_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_target
  ON join_requests(target_type, target_id, status);
CREATE INDEX IF NOT EXISTS idx_join_requests_admin
  ON join_requests(admin_id, status);
CREATE INDEX IF NOT EXISTS idx_join_requests_requester
  ON join_requests(requester_id, status);

-- One pending request per user per target
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_requests_unique_pending
  ON join_requests(requester_id, target_type, target_id)
  WHERE status = 'pending';

-- ------------------------------------------------------------
-- 2. RLS
-- ------------------------------------------------------------

ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own requests" ON join_requests;
CREATE POLICY "Users can view own requests"
  ON join_requests FOR SELECT
  USING (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Admins can view requests for their targets" ON join_requests;
CREATE POLICY "Admins can view requests for their targets"
  ON join_requests FOR SELECT
  USING (auth.uid() = admin_id);

DROP POLICY IF EXISTS "Authenticated users can create requests" ON join_requests;
CREATE POLICY "Authenticated users can create requests"
  ON join_requests FOR INSERT
  WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "Admins can update requests" ON join_requests;
CREATE POLICY "Admins can update requests"
  ON join_requests FOR UPDATE
  USING (auth.uid() = admin_id);

-- ------------------------------------------------------------
-- 3. RPC: request_join_match
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION request_join_match(p_match_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_match_status TEXT;
  v_match_created_by UUID;
  v_match_course TEXT;
  v_match_date DATE;
  v_player_count INT;
  v_existing_count INT;
  v_pending_count INT;
  v_request_id UUID;
  v_requester_name TEXT;
BEGIN
  SELECT status, created_by, course_name, match_date
  INTO v_match_status, v_match_created_by, v_match_course, v_match_date
  FROM matches WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match not found');
  END IF;

  IF v_match_status IS NOT NULL AND v_match_status != 'scheduled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match is no longer accepting players');
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM match_players WHERE match_id = p_match_id AND user_id = v_user_id;
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already in this match');
  END IF;

  SELECT COUNT(*) INTO v_player_count FROM match_players WHERE match_id = p_match_id;
  IF v_player_count >= 4 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match is full');
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM join_requests
  WHERE requester_id = v_user_id AND target_type = 'match'
    AND target_id = p_match_id AND status = 'pending';
  IF v_pending_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a pending request for this match');
  END IF;

  SELECT COALESCE(username, first_name, 'Someone') INTO v_requester_name
  FROM profiles WHERE id = v_user_id;

  INSERT INTO join_requests (requester_id, target_type, target_id, admin_id)
  VALUES (v_user_id, 'match', p_match_id, v_match_created_by)
  RETURNING id INTO v_request_id;

  PERFORM create_notification(
    v_match_created_by,
    'join_request',
    v_requester_name || ' wants to join your match',
    COALESCE(v_match_course, 'Match') || ' · ' ||
      COALESCE(to_char(v_match_date, 'Mon DD'), 'Date TBA'),
    jsonb_build_object(
      'request_id', v_request_id,
      'request_type', 'match',
      'match_id', p_match_id,
      'requester_id', v_user_id,
      'requester_name', v_requester_name
    )
  );

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id);
END;
$$;

-- ------------------------------------------------------------
-- 4. RPC: request_join_league
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION request_join_league(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_league_admin UUID;
  v_league_name TEXT;
  v_league_max INT;
  v_member_count INT;
  v_existing_count INT;
  v_pending_count INT;
  v_request_id UUID;
  v_requester_name TEXT;
BEGIN
  SELECT admin_id, name, max_players
  INTO v_league_admin, v_league_name, v_league_max
  FROM leagues WHERE id = p_league_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'League not found');
  END IF;

  SELECT COUNT(*) INTO v_existing_count
  FROM league_members WHERE league_id = p_league_id AND user_id = v_user_id;
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already in this league');
  END IF;

  SELECT COUNT(*) INTO v_member_count FROM league_members WHERE league_id = p_league_id;
  IF v_league_max IS NOT NULL AND v_member_count >= v_league_max THEN
    RETURN jsonb_build_object('success', false, 'error', 'League is full');
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM join_requests
  WHERE requester_id = v_user_id AND target_type = 'league'
    AND target_id = p_league_id AND status = 'pending';
  IF v_pending_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You already have a pending request for this league');
  END IF;

  SELECT COALESCE(username, first_name, 'Someone') INTO v_requester_name
  FROM profiles WHERE id = v_user_id;

  INSERT INTO join_requests (requester_id, target_type, target_id, admin_id)
  VALUES (v_user_id, 'league', p_league_id, v_league_admin)
  RETURNING id INTO v_request_id;

  PERFORM create_notification(
    v_league_admin,
    'join_request',
    v_requester_name || ' wants to join ' || v_league_name,
    'Tap to approve or reject this request.',
    jsonb_build_object(
      'request_id', v_request_id,
      'request_type', 'league',
      'league_id', p_league_id,
      'requester_id', v_user_id,
      'requester_name', v_requester_name
    )
  );

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id);
END;
$$;

-- ------------------------------------------------------------
-- 5. RPC: approve_join_request
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION approve_join_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_req_status TEXT;
  v_req_admin UUID;
  v_req_type TEXT;
  v_req_target UUID;
  v_req_requester UUID;
  v_player_count INT;
  v_member_count INT;
  v_target_name TEXT;
  v_match_league_id UUID;
  v_match_course TEXT;
  v_match_date DATE;
  v_league_name TEXT;
  v_league_max INT;
BEGIN
  SELECT status, admin_id, target_type, target_id, requester_id
  INTO v_req_status, v_req_admin, v_req_type, v_req_target, v_req_requester
  FROM join_requests WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_req_admin != v_admin_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_req_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request already ' || v_req_status);
  END IF;

  IF v_req_type = 'match' THEN
    SELECT COUNT(*) INTO v_player_count FROM match_players WHERE match_id = v_req_target;
    IF v_player_count >= 4 THEN
      UPDATE join_requests SET status = 'rejected', resolved_at = now(), resolved_by = v_admin_id
        WHERE id = p_request_id;
      RETURN jsonb_build_object('success', false, 'error', 'Match is now full');
    END IF;

    SELECT league_id, course_name, match_date
    INTO v_match_league_id, v_match_course, v_match_date
    FROM matches WHERE id = v_req_target;

    IF v_match_league_id IS NOT NULL THEN
      INSERT INTO league_members (league_id, user_id) VALUES (v_match_league_id, v_req_requester)
      ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO match_players (match_id, user_id) VALUES (v_req_target, v_req_requester)
    ON CONFLICT DO NOTHING;

    v_target_name := COALESCE(v_match_course, 'the match');

    PERFORM create_notification(
      v_req_requester,
      'join_approved',
      'You''re in! Match request approved',
      v_target_name || ' · ' || COALESCE(to_char(v_match_date, 'Mon DD'), 'Date TBA'),
      jsonb_build_object('match_id', v_req_target)
    );

  ELSIF v_req_type = 'league' THEN
    SELECT name, max_players INTO v_league_name, v_league_max
    FROM leagues WHERE id = v_req_target;
    SELECT COUNT(*) INTO v_member_count FROM league_members WHERE league_id = v_req_target;

    IF v_league_max IS NOT NULL AND v_member_count >= v_league_max THEN
      UPDATE join_requests SET status = 'rejected', resolved_at = now(), resolved_by = v_admin_id
        WHERE id = p_request_id;
      RETURN jsonb_build_object('success', false, 'error', 'League is now full');
    END IF;

    INSERT INTO league_members (league_id, user_id) VALUES (v_req_target, v_req_requester)
    ON CONFLICT DO NOTHING;

    v_target_name := COALESCE(v_league_name, 'the league');

    PERFORM create_notification(
      v_req_requester,
      'join_approved',
      'Welcome! You''ve been accepted to ' || v_target_name,
      'You can now view the leaderboard and join matches.',
      jsonb_build_object('league_id', v_req_target)
    );
  END IF;

  UPDATE join_requests SET status = 'approved', resolved_at = now(), resolved_by = v_admin_id
    WHERE id = p_request_id;

  -- Mark admin's own pending join_request notification(s) for this request as read.
  -- This fixes the bug where another admin (or the same admin on a different device)
  -- would still see an unread notification after the request is already resolved.
  UPDATE notifications
    SET read_at = COALESCE(read_at, now())
    WHERE type = 'join_request'
      AND data->>'request_id' = p_request_id::text;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ------------------------------------------------------------
-- 6. RPC: reject_join_request
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION reject_join_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_req_status TEXT;
  v_req_admin UUID;
  v_req_type TEXT;
  v_req_target UUID;
  v_req_requester UUID;
  v_target_name TEXT;
BEGIN
  SELECT status, admin_id, target_type, target_id, requester_id
  INTO v_req_status, v_req_admin, v_req_type, v_req_target, v_req_requester
  FROM join_requests WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  IF v_req_admin != v_admin_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_req_status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request already ' || v_req_status);
  END IF;

  IF v_req_type = 'match' THEN
    SELECT COALESCE(course_name, 'the match') INTO v_target_name
    FROM matches WHERE id = v_req_target;
  ELSE
    SELECT COALESCE(name, 'the league') INTO v_target_name
    FROM leagues WHERE id = v_req_target;
  END IF;

  UPDATE join_requests SET status = 'rejected', resolved_at = now(), resolved_by = v_admin_id
    WHERE id = p_request_id;

  PERFORM create_notification(
    v_req_requester,
    'join_rejected',
    'Request declined',
    'Your request to join ' || v_target_name || ' was not approved.',
    jsonb_build_object(
      CASE WHEN v_req_type = 'match' THEN 'match_id' ELSE 'league_id' END,
      v_req_target
    )
  );

  -- Same mark-as-read dedupe as approve path
  UPDATE notifications
    SET read_at = COALESCE(read_at, now())
    WHERE type = 'join_request'
      AND data->>'request_id' = p_request_id::text;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ------------------------------------------------------------
-- 7. RPC: mark_join_request_notifications_read
-- ------------------------------------------------------------
-- Client-side helper so the UI doesn't need to do a raw
-- filtered UPDATE on notifications (keeps RLS policies simple).

CREATE OR REPLACE FUNCTION mark_join_request_notifications_read(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE notifications
    SET read_at = now()
    WHERE user_id = auth.uid()
      AND type = 'join_request'
      AND read_at IS NULL
      AND data->>'request_id' = p_request_id::text;
END;
$$;
