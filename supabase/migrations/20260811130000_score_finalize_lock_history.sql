-- ============================================================================
-- Scoring: edit history, post-completion lock, captain finalization
-- ============================================================================
-- Closes AUDIT 2026-08-10 P0#4. The 24h auto-validation crons (repaired
-- 20260723160000, verified green in prod) already prevent "blocked forever";
-- what was missing:
--
-- (1) HISTORY — score edits reset everyone's approvals leaving no trace of
--     what changed. New append-only score_revisions table, written by the
--     reset trigger; players whose sign-off gets invalidated are notified
--     (type 'score_submitted' so existing prefs/push routing apply).
--
-- (2) LOCK — a completed/cancelled match's score VALUES are frozen:
--     submit_match_scores now refuses ('Match is closed.', same copy as
--     upsert_score_hole), and a BEFORE trigger on scores closes the direct
--     PostgREST scores_update_own lane (the residue of AUDIT#1). System
--     lanes stay open: pg_trigger_depth()>1 (cascaded trigger writes) and
--     the mulligan.system_update GUC (24h crons).
--
-- (3) CAPTAIN FINALIZATION — finalize_match_scores(p_match_id): the game
--     admin or match creator can close out a round INSIDE the 24h window
--     once every card is in, or after 2h of inactivity — no more waiting a
--     full day on a no-show approver. Captain-finalized scores carry
--     approved_by = the captain (auto-validated rows keep NULL), so the
--     two paths stay distinguishable.
--
-- Also hardens submit_match_scores: target user_ids must be match players
-- (any participant could previously write score rows for ARBITRARY profile
-- ids), sane score/holes bounds, and submitted_by is finally populated
-- (upsert_score_hole already sets it; the aggregate path never did).
--
-- Safe to re-run: OR REPLACE / IF NOT EXISTS / DROP TRIGGER IF EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1a) score_revisions: append-only audit line per score/holes change.
--      No INSERT/UPDATE/DELETE grants — only the definer trigger writes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.score_revisions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid NOT NULL,
  user_id    uuid NOT NULL,
  old_score  int,
  new_score  int,
  old_holes  int,
  new_holes  int,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS score_revisions_match_idx
  ON public.score_revisions (match_id, changed_at DESC);

ALTER TABLE public.score_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS score_revisions_select_players ON public.score_revisions;
CREATE POLICY score_revisions_select_players ON public.score_revisions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM match_players mp
    WHERE mp.match_id = score_revisions.match_id
      AND mp.user_id = auth.uid()
  ));
REVOKE ALL ON public.score_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.score_revisions TO authenticated;

-- ---------------------------------------------------------------------------
-- (1b) reset_approvals_on_score_edit: + revision line + invalidation notice.
--      Fires per changed row (AFTER UPDATE WHEN score/holes changed). The
--      notification self-dedupes across a multi-row edit: the first fire
--      nulls every approval, so later fires in the same statement find no
--      approvers left to notify.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_approvals_on_score_edit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_editor uuid := COALESCE(auth.uid(), NEW.submitted_by);
  v_game_id uuid;
  v_course text;
  v_recipient RECORD;
BEGIN
  INSERT INTO score_revisions
    (match_id, user_id, old_score, new_score, old_holes, new_holes, changed_by)
  VALUES
    (NEW.match_id, NEW.user_id, OLD.score, NEW.score, OLD.holes, NEW.holes, v_editor);

  SELECT m.game_id, m.course_name INTO v_game_id, v_course
  FROM matches m WHERE m.id = NEW.match_id;

  -- Tell the players whose sign-off is being invalidated. Reuses the
  -- 'score_submitted' type so preferences/push routing keep working.
  FOR v_recipient IN
    SELECT mp.user_id FROM match_players mp
    WHERE mp.match_id = NEW.match_id
      AND mp.approved_at IS NOT NULL
      AND (v_editor IS NULL OR mp.user_id <> v_editor)
  LOOP
    PERFORM create_notification(
      v_recipient.user_id,
      'score_submitted',
      'Scores updated',
      'Scores were edited on ' || COALESCE(v_course, 'your match') || ' — approvals reset',
      jsonb_build_object('match_id', NEW.match_id, 'game_id', v_game_id)
    );
  END LOOP;

  UPDATE scores SET status = 'pending', approved_by = NULL, approved_at = NULL
  WHERE match_id = NEW.match_id AND status = 'approved';
  UPDATE match_players SET approved_at = NULL WHERE match_id = NEW.match_id;
  UPDATE matches SET status = 'in_progress' WHERE id = NEW.match_id AND status = 'completed';
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- (2a) submit_match_scores: closed-match gate, roster validation, bounds,
--      submitted_by. Body otherwise per prod (2026-08-11 pg_get_functiondef);
--      the completed->scheduled "reopen" branch is gone — dead behind the
--      gate, and reopening is exactly the un-audited mutation P0#4 bans.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_match_scores(p_match_id uuid, p_scores json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_status text;
  v_item JSON;
  v_score_user_id UUID;
  v_score_val INT;
  v_holes INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM match_players
    WHERE match_id = p_match_id AND user_id = v_user_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'You are not a player in this match.');
  END IF;

  SELECT status INTO v_status FROM matches WHERE id = p_match_id;
  IF v_status IN ('completed', 'cancelled') THEN
    RETURN json_build_object('success', false, 'error', 'Match is closed.');
  END IF;

  -- Validate EVERY item before writing ANY — a refusal must not leave a
  -- partial batch behind.
  FOR v_item IN SELECT * FROM json_array_elements(p_scores)
  LOOP
    v_score_user_id := (v_item->>'user_id')::UUID;
    v_score_val := (v_item->>'score')::INT;
    v_holes := (v_item->>'holes')::INT;

    -- Every target must be a player of THIS match — previously any
    -- participant could write score rows for arbitrary profile ids.
    IF NOT EXISTS (
      SELECT 1 FROM match_players
      WHERE match_id = p_match_id AND user_id = v_score_user_id
    ) THEN
      RETURN json_build_object('success', false, 'error', 'Target is not a player in this match.');
    END IF;
    -- 0 is legal (stableford blob-out); 250 comfortably above any real total.
    IF v_score_val IS NULL OR v_score_val NOT BETWEEN 0 AND 250 THEN
      RETURN json_build_object('success', false, 'error', 'Invalid score.');
    END IF;
    IF v_holes IS NULL OR v_holes NOT IN (9, 18) THEN
      RETURN json_build_object('success', false, 'error', 'Invalid holes.');
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM json_array_elements(p_scores)
  LOOP
    v_score_user_id := (v_item->>'user_id')::UUID;
    v_score_val := (v_item->>'score')::INT;
    v_holes := (v_item->>'holes')::INT;

    INSERT INTO scores (match_id, user_id, score, holes, status, submitted_by)
    VALUES (p_match_id, v_score_user_id, v_score_val, v_holes, 'pending', v_user_id)
    ON CONFLICT (match_id, user_id)
    DO UPDATE SET score = v_score_val, holes = v_holes, status = 'pending',
                  approved_by = NULL, approved_at = NULL, submitted_by = v_user_id;
  END LOOP;

  -- Reset all player approvals, then mark submitter as approved
  UPDATE match_players
  SET approved_at = NULL
  WHERE match_id = p_match_id;

  UPDATE match_players
  SET approved_at = now()
  WHERE match_id = p_match_id AND user_id = v_user_id;

  RETURN json_build_object('success', true);
