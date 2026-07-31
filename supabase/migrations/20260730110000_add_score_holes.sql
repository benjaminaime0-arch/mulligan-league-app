-- ============================================================================
-- Per-hole scorecards (Phase B, feature 1): score_holes + sum trigger + RPCs
-- ============================================================================
-- Additive to the aggregate model: scores.score stays the canonical total.
-- The moment a score row has hole detail, that detail becomes the source of
-- truth — a trigger recomputes scores.score = SUM(strokes) on every hole
-- write, and the existing approval machinery reacts to that UPDATE exactly
-- as it does to an aggregate edit (trg_reset_approvals_on_score_edit resets
-- the other players' approved scores, clears match_players approvals and
-- rolls a completed match back). Aggregate-only rounds are untouched.
--
-- Writes go through upsert_score_hole() (SECURITY DEFINER), NOT client RLS:
--   * the on-course reality is one person keeping the card for all players,
--     so "players may only write their own holes" (the naive RLS model)
--     cannot express the batch flow — the participant gate lives in the RPC,
--     mirroring submit_match_scores;
--   * it matches the repo convention for guarded writes (notifications,
--     create_notification; scores, submit_match_scores).
-- Reads: any game member who can see the match (user_can_see_match), which
-- is also what Realtime will enforce for Phase E subscriptions.
--
-- Safe to re-run: IF NOT EXISTS / OR REPLACE / DROP IF EXISTS throughout.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.score_holes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id    uuid NOT NULL REFERENCES public.scores(id) ON DELETE CASCADE,
  hole_number smallint NOT NULL CHECK (hole_number BETWEEN 1 AND 18),
  strokes     smallint NOT NULL CHECK (strokes BETWEEN 1 AND 15),
  UNIQUE (score_id, hole_number)
);

ALTER TABLE public.score_holes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS score_holes_select_match_visible ON public.score_holes;
CREATE POLICY score_holes_select_match_visible ON public.score_holes
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.scores s
      WHERE s.id = score_holes.score_id
        AND user_can_see_match(s.match_id, auth.uid())
    )
  );

REVOKE ALL ON public.score_holes FROM anon, authenticated;
GRANT SELECT ON public.score_holes TO authenticated;

-- ---------------------------------------------------------------------------
-- Sum trigger: hole detail owns the aggregate
-- ---------------------------------------------------------------------------
-- The UPDATE below is what wakes the existing approval-reset machinery
-- (trg_reset_approvals_on_score_edit fires WHEN score changes). The edited
-- row's own status is reset here, since that trigger only resets the OTHERS.
-- If the last hole row is deleted the aggregate keeps its final value: the
-- round simply reverts to aggregate-entry semantics.
CREATE OR REPLACE FUNCTION public.sync_score_from_holes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_score_id uuid := COALESCE(NEW.score_id, OLD.score_id);
  v_sum int;
BEGIN
  SELECT sum(strokes)::int INTO v_sum
  FROM public.score_holes WHERE score_id = v_score_id;

  IF v_sum IS NOT NULL THEN
    UPDATE public.scores
    SET score = v_sum,
        status = 'pending',
        approved_by = NULL,
        approved_at = NULL
    WHERE id = v_score_id
      AND (score IS DISTINCT FROM v_sum OR status = 'approved');
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_score_from_holes ON public.score_holes;
CREATE TRIGGER trg_sync_score_from_holes
  AFTER INSERT OR UPDATE OR DELETE ON public.score_holes
  FOR EACH ROW EXECUTE FUNCTION public.sync_score_from_holes();

