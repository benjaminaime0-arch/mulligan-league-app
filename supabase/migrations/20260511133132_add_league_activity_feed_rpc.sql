-- ============================================================
-- League-scoped activity feed RPC
-- ============================================================
-- The existing `get_activity_feed(p_user_id, p_limit)` aggregates
-- events across ALL leagues the viewer is a member of — shape made
-- sense when the profile page surfaced one "what's happening in my
-- world" feed. The product has moved to per-league feeds ("what's
-- happening in THIS league") so we need a league-scoped variant.
--
-- Returns the same column shape as get_activity_feed so the frontend
-- can use a shared row component if needed.
--
-- Safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION get_league_activity_feed(
  p_league_id UUID,
  p_limit INT DEFAULT 20
)
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Gate: caller must be a member of this league. Without this check
  -- the SECURITY DEFINER bypass would let anyone hit the feed of any
  -- league just by knowing its id, which is the exact leak
  -- privatize_leagues.sql closed for direct SELECTs.
  IF NOT EXISTS (
    SELECT 1
    FROM league_members lm
    WHERE lm.league_id = p_league_id
      AND lm.user_id   = auth.uid()
  ) THEN
    RETURN;
  END IF;

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
  WHERE ae.league_id = p_league_id
  ORDER BY ae.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_league_activity_feed(UUID, INT) TO authenticated;
