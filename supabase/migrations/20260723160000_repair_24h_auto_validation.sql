-- ============================================================================
-- Repair the 24h score auto-validation pipeline (T0.1, AUD#7)
-- ============================================================================
-- WHY
-- Both maintenance crons are silently broken the moment they have real work:
--
--   * jobid 3  auto-approve-stale-scores        (hourly)
--   * jobid 4  mulligan_auto_complete_stale_matches (every 15 min)
--
-- Each ends with a plain `UPDATE matches SET status = 'completed'`. That
-- UPDATE fires the BEFORE UPDATE trigger enforce_match_creator_field_
-- immutability(), which only allows a transition to 'completed' when
-- pg_trigger_depth() > 1 (i.e. called from inside another trigger) or when
-- auth.uid() is the game admin. Under pg_cron neither is true: the function
-- call is a top-level statement (depth inside the trigger = 1, not > 1) and
-- auth.uid() IS NULL, so the trigger raises check_violation and the whole
-- run rolls back — including the score approvals that preceded it.
--
-- The original migration (add_match_auto_complete_24h.sql) assumed
-- SECURITY DEFINER would bypass the trigger. It does not: SECURITY DEFINER
-- changes the role for privilege/RLS checks, it never suppresses triggers.
--
-- THE FIX — an explicit, transaction-local system gate (session GUC):
-- the maintenance functions set `mulligan.system_update = 'on'` via
-- set_config(..., is_local => true) before touching matches; the trigger
-- honours that gate for STATUS transitions only. Immutable columns
-- (game_id, period_id, created_by) stay protected even for the system path.
-- Clients cannot reach set_config through PostgREST, so the gate is only
-- reachable through these functions.
--
-- Also folded in (same subsystem, same root cause):
--   * auto_approve_stale_scores now measures staleness against the match's
--     last_edit_at (bumped on every score change) instead of scores.created_at,
--     which never changes on re-submission — an edited score used to lose its
--     fresh 24h confirmation window. Falls back to scores.created_at for
--     matches predating the last_edit_at column.
--   * auto_approve_stale_scores no longer skips matches in 'in_progress'
--     (the status a score edit rolls a completed match back into) or
--     'completed' (auto_complete can complete a match while a straggler
--     score is still pending). Pending scores now converge to approved in
--     every match state — this is what makes "unresolved scores > 24h = 0"
--     hold as an invariant.
--   * search_path pinned on every function this file touches (Supabase
--     advisor: SECURITY DEFINER without SET search_path is hijackable).
--
-- Safe to re-run: all statements are CREATE OR REPLACE / idempotent.
-- Cron registrations are untouched — both jobs call these functions by name.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Immutability trigger: allow status transitions for the system gate
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_match_creator_field_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN := false;
  v_system   BOOLEAN := false;
BEGIN
  -- Called from inside another trigger → system change, always allow
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  -- Maintenance functions (cron) set this transaction-local GUC. It gates
  -- STATUS transitions only — immutable columns below stay enforced.
  v_system := COALESCE(current_setting('mulligan.system_update', true), '') = 'on';

  -- Game admin of this match's game → can override any rule
  IF NEW.game_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM games l
    WHERE l.id = NEW.game_id AND l.admin_id = auth.uid()
  ) THEN
    v_is_admin := true;
  END IF;

  -- Status transitions: scheduled→in_progress, in_progress→scheduled,
  -- completed→in_progress allowed for any caller. Completion (→ completed)
  -- must come from a trigger (pg_trigger_depth > 1), a game admin, or the
  -- system maintenance path.
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'completed' AND NOT v_is_admin AND NOT v_system THEN
      RAISE EXCEPTION 'Match status can only become completed via the score-approval flow'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Immutable columns
  IF OLD.game_id IS DISTINCT FROM NEW.game_id THEN
    RAISE EXCEPTION 'Match game cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.period_id IS DISTINCT FROM NEW.period_id THEN
    RAISE EXCEPTION 'Match period cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION 'Match creator cannot be changed' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. Hourly auto-validation (US9): pending scores untouched for 24h approve
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_approve_stale_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
BEGIN
  -- Transaction-local: honoured by enforce_match_creator_field_immutability
  PERFORM set_config('mulligan.system_update', 'on', true);

  FOR v_match IN
    SELECT DISTINCT s.match_id
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.status = 'pending'
      -- 24h of no activity on the match, not 24h since first submission:
      -- last_edit_at bumps on every score insert/update/delete, so an edit
      -- restarts the confirmation window (scores.created_at never changes
      -- on re-submission). NULL last_edit_at = pre-column match; fall back.
      AND COALESCE(m.last_edit_at, s.created_at) < now() - interval '24 hours'
  LOOP
    -- The whole match auto-validates as a unit (existing product semantic):
    -- approved_by stays NULL, which is the marker for "validated by time,
    -- not by a peer".
    UPDATE scores
    SET status = 'approved', approved_at = now()
    WHERE match_id = v_match.match_id AND status = 'pending';

    UPDATE match_players
    SET approved_at = now()
    WHERE match_id = v_match.match_id AND approved_at IS NULL;

    UPDATE matches
    SET status = 'completed'
    WHERE id = v_match.match_id AND status IN ('scheduled', 'in_progress');
  END LOOP;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. 15-min stale-match completion: unchanged semantics, unblocked
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_complete_stale_matches()
RETURNS TABLE (completed_match_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('mulligan.system_update', 'on', true);

  RETURN QUERY
  UPDATE matches m
  SET status = 'completed'
  WHERE m.status IN ('scheduled', 'in_progress')
    AND m.last_edit_at IS NOT NULL
    AND m.last_edit_at < now() - interval '24 hours'
    AND EXISTS (
      SELECT 1 FROM scores s WHERE s.match_id = m.id
    )
  RETURNING m.id;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. Same-subsystem hygiene: pin search_path on the last_edit_at bumper
-- ----------------------------------------------------------------------------
ALTER FUNCTION public.bump_match_last_edit_at() SET search_path = public;

-- ----------------------------------------------------------------------------
-- 5. Allow status = 'cancelled' on matches
-- ----------------------------------------------------------------------------
-- The frontend already handles 'cancelled' everywhere (profile/matches filters
-- it out, MatchDetailCard hides scoring/share actions, the game calendar skips
-- it) but the CHECK constraint predates the status and still only allows
-- scheduled/in_progress/completed — discovered when the T0.1 backfill's
-- void-with-notice path failed a dry run. Constraint order note (see memory
-- of the rename migration): drop the old CHECK before any data could use the
-- new value.
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_status_check
  CHECK (status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]));

-- ============================================================================
-- VERIFICATION (run manually; all read-only)
-- ============================================================================
-- 1. Trigger + functions carry the new bodies and pinned search_path:
--    SELECT proname, prosecdef, proconfig FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND proname IN
--      ('enforce_match_creator_field_immutability',
--       'auto_approve_stale_scores', 'auto_complete_stale_matches',
--       'bump_match_last_edit_at');
--
-- 2. Cron jobs still registered and running clean (status = 'succeeded'):
--    SELECT jobname, schedule, active FROM cron.job;
--    SELECT j.jobname, d.status, d.return_message, d.start_time
--    FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
--    ORDER BY d.start_time DESC LIMIT 20;
--
-- 3. The invariant this repairs — must trend to zero and stay there:
--    SELECT count(*) AS unresolved_over_24h
--    FROM scores s JOIN matches m ON m.id = s.match_id
--    WHERE s.status = 'pending'
--      AND COALESCE(m.last_edit_at, s.created_at) < now() - interval '24 hours';
--
-- 4. matches_status_check now includes 'cancelled':
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'matches_status_check';
-- ============================================================================
