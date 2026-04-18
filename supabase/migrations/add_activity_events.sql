-- ============================================================
-- Activity Events System Migration
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- ============================================================
-- 1. Activity events table
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_league_created
  ON activity_events (league_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_events_actor
  ON activity_events (actor_id, created_at DESC);

-- ============================================================
-- 2. RLS policies
-- ============================================================

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view league activity"
  ON activity_events FOR SELECT
  USING (
    league_id IN (
      SELECT league_id FROM league_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can insert activity"
  ON activity_events FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- 3. Trigger: player_joined_league
-- ============================================================

CREATE OR REPLACE FUNCTION fn_activity_player_joined_league()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO activity_events (event_type, league_id, actor_id, metadata)
  VALUES (
    'player_joined_league',
    NEW.league_id,
    NEW.user_id,
    jsonb_build_object(
      'player_name', (SELECT COALESCE(username, first_name, 'Player') FROM profiles WHERE id = NEW.user_id),
      'league_name', (SELECT name FROM leagues WHERE id = NEW.league_id)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_activity_player_joined ON league_members;
CREATE TRIGGER trg_activity_player_joined
  AFTER INSERT ON league_members
  FOR EACH ROW
  EXECUTE FUNCTION fn_activity_player_joined_league();

-- ============================================================
-- 4. Trigger: match_created
-- ============================================================

CREATE OR REPLACE FUNCTION fn_activity_match_created()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.league_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO activity_events (event_type, league_id, actor_id, match_id, metadata)
  VALUES (
    'match_created',
    NEW.league_id,
    auth.uid(),
    NEW.id,
    jsonb_build_object(
      'league_name', (SELECT name FROM leagues WHERE id = NEW.league_id),
      'course_name', COALESCE(NEW.course_name, ''),
      'match_date', COALESCE(NEW.match_date::TEXT, '')
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_activity_match_created ON matches;
CREATE TRIGGER trg_activity_match_created
  AFTER INSERT ON matches
  FOR EACH ROW
  EXECUTE FUNCTION fn_activity_match_created();

-- ============================================================
-- 5. Trigger: score_approved
-- ============================================================

CREATE OR REPLACE FUNCTION fn_activity_score_approved()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status != 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Skip casual matches (no league)
  IF (SELECT league_id FROM matches WHERE id = NEW.match_id) IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO activity_events (event_type, league_id, actor_id, match_id, metadata)
  VALUES (
    'score_approved',
    (SELECT league_id FROM matches WHERE id = NEW.match_id),
    NEW.user_id,
    NEW.match_id,
    jsonb_build_object(
      'player_name', (SELECT COALESCE(username, first_name, 'Player') FROM profiles WHERE id = NEW.user_id),
      'league_name', (SELECT l.name FROM matches m JOIN leagues l ON l.id = m.league_id WHERE m.id = NEW.match_id),
      'score', NEW.score,
      'course_name', (SELECT COALESCE(m.course_name, l.course_name, '') FROM matches m LEFT JOIN leagues l ON l.id = m.league_id WHERE m.id = NEW.match_id),
      'match_date', (SELECT COALESCE(m.match_date::TEXT, '') FROM matches m WHERE m.id = NEW.match_id)
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_activity_score_approved ON scores;
CREATE TRIGGER trg_activity_score_approved
  AFTER UPDATE ON scores
  FOR EACH ROW
  EXECUTE FUNCTION fn_activity_score_approved();

-- ============================================================
-- 6. RPC to fetch activity feed for a user's leagues
-- ============================================================

CREATE OR REPLACE FUNCTION get_activity_feed(p_user_id UUID, p_limit INT DEFAULT 20)
RETURNS TABLE (
  out_id UUID,
  out_event_type TEXT,
  out_league_id UUID,
  out_actor_id UUID,
  out_match_id UUID,
  out_metadata JSONB,
  out_created_at TIMESTAMPTZ,
  out_actor_name TEXT,
  out_actor_avatar_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ae.id,
    ae.event_type,
    ae.league_id,
    ae.actor_id,
    ae.match_id,
    ae.metadata,
    ae.created_at,
    COALESCE(p.username, p.first_name, 'Player')::TEXT,
    p.avatar_url::TEXT
  FROM activity_events ae
  JOIN profiles p ON p.id = ae.actor_id
  WHERE ae.league_id IN (
    SELECT lm.league_id FROM league_members lm WHERE lm.user_id = p_user_id
  )
  ORDER BY ae.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
