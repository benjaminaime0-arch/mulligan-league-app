-- ============================================================
-- User honors RPC: cross-league "trophy shelf"
-- ============================================================
-- Aggregates per-league badges won by a given user across every
-- league they're a member of. Powers the "Your honors" card on
-- /profile so the viewer can see at a glance where they've placed
-- (and in which league) without opening each league page.
--
-- Implementation note: delegates to the existing `get_league_badges`
-- RPC via a LATERAL join, so the badge-computation logic lives in
-- exactly one place. If a new badge is added to `get_league_badges`,
-- it automatically shows up here without a second migration.
--
-- Access semantics: inherits the per-league gate from
-- `get_league_badges`. The caller must be a member of the league to
-- see ANY of its badges (including their own for legacy leagues they
-- left — by design, privacy over nostalgia). Works naturally for the
-- common case (viewing your own profile, where you're still in all
-- the relevant leagues).
-- ============================================================

DROP FUNCTION IF EXISTS get_user_honors(uuid);

CREATE OR REPLACE FUNCTION get_user_honors(p_user_id uuid)
RETURNS TABLE (
  league_id    uuid,
  league_name  text,
  badge_key    text,
  value        numeric,
  unit         text,
  sub          text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    l.id   AS league_id,
    l.name AS league_name,
    b.badge_key,
    b.value,
    b.unit,
    b.sub
  FROM league_members lm
  JOIN leagues l ON l.id = lm.league_id
  -- LATERAL so the lookup sees `l.id` per row. `get_league_badges`
  -- already enforces member-only access via `is_league_member`, so
  -- we don't need to re-gate here.
  CROSS JOIN LATERAL get_league_badges(l.id) b
  WHERE lm.user_id = p_user_id
    AND b.user_id  = p_user_id
  -- Stable order: league name, then badge priority (same ordering
  -- the frontend uses when rendering per-league honors).
  ORDER BY
    l.name ASC,
    CASE b.badge_key
      WHEN 'lowest_round'    THEN 1
      WHEN 'most_active'     THEN 2
      WHEN 'most_consistent' THEN 3
      ELSE 99
    END;
$$;

-- ============================================================
-- Verification
-- ============================================================
-- As yourself:
--   SELECT * FROM get_user_honors(auth.uid());
-- Returns 0–3 rows per league you're in, one per badge you hold.
--
-- As another user (on their profile):
--   SELECT * FROM get_user_honors('<their-id>');
-- Returns only badges they hold in leagues you ALSO belong to —
-- the inner RPC's member gate filters everything else out.
-- ============================================================