-- ---------------------------------------------------------------------------
-- upsert_score_hole: the single write path for hole strokes
-- ---------------------------------------------------------------------------
-- p_strokes NULL deletes the hole entry (mis-tap eraser). Creates the parent
-- scores row on first hole (pending, submitted_by = caller). After a write
-- the caller is re-approved, mirroring submit_match_scores: entering data is
-- implicit approval of what you just entered.
CREATE OR REPLACE FUNCTION public.upsert_score_hole(
  p_match_id uuid,
  p_user_id uuid,
  p_hole_number int,
  p_strokes int
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_status text;
  v_score_id uuid;
  v_round_holes int;
  v_total int;
  v_thru int;
  v_rows int;
  v_changed boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Same participant gate as submit_match_scores, for caller AND target.
  IF NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND user_id = v_caller) THEN
    RETURN json_build_object('success', false, 'error', 'You are not a player in this match.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND user_id = p_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'Target is not a player in this match.');
  END IF;

  SELECT status INTO v_status FROM matches WHERE id = p_match_id;
  IF v_status IN ('completed', 'cancelled') THEN
    RETURN json_build_object('success', false, 'error', 'Match is closed.');
  END IF;

  IF p_hole_number IS NULL OR p_hole_number NOT BETWEEN 1 AND 18 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid hole number.');
  END IF;
  IF p_strokes IS NOT NULL AND p_strokes NOT BETWEEN 1 AND 15 THEN
    RETURN json_build_object('success', false, 'error', 'Invalid strokes.');
  END IF;

  -- Round length: the course card when the match has one, else 18.
  SELECT COALESCE(
    (SELECT count(*)::int FROM course_holes ch
     WHERE ch.course_id = COALESCE(m.course_id, g.course_id)),
    18
  ) INTO v_round_holes
  FROM matches m LEFT JOIN games g ON g.id = m.game_id
  WHERE m.id = p_match_id;
  IF v_round_holes = 0 THEN
    v_round_holes := 18;
  END IF;

  SELECT id INTO v_score_id FROM scores
  WHERE match_id = p_match_id AND user_id = p_user_id;

  IF v_score_id IS NULL THEN
    IF p_strokes IS NULL THEN
      RETURN json_build_object('success', true, 'total', NULL, 'thru', 0);
    END IF;
    INSERT INTO scores (match_id, user_id, score, holes, status, submitted_by)
    VALUES (p_match_id, p_user_id, p_strokes, v_round_holes, 'pending', v_caller)
    RETURNING id INTO v_score_id;
    v_changed := true;
  END IF;

  IF p_strokes IS NULL THEN
    DELETE FROM score_holes
    WHERE score_id = v_score_id AND hole_number = p_hole_number;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_changed := v_changed OR v_rows > 0;
  ELSE
    INSERT INTO score_holes (score_id, hole_number, strokes)
    VALUES (v_score_id, p_hole_number, p_strokes)
    ON CONFLICT (score_id, hole_number)
    DO UPDATE SET strokes = EXCLUDED.strokes
    WHERE score_holes.strokes IS DISTINCT FROM EXCLUDED.strokes;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_changed := v_changed OR v_rows > 0;
  END IF;

  -- Approval semantics, mirroring submit_match_scores exactly: any real
  -- change resets everyone's sign-off; entering data re-approves the person
  -- holding the card. The sum trigger already resets others when the TOTAL
  -- moves — this also covers the first-hole INSERT, where the seeded total
  -- equals the hole sum and that trigger is a no-op.
  IF v_changed THEN
    UPDATE match_players SET approved_at = NULL
    WHERE match_id = p_match_id AND user_id <> v_caller AND approved_at IS NOT NULL;
    UPDATE match_players SET approved_at = now()
    WHERE match_id = p_match_id AND user_id = v_caller;
  END IF;

  SELECT s.score, count(sh.id)::int INTO v_total, v_thru
  FROM scores s LEFT JOIN score_holes sh ON sh.score_id = s.id
  WHERE s.id = v_score_id
  GROUP BY s.score;

  RETURN json_build_object('success', true, 'total', v_total, 'thru', v_thru);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_score_hole(uuid, uuid, int, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_match_scorecard: the single fetch for scorecard entry + live view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_match_scorecard(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_course jsonb;
  v_players jsonb;
  v_match record;
BEGIN
  IF NOT user_can_see_match(p_match_id, v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not visible');
  END IF;

  SELECT m.id, m.status, m.course_name, m.match_date,
         COALESCE(m.course_id, g.course_id) AS course_id
  INTO v_match
  FROM matches m LEFT JOIN games g ON g.id = m.game_id
  WHERE m.id = p_match_id;

  IF v_match.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not found');
  END IF;

  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'city', c.city, 'par', c.par,
    'holes_count', (SELECT count(*) FROM course_holes ch WHERE ch.course_id = c.id),
    'holes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'n', ch.hole_number, 'par', ch.par, 'hcp', ch.hcp_index,
        'dist', ch.dist_yellow_m, 'tee', ch.tee_note
      ) ORDER BY ch.hole_number)
      FROM course_holes ch WHERE ch.course_id = c.id
    ), '[]'::jsonb)
  ) INTO v_course
  FROM courses c WHERE c.id = v_match.course_id;

  SELECT COALESCE(jsonb_agg(p ORDER BY p->>'display_name'), '[]'::jsonb) INTO v_players
  FROM (
    SELECT jsonb_build_object(
      'user_id', mp.user_id,
      'display_name', COALESCE(pr.username, pr.first_name, 'Player'),
      'avatar_url', pr.avatar_url,
      'score_status', s.status,
      'total', s.score,
      'declared_holes', s.holes,
      'thru', COALESCE((SELECT count(*) FROM score_holes sh WHERE sh.score_id = s.id), 0),
      'holes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('n', sh.hole_number, 'strokes', sh.strokes)
                         ORDER BY sh.hole_number)
        FROM score_holes sh WHERE sh.score_id = s.id
      ), '[]'::jsonb)
    ) AS p
    FROM match_players mp
    JOIN profiles pr ON pr.id = mp.user_id
    LEFT JOIN scores s ON s.match_id = mp.match_id AND s.user_id = mp.user_id
    WHERE mp.match_id = p_match_id
  ) sub;

  RETURN jsonb_build_object(
    'success', true,
    'match_id', v_match.id,
    'match_status', v_match.status,
    'course_name', v_match.course_name,
    'course', v_course,
    'players', v_players,
    'editable', v_match.status NOT IN ('completed', 'cancelled')
                AND EXISTS (SELECT 1 FROM match_players
                            WHERE match_id = p_match_id AND user_id = v_caller)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_match_scorecard(uuid) TO authenticated;

-- ============================================================================
-- Verification (run manually):
--   SELECT upsert_score_hole('<match>', '<player>', 1, 5);
--   SELECT score FROM scores WHERE match_id = '<match>';   -- equals hole sum
--   SELECT get_match_scorecard('<match>');
-- ============================================================================
