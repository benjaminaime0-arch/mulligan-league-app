-- ============================================================================
-- Export of Dashboard-authored prod-only objects (T0.2, AUD#6)
-- ============================================================================
-- WHY
-- Five RPCs the app calls (create_game, generate_game_periods,
-- submit_match_scores, approve_match_scores, search_players) plus nine
-- supporting functions, four tables, their triggers, and one cron
-- registration existed ONLY in the production database — authored in the
-- Dashboard, never committed. A fresh `supabase db reset` could not rebuild
-- the backend. This file is a snapshot of production taken 2026-07-23 via
-- pg_get_functiondef / catalog queries.
--
-- FAITHFUL EXCEPT (deliberate divergences, called out inline):
--   * send_push_on_notification: prod hardcodes a bearer secret and posts to
--     the OLD domain (app.mulligangame.com). This repo is public — the secret
--     cannot be committed. Exported version reads vault secret
--     'push_webhook_secret' and posts to app.mulliganclub.co; skips silently
--     when the secret is absent (same pattern as sync_to_airtable).
--     Production must be updated to this version (T0.4 apply).
--   * create_game / generate_game_periods / advance_game_period are exported
--     AS-IS, i.e. BROKEN (duplicate game_members insert + writes to the
--     dropped activity_log table — game creation has failed in prod since
--     ~Apr 21). The fix is the NEXT migration (20260723151000), so a fresh
--     replay ends in the fixed state while this file stays a faithful record.
--
-- match_approvals / score_approvals are legacy artifacts of the pre-Apr-17
-- approval system, still live in prod (4 + 12 rows) and referenced by
-- approve_score / check_and_finalize_match_scores — exported for parity, not
-- endorsement.
--
-- Safe to re-run: IF NOT EXISTS / OR REPLACE / drop-then-create throughout.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS citext;   -- leads.email
CREATE EXTENSION IF NOT EXISTS pg_net;   -- push + airtable webhooks

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
  id           uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name         text        NOT NULL,
  email        citext      NOT NULL,
  source       text,
  source_page  text,
  source_image text,
  status       text        NOT NULL DEFAULT 'new',
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_name_email_uq ON public.leads (lower(name), email);
CREATE INDEX IF NOT EXISTS leads_email_idx  ON public.leads (email);
CREATE INDEX IF NOT EXISTS leads_source_idx ON public.leads (source);
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads (status);
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
-- No policies in prod: service-role/definer access only.

CREATE TABLE IF NOT EXISTS public.newsletter_subscribers (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email         text        NOT NULL UNIQUE,
  subscribed_at timestamptz DEFAULT now(),
  source        text        DEFAULT 'landing_page'
);
ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.newsletter_subscribers;
CREATE POLICY "Allow anonymous inserts" ON public.newsletter_subscribers
  FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "Block anonymous reads" ON public.newsletter_subscribers;
CREATE POLICY "Block anonymous reads" ON public.newsletter_subscribers
  FOR SELECT USING (false);

CREATE TABLE IF NOT EXISTS public.match_approvals (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id   uuid        NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_match_approvals_match_id ON public.match_approvals (match_id);
ALTER TABLE public.match_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_approvals_select_auth ON public.match_approvals;
CREATE POLICY match_approvals_select_auth ON public.match_approvals
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS match_approvals_insert_player ON public.match_approvals;
CREATE POLICY match_approvals_insert_player ON public.match_approvals
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.match_players
      WHERE match_players.match_id = match_approvals.match_id
        AND match_players.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS match_approvals_delete_player ON public.match_approvals;
CREATE POLICY match_approvals_delete_player ON public.match_approvals
  FOR DELETE USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.score_approvals (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  score_id    uuid        NOT NULL REFERENCES public.scores(id) ON DELETE CASCADE,
  approved_by uuid        NOT NULL REFERENCES public.profiles(id),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (score_id, approved_by)
);
ALTER TABLE public.score_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view score approvals" ON public.score_approvals;
CREATE POLICY "Users can view score approvals" ON public.score_approvals
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Players can approve scores" ON public.score_approvals;
CREATE POLICY "Players can approve scores" ON public.score_approvals
  FOR INSERT WITH CHECK (
    auth.uid() = approved_by
    AND auth.uid() <> (SELECT scores.user_id FROM public.scores WHERE scores.id = score_approvals.score_id)
    AND EXISTS (
      SELECT 1 FROM public.match_players mp
      JOIN public.scores s ON s.match_id = mp.match_id
      WHERE s.id = score_approvals.score_id AND mp.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Core-loop RPCs (verbatim from prod)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_match_scores(p_match_id uuid, p_scores json)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_item JSON;
  v_score_user_id UUID;
  v_score_val INT;
  v_holes INT;
BEGIN
  -- Verify caller is a player in this match
  IF NOT EXISTS (
    SELECT 1 FROM match_players
    WHERE match_id = p_match_id AND user_id = v_user_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'You are not a player in this match.');
  END IF;

  -- Upsert each score
  FOR v_item IN SELECT * FROM json_array_elements(p_scores)
  LOOP
    v_score_user_id := (v_item->>'user_id')::UUID;
    v_score_val := (v_item->>'score')::INT;
    v_holes := (v_item->>'holes')::INT;

    INSERT INTO scores (match_id, user_id, score, holes, status)
    VALUES (p_match_id, v_score_user_id, v_score_val, v_holes, 'pending')
    ON CONFLICT (match_id, user_id)
    DO UPDATE SET score = v_score_val, holes = v_holes, status = 'pending',
                  approved_by = NULL, approved_at = NULL;
  END LOOP;

  -- Reset all player approvals, then mark submitter as approved
  UPDATE match_players
  SET approved_at = NULL
  WHERE match_id = p_match_id;

  UPDATE match_players
  SET approved_at = now()
  WHERE match_id = p_match_id AND user_id = v_user_id;

  -- Reset match status back to scheduled (in case it was already completed)
  UPDATE matches
  SET status = 'scheduled'
  WHERE id = p_match_id AND status = 'completed';

  RETURN json_build_object('success', true);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.submit_match_scores(uuid, json) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_match_scores(p_match_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_player_count INT;
  v_approved_count INT;
BEGIN
  -- Verify caller is a player in this match
  IF NOT EXISTS (
    SELECT 1 FROM match_players
    WHERE match_id = p_match_id AND user_id = v_user_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'You are not a player in this match.');
  END IF;

  -- Mark this player as having approved
  UPDATE match_players
  SET approved_at = now()
  WHERE match_id = p_match_id AND user_id = v_user_id;

  -- Check if all players have now approved
  SELECT count(*), count(approved_at)
  INTO v_player_count, v_approved_count
  FROM match_players
  WHERE match_id = p_match_id;

  -- If all approved, mark all scores as official
  IF v_approved_count = v_player_count THEN
    UPDATE scores
    SET status = 'approved'
    WHERE match_id = p_match_id;

    -- Optionally mark match as completed
    UPDATE matches
    SET status = 'completed'
    WHERE id = p_match_id AND status = 'scheduled';
  END IF;

  RETURN json_build_object(
    'success', true,
    'approved_count', v_approved_count,
    'player_count', v_player_count
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.approve_match_scores(uuid) TO authenticated;

-- BROKEN AS EXPORTED (faithful prod snapshot): the game_members insert
-- duplicates the auto_add_game_admin_to_members trigger's row (unique
-- violation) and activity_log no longer exists. Fixed in 20260723151000.
CREATE OR REPLACE FUNCTION public.create_game(p_name text, p_course_name text, p_max_players integer, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_scoring_cards integer DEFAULT NULL::integer, p_total_cards integer DEFAULT NULL::integer, p_game_type text DEFAULT 'stroke_play'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_game_id UUID;
  v_invite_code TEXT;
  v_user_id UUID := auth.uid();
BEGIN
  -- Create game with all new fields
  INSERT INTO public.games (
    name,
    course_name,
    admin_id,
    max_players,
    game_type,
    start_date,
    end_date,
    scoring_cards_count,
    total_cards_count
  )
  VALUES (
    p_name,
    p_course_name,
    v_user_id,
    p_max_players,
    COALESCE(p_game_type, 'stroke_play'),
    p_start_date,
    p_end_date,
    p_scoring_cards,
    p_total_cards
  )
  RETURNING id, invite_code INTO v_game_id, v_invite_code;

  -- Auto-join admin as member
  INSERT INTO public.game_members (game_id, user_id, role)
  VALUES (v_game_id, v_user_id, 'admin');

  -- Log activity
  INSERT INTO public.activity_log (game_id, user_id, action_type, metadata)
  VALUES (
    v_game_id,
    v_user_id,
    'game_created',
    json_build_object(
      'name', p_name,
      'game_type', COALESCE(p_game_type, 'stroke_play'),
      'start_date', p_start_date,
      'end_date', p_end_date
    )::jsonb
  );

  RETURN json_build_object(
    'success', true,
    'game_id', v_game_id,
    'invite_code', v_invite_code
  );
END;
$function$;

-- BROKEN AS EXPORTED (activity_log) — fixed in 20260723151000.
CREATE OR REPLACE FUNCTION public.generate_game_periods(p_game_id uuid, p_start_date date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_game public.games%ROWTYPE;
  v_member_count INTEGER;
  v_num_weeks INTEGER;
  v_week INTEGER;
  v_week_start DATE;
  v_week_end DATE;
  v_period_status TEXT;
BEGIN
  -- Verify admin
  SELECT * INTO v_game FROM public.games WHERE id = p_game_id;
  IF v_game.admin_id != auth.uid() THEN
    RETURN json_build_object('success', false, 'error', 'Only the game admin can generate periods');
  END IF;

  -- Count members
  SELECT COUNT(*) INTO v_member_count FROM public.game_members WHERE game_id = p_game_id;
  IF v_member_count < 2 THEN
    RETURN json_build_object('success', false, 'error', 'Need at least 2 players to start the game');
  END IF;

  -- Delete existing upcoming periods (safe to regenerate)
  DELETE FROM public.game_periods WHERE game_id = p_game_id AND status = 'upcoming';

  -- Calculate weeks: N-1 weeks for N players (minimum 1)
  v_num_weeks := GREATEST(v_member_count - 1, 1);

  -- Generate weekly periods
  FOR v_week IN 1..v_num_weeks LOOP
    v_week_start := p_start_date + ((v_week - 1) * 7);
    v_week_end := v_week_start + 6;

    IF v_week = 1 THEN
      v_period_status := 'active';
    ELSE
      v_period_status := 'upcoming';
    END IF;

    INSERT INTO public.game_periods (game_id, week_number, name, start_date, end_date, status)
    VALUES (p_game_id, v_week, 'Week ' || v_week, v_week_start, v_week_end, v_period_status);
  END LOOP;

  -- Activate the game
  UPDATE public.games SET status = 'active' WHERE id = p_game_id;

  -- Log activity
  INSERT INTO public.activity_log (game_id, user_id, action_type, metadata)
  VALUES (p_game_id, auth.uid(), 'period_started', json_build_object('week', 1, 'total_weeks', v_num_weeks)::jsonb);

  RETURN json_build_object(
    'success', true,
    'weeks_generated', v_num_weeks,
    'start_date', p_start_date,
    'end_date', p_start_date + ((v_num_weeks - 1) * 7) + 6
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_players(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, username text, first_name text, last_name text, avatar_url text, club text, town text, handicap numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT p.id, p.username, p.first_name, p.last_name,
         p.avatar_url, p.club, p.town, p.handicap
  FROM profiles p
  WHERE p.username   ILIKE '%' || p_query || '%'
     OR p.first_name ILIKE '%' || p_query || '%'
     OR p.last_name  ILIKE '%' || p_query || '%'
  LIMIT p_limit;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Legacy / supporting RPCs (verbatim from prod)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_score(p_score_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_score   RECORD;
BEGIN
  -- Fetch the score
  SELECT s.id, s.user_id, s.match_id, s.status
    INTO v_score
    FROM public.scores s
   WHERE s.id = p_score_id;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Score not found.');
  END IF;

  -- Cannot approve your own score
  IF v_score.user_id = v_user_id THEN
    RETURN json_build_object('success', false, 'error', 'You cannot approve your own score.');
  END IF;

  -- Must be a player in the same match
  IF NOT EXISTS (
    SELECT 1 FROM public.match_players
     WHERE match_id = v_score.match_id AND user_id = v_user_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Only match participants can approve scores.');
  END IF;

  -- Already approved? idempotent
  IF v_score.status = 'approved' THEN
    RETURN json_build_object('success', true, 'already_approved', true);
  END IF;

  -- Record the approval
  INSERT INTO public.score_approvals (score_id, approved_by)
  VALUES (p_score_id, v_user_id)
  ON CONFLICT DO NOTHING;

  -- Mark score as approved
  UPDATE public.scores
     SET status = 'approved',
         approved_by = v_user_id,
         approved_at = now()
   WHERE id = p_score_id;

  RETURN json_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_and_finalize_match_scores(p_match_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_player_count int;
  v_approval_count int;
BEGIN
  SELECT COUNT(*) INTO v_player_count FROM match_players WHERE match_id = p_match_id;
  SELECT COUNT(*) INTO v_approval_count FROM match_approvals WHERE match_id = p_match_id;

  IF v_approval_count >= v_player_count THEN
    UPDATE scores
    SET status = 'approved', approved_at = now()
    WHERE match_id = p_match_id AND status = 'pending';

    UPDATE matches
    SET status = 'completed'
    WHERE id = p_match_id AND status != 'completed';
  END IF;
END;
$function$;

-- BROKEN AS EXPORTED (activity_log; also actor NULL) — fixed in 20260723151000.
CREATE OR REPLACE FUNCTION public.advance_game_period(p_game_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_current_period public.game_periods%ROWTYPE;
  v_next_period public.game_periods%ROWTYPE;
BEGIN
  -- Find current active period
  SELECT * INTO v_current_period
  FROM public.game_periods
  WHERE game_id = p_game_id AND status = 'active'
  ORDER BY week_number LIMIT 1;

  IF v_current_period IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No active period found');
  END IF;

  -- Complete current period
  UPDATE public.game_periods SET status = 'completed' WHERE id = v_current_period.id;

  -- Log period end
  INSERT INTO public.activity_log (game_id, user_id, action_type, metadata)
  VALUES (p_game_id, NULL, 'period_ended', json_build_object('week', v_current_period.week_number)::jsonb);

  -- Find next period
  SELECT * INTO v_next_period
  FROM public.game_periods
  WHERE game_id = p_game_id AND week_number = v_current_period.week_number + 1;

  IF v_next_period IS NOT NULL THEN
    -- Activate next period
    UPDATE public.game_periods SET status = 'active' WHERE id = v_next_period.id;

    INSERT INTO public.activity_log (game_id, user_id, action_type, metadata)
    VALUES (p_game_id, NULL, 'period_started', json_build_object('week', v_next_period.week_number)::jsonb);

    RETURN json_build_object('success', true, 'new_week', v_next_period.week_number);
  ELSE
    -- Game is complete
    UPDATE public.games SET status = 'completed' WHERE id = p_game_id;
    RETURN json_build_object('success', true, 'game_completed', true);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', 'Player'),
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'username'
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_match_scheduled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_creator_name TEXT;
  v_game RECORD;
  v_member RECORD;
BEGIN
  IF NEW.game_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(p.username, p.first_name, 'Someone') INTO v_creator_name
  FROM profiles p WHERE p.id = NEW.created_by;

  SELECT l.id, l.name INTO v_game
  FROM games l WHERE l.id = NEW.game_id;

  IF v_game IS NULL THEN RETURN NEW; END IF;

  FOR v_member IN
    SELECT mp.user_id
    FROM match_players mp
    WHERE mp.match_id = NEW.id
      AND mp.user_id != NEW.created_by
  LOOP
    PERFORM create_notification(
      v_member.user_id,
      'match_scheduled',
      'New match scheduled',
      v_creator_name || ' scheduled a match at ' || COALESCE(NEW.course_name, 'TBA') ||
        ' in ' || v_game.name,
      jsonb_build_object(
        'match_id', NEW.id,
        'game_id', NEW.game_id,
        'game_name', v_game.name,
        'match_date', NEW.match_date
      )
    );
  END LOOP;
  RETURN NEW;
END;
$function$;

-- DIVERGES FROM PROD (deliberately): prod hardcodes a bearer secret (cannot
-- live in a public repo) and posts to the retired app.mulligangame.com
-- domain. This version reads vault secret 'push_webhook_secret', posts to
-- the current domain, and skips silently when the secret is absent.
-- Production must be updated to this version + secret rotated (T0.4).
CREATE OR REPLACE FUNCTION public.send_push_on_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  push_secret text;
BEGIN
  SELECT decrypted_secret INTO push_secret
    FROM vault.decrypted_secrets WHERE name = 'push_webhook_secret' LIMIT 1;

  IF push_secret IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url := 'https://app.mulliganclub.co/api/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || push_secret
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'record', jsonb_build_object(
        'id', NEW.id,
        'user_id', NEW.user_id,
        'type', NEW.type,
        'title', NEW.title,
        'body', NEW.body,
        'data', NEW.data
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'send_push_on_notification failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_leads_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_to_airtable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fn_url      text := 'https://abizphozurvgdjljwvfx.supabase.co/functions/v1/sync-to-airtable';
  -- The anon key is public by design (shipped in every browser bundle).
  anon_key    text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiaXpwaG96dXJ2Z2RqbGp3dmZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNTQ1NDcsImV4cCI6MjA4ODYzMDU0N30.mqXeT3cToNAJHrAbbM8_u1yV6L-re8y2sL3hZ1wIghY';
  sync_secret text;
  table_name  text := tg_argv[0];
begin
  select decrypted_secret into sync_secret
    from vault.decrypted_secrets where name = 'airtable_sync_secret' limit 1;

  if sync_secret is null then return new; end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'x-sync-secret', sync_secret
    ),
    body    := jsonb_build_object(
      'table',  table_name,
      'type',   tg_op,
      'record', row_to_json(new)
    )
  );
  return new;
exception when others then
  raise warning 'sync_to_airtable(%) failed: %', table_name, sqlerrm;
  return new;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 4. Triggers
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_leads_touch ON public.leads;
CREATE TRIGGER trg_leads_touch BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION touch_leads_updated_at();

DROP TRIGGER IF EXISTS trg_push_on_notification ON public.notifications;
CREATE TRIGGER trg_push_on_notification AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION send_push_on_notification();

DROP TRIGGER IF EXISTS trg_sync_profiles_to_airtable ON public.profiles;
CREATE TRIGGER trg_sync_profiles_to_airtable AFTER INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION sync_to_airtable('profiles');

DROP TRIGGER IF EXISTS trg_sync_games_to_airtable ON public.games;
CREATE TRIGGER trg_sync_games_to_airtable AFTER INSERT OR UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION sync_to_airtable('games');

DROP TRIGGER IF EXISTS trg_sync_matches_to_airtable ON public.matches;
CREATE TRIGGER trg_sync_matches_to_airtable AFTER INSERT OR UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION sync_to_airtable('matches');

DROP TRIGGER IF EXISTS trg_sync_scores_to_airtable ON public.scores;
CREATE TRIGGER trg_sync_scores_to_airtable AFTER INSERT OR UPDATE ON public.scores
  FOR EACH ROW EXECUTE FUNCTION sync_to_airtable('scores');

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ----------------------------------------------------------------------------
-- 5. Cron: the hourly auto-approve job (job was Dashboard-registered)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('auto-approve-stale-scores')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'auto-approve-stale-scores'
  );
END $$;

SELECT cron.schedule(
  'auto-approve-stale-scores',
  '0 * * * *',
  $$SELECT auto_approve_stale_scores()$$
);

-- ============================================================================
-- VERIFICATION (read-only)
-- ============================================================================
-- 1. Every RPC the app calls exists:
--    SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND proname IN
--    ('create_game','generate_game_periods','submit_match_scores',
--     'approve_match_scores','search_players');
-- 2. Both cron jobs registered:
--    SELECT jobname, schedule FROM cron.job;
-- 3. Tables present: SELECT to_regclass('public.leads'),
--    to_regclass('public.newsletter_subscribers'),
--    to_regclass('public.match_approvals'), to_regclass('public.score_approvals');
-- ============================================================================