END;
$function$;

-- ---------------------------------------------------------------------------
-- (2b) Score lock triggers: value changes on a closed match raise. Two
--      triggers because INSERT has no OLD for the WHEN clause. Lanes for
--      system writes: trigger cascades (depth>1) + the crons' GUC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_score_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF pg_trigger_depth() > 1
     OR current_setting('mulligan.system_update', true) = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT status INTO v_status FROM matches WHERE id = NEW.match_id;
  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Match is closed.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_score_lock_update ON public.scores;
CREATE TRIGGER trg_enforce_score_lock_update
  BEFORE UPDATE ON public.scores
  FOR EACH ROW
  WHEN (OLD.score IS DISTINCT FROM NEW.score OR OLD.holes IS DISTINCT FROM NEW.holes)
  EXECUTE FUNCTION enforce_score_lock();

DROP TRIGGER IF EXISTS trg_enforce_score_lock_insert ON public.scores;
CREATE TRIGGER trg_enforce_score_lock_insert
  BEFORE INSERT ON public.scores
  FOR EACH ROW
  EXECUTE FUNCTION enforce_score_lock();

-- ---------------------------------------------------------------------------
-- (3) finalize_match_scores: captain closes out the round inside the 24h
--     window. Guard: every card in, OR 2h of inactivity. Same write shape
--     as auto_approve_stale_scores' per-match block, but approved_by is
--     stamped with the captain so the paths stay distinguishable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_match_scores(p_match_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_match matches%ROWTYPE;
  v_is_captain boolean;
  v_player_count int;
  v_scored_count int;
  v_idle boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Match not found');
  END IF;
  IF v_match.status IN ('completed', 'cancelled') THEN
    RETURN json_build_object('success', false, 'error', 'Match is closed.');
  END IF;

  SELECT (v_match.created_by = v_caller) OR EXISTS (
    SELECT 1 FROM games g WHERE g.id = v_match.game_id AND g.admin_id = v_caller
  ) INTO v_is_captain;
  IF NOT v_is_captain THEN
    RETURN json_build_object('success', false, 'error', 'Only the game admin or match creator can finalize.');
  END IF;

  SELECT count(*), count(s.id)
  INTO v_player_count, v_scored_count
  FROM match_players mp
  LEFT JOIN scores s ON s.match_id = mp.match_id AND s.user_id = mp.user_id
  WHERE mp.match_id = p_match_id;

  IF v_scored_count = 0 THEN
    RETURN json_build_object('success', false, 'error', 'No scores to finalize.');
  END IF;

  v_idle := COALESCE(v_match.last_edit_at, v_match.created_at) < now() - interval '2 hours';
  IF v_scored_count < v_player_count AND NOT v_idle THEN
    RETURN json_build_object('success', false, 'error', 'Wait for every card, or for 2 hours of inactivity.');
  END IF;

  -- Same sanctioned lane as the 24h crons for the cascading writes.
  PERFORM set_config('mulligan.system_update', 'on', true);

  UPDATE scores
  SET status = 'approved', approved_by = v_caller, approved_at = now()
  WHERE match_id = p_match_id AND status = 'pending';

  UPDATE match_players
  SET approved_at = now()
  WHERE match_id = p_match_id AND approved_at IS NULL;

  UPDATE matches
  SET status = 'completed'
  WHERE id = p_match_id AND status IN ('scheduled', 'in_progress');

  RETURN json_build_object(
    'success', true,
    'player_count', v_player_count,
    'scored_count', v_scored_count
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.finalize_match_scores(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.finalize_match_scores(uuid) FROM PUBLIC, anon;
