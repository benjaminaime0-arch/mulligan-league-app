-- Card lifecycle v2. UTC instants, course-local deadlines, immutable revisions.
-- Existing confirmed cards are preserved as validated; no retrospective deadlines.
ALTER TABLE courses ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Paris';
CREATE FUNCTION personal_timezone_valid() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN RAISE EXCEPTION 'Invalid IANA course timezone.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_course_timezone BEFORE INSERT OR UPDATE OF timezone ON courses FOR EACH ROW EXECUTE FUNCTION personal_timezone_valid();
ALTER TABLE personal_rounds DROP CONSTRAINT personal_rounds_status_check;
ALTER TABLE personal_rounds ADD COLUMN course_timezone text NOT NULL DEFAULT 'Europe/Paris',
 ADD COLUMN entry_deadline_at timestamptz,
 ADD COLUMN submitted_at timestamptz,
 ADD COLUMN validator_id uuid REFERENCES profiles(id),
 ADD COLUMN validation_requested_at timestamptz,
 ADD COLUMN auto_validation_at timestamptz,
 ADD COLUMN timer_cancelled_at timestamptz,
 ADD COLUMN corrected_at timestamptz,
 ADD COLUMN validated_at timestamptz,
 ADD COLUMN disputed_at timestamptz,
 ADD COLUMN validation_method text CHECK(validation_method IN('self','manual','automatic','player_acceptance','legacy'));
CREATE FUNCTION personal_entry_deadline(p_day date,p_timezone text) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path=public AS $$ SELECT (p_day+2)::timestamp AT TIME ZONE p_timezone $$;
-- The deadline is exclusive local midnight; 23:59:59.999999 is still on time.
UPDATE personal_rounds r SET course_timezone=c.timezone,entry_deadline_at=personal_entry_deadline(r.played_on,c.timezone)
 FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE r.tee_id=t.id;
UPDATE personal_rounds SET status='validated',submitted_at=confirmed_at,validated_at=confirmed_at,validation_method='legacy' WHERE status='confirmed';
ALTER TABLE personal_rounds ADD CONSTRAINT personal_rounds_status_check CHECK(status IN('draft','pending_validation','pending_player_confirmation','validated','disputed','void'));
ALTER TABLE personal_rounds ALTER COLUMN entry_deadline_at SET NOT NULL;
ALTER TABLE personal_rounds DROP CONSTRAINT personal_rounds_check;
ALTER TABLE personal_rounds ADD CHECK(played_on <= (created_at AT TIME ZONE course_timezone)::date);
ALTER TABLE personal_rounds ADD CONSTRAINT personal_validator_not_owner CHECK(validator_id IS NULL OR validator_id<>user_id);
ALTER TABLE personal_card_revisions ADD COLUMN actor_id uuid REFERENCES profiles(id),ADD COLUMN correction_reason text;
ALTER TABLE personal_card_revisions DISABLE TRIGGER personal_revision_immutable;
UPDATE personal_card_revisions v SET actor_id=r.user_id FROM personal_rounds r WHERE r.id=v.round_id;
ALTER TABLE personal_card_revisions ENABLE TRIGGER personal_revision_immutable;
ALTER TABLE personal_card_revisions ALTER COLUMN actor_id SET NOT NULL;
CREATE TABLE personal_card_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),round_id uuid NOT NULL REFERENCES personal_rounds(id),
 action text NOT NULL,actor_id uuid REFERENCES profiles(id),old_revision_id uuid,new_revision_id uuid,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),metadata jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE personal_card_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON personal_card_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON personal_card_events TO service_role;
CREATE INDEX ON personal_card_events(round_id,occurred_at);
CREATE TRIGGER personal_event_immutable BEFORE UPDATE OR DELETE ON personal_card_events FOR EACH ROW EXECUTE FUNCTION personal_immutable();
CREATE INDEX personal_due_cards ON personal_rounds(auto_validation_at) WHERE status='pending_validation';
CREATE FUNCTION personal_terminal_card_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.status IN('validated','disputed') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Validated and disputed cards are permanently locked.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER personal_terminal_card_guard BEFORE UPDATE ON personal_rounds FOR EACH ROW EXECUTE FUNCTION personal_terminal_card_guard();
CREATE OR REPLACE FUNCTION public.calculate_personal_level(p_user uuid,p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH recent AS (
  SELECT c.id,c.differential FROM personal_rounds r JOIN personal_card_revisions c ON c.id=r.current_revision_id
  WHERE r.user_id=p_user AND r.status='validated' AND (p_as_of IS NULL OR r.played_on<=p_as_of)
  ORDER BY r.played_on DESC,r.created_at DESC,r.id DESC LIMIT 20
 ), schedule AS (
  SELECT count(*)::int AS n FROM recent
 ), selection AS (
  SELECT n,CASE WHEN n<=5 THEN 1 WHEN n<=8 THEN 2 WHEN n<=11 THEN 3 WHEN n<=14 THEN 4
   WHEN n<=16 THEN 5 WHEN n<=18 THEN 6 WHEN n=19 THEN 7 ELSE 8 END AS used,
   CASE WHEN n=3 THEN -2 WHEN n IN(4,6) THEN -1 ELSE 0 END AS adjustment FROM schedule
 ), best AS (
  SELECT id,differential FROM recent ORDER BY differential,id LIMIT(SELECT used FROM selection)
 ) SELECT jsonb_build_object('value',CASE WHEN n=0 THEN NULL ELSE (SELECT round(avg(differential)+adjustment,1) FROM best) END,
 'status',CASE WHEN n=0 THEN 'unavailable' WHEN n<3 THEN 'provisional' ELSE 'established' END,
 'cards_count',n,'cards_used',CASE WHEN n=0 THEN 0 ELSE used END,
 'revision_ids',COALESCE((SELECT jsonb_agg(id ORDER BY differential,id) FROM best),'[]'::jsonb)) FROM selection
$$;
CREATE OR REPLACE FUNCTION public.create_personal_round(p_tee uuid,p_played_on date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE level jsonb; idx numeric; source text; r uuid; tz text; deadline timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 SELECT c.timezone INTO tz FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE t.id=p_tee;
 IF tz IS NULL THEN RAISE EXCEPTION 'Unknown tee.'; END IF;
 deadline:=personal_entry_deadline(p_played_on,tz);
 IF p_played_on IS NULL OR p_played_on>(clock_timestamp() AT TIME ZONE tz)::date THEN RAISE EXCEPTION 'Invalid play date.'; END IF;
 IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'Entry deadline passed: enter and submit by the end of the following course-local day.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM personal_tees WHERE id=p_tee) THEN RAISE EXCEPTION 'Unknown tee.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 level:=calculate_personal_level(auth.uid(),p_played_on);
 IF level->>'status'='established' THEN idx:=(level->>'value')::numeric; source:='internal';
 ELSE
  SELECT index_value INTO idx FROM official_index_declarations WHERE user_id=auth.uid() AND effective_on<=p_played_on
  ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1;
  source:=CASE WHEN idx IS NULL THEN 'default_54' ELSE 'declared_official' END; idx:=COALESCE(idx,54);
 END IF;
 INSERT INTO personal_rounds(user_id,tee_id,played_on,handicap_source,handicap_index,course_timezone,entry_deadline_at)
 VALUES(auth.uid(),p_tee,p_played_on,source,idx,tz,deadline) RETURNING id INTO r;
 RETURN jsonb_build_object('id',r);
END $$;
CREATE OR REPLACE FUNCTION public.save_personal_card(p_round uuid,p_holes jsonb,p_expected_version int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; n int;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 IF p_expected_version IS NULL OR r.draft_version<>p_expected_version THEN RAISE EXCEPTION 'This card changed elsewhere. Reload before saving.'; END IF;
 IF r.status<>'draft' THEN RAISE EXCEPTION 'Only drafts can be edited.'; END IF;
 IF clock_timestamp()>=r.entry_deadline_at THEN RAISE EXCEPTION 'Entry deadline passed.'; END IF;
 IF p_holes IS NULL OR jsonb_typeof(p_holes)<>'array' OR jsonb_array_length(p_holes)>18 THEN RAISE EXCEPTION 'Invalid hole data.'; END IF;
 SELECT l.hole_count INTO n FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id WHERE t.id=r.tee_id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_holes) h WHERE (h->>'hole_number')::int NOT BETWEEN 1 AND n) THEN
  RAISE EXCEPTION 'Hole is outside this layout.';
 END IF;
 DELETE FROM personal_round_holes WHERE round_id=p_round;
 INSERT INTO personal_round_holes(round_id,hole_number,completion,strokes)
 SELECT p_round,(h->>'hole_number')::int,h->>'completion',(h->>'strokes')::int FROM jsonb_array_elements(p_holes) h;
 UPDATE personal_rounds SET draft_version=draft_version+1 WHERE id=p_round;
 RETURN jsonb_build_object('draft_version',r.draft_version+1);
END $$;
CREATE OR REPLACE FUNCTION public.personal_build_revision(p_round uuid,p_scores jsonb,p_actor uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; t record; h record; php int; received int; adjusted int:=0;
 gross int:=0; stableford int:=0; valid_stroke boolean:=true; diff numeric; rev uuid; scores_json jsonb;
 tee_json jsonb; previous personal_card_revisions%ROWTYPE; level jsonb;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 IF NOT personal_reference_ready(r.tee_id) THEN RAISE EXCEPTION 'This tee needs verified rating, slope and hole data before confirmation.'; END IF;
 SELECT pt.*,l.hole_count,l.course_id,l.name AS layout_name,c.name AS course_name,sum(th.par)::int AS par_total
 INTO t FROM personal_tees pt JOIN personal_layouts l ON l.id=pt.layout_id JOIN courses c ON c.id=l.course_id
 JOIN personal_tee_holes th ON th.tee_id=pt.id WHERE pt.id=r.tee_id GROUP BY pt.id,l.id,c.id;
 IF (SELECT count(*) FROM jsonb_to_recordset(p_scores) AS sh(hole_number int,completion text,strokes int) WHERE completion IN('completed','picked_up'))<>t.hole_count THEN
  RAISE EXCEPTION 'Complete or explicitly pick up every hole before confirming.';
 END IF;
 IF jsonb_typeof(p_scores)<>'array' OR jsonb_array_length(p_scores)<>t.hole_count OR
 (SELECT count(DISTINCT (item->>'hole_number')::int) FROM jsonb_array_elements(p_scores)item)<>t.hole_count OR
 EXISTS(SELECT 1 FROM jsonb_to_recordset(p_scores) sh(hole_number int,completion text,strokes int)
 WHERE hole_number IS NULL OR hole_number NOT BETWEEN 1 AND t.hole_count OR completion IS NULL OR
 completion NOT IN('completed','picked_up') OR (completion='completed' AND (strokes IS NULL OR strokes NOT BETWEEN 1 AND 30)) OR (completion='picked_up' AND strokes IS NOT NULL))
 THEN RAISE EXCEPTION 'Invalid complete scorecard.'; END IF;
 SELECT jsonb_agg(jsonb_build_object('hole_number',sh.hole_number,'completion',sh.completion,'strokes',sh.strokes) ORDER BY sh.hole_number)
 INTO scores_json FROM jsonb_to_recordset(p_scores) sh(hole_number int,completion text,strokes int);
 SELECT * INTO previous FROM personal_card_revisions WHERE id=r.current_revision_id;
 php:=round((CASE WHEN t.hole_count=9 THEN round(r.handicap_index/2,1) ELSE r.handicap_index END)
       *t.slope_rating/113+t.course_rating-t.par_total)::int;
 FOR h IN SELECT sh.*,th.par,th.stroke_index FROM jsonb_to_recordset(scores_json) sh(hole_number int,completion text,strokes int) JOIN personal_tee_holes th
 ON th.tee_id=r.tee_id AND th.hole_number=sh.hole_number LOOP
  received:=personal_strokes(php,h.stroke_index,t.hole_count);
  adjusted:=adjusted+CASE WHEN h.completion='picked_up' THEN greatest(1,h.par+2+received)
                         ELSE least(h.strokes,greatest(1,h.par+2+received)) END;
  IF h.completion='picked_up' THEN valid_stroke:=false;
  ELSE gross:=gross+h.strokes; stableford:=stableford+greatest(0,2+h.par+received-h.strokes); END IF;
 END LOOP;
 diff:=round((113.0/t.slope_rating)*(adjusted-t.course_rating)*CASE WHEN t.hole_count=9 THEN 2 ELSE 1 END,1);
 tee_json:=to_jsonb(t)||jsonb_build_object('holes',(SELECT jsonb_agg(to_jsonb(th) ORDER BY hole_number) FROM personal_tee_holes th WHERE tee_id=r.tee_id));
 INSERT INTO personal_card_revisions(round_id,revision_number,scores,tee_snapshot,playing_handicap,gross_total,net_total,stableford_points,adjusted_gross,differential,actor_id,correction_reason)
 VALUES(p_round,COALESCE(previous.revision_number,0)+1,scores_json,tee_json,php,
 CASE WHEN valid_stroke THEN gross END,CASE WHEN valid_stroke THEN gross-php END,stableford,adjusted,diff,p_actor,p_reason) RETURNING id INTO rev;
 RETURN rev;
END $$;

-- Only related players can be chosen; private profile/catalogue data never leaks.
CREATE FUNCTION personal_validator_allowed(p_owner uuid,p_validator uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT p_validator IS NOT NULL AND p_validator<>p_owner AND EXISTS(
 SELECT 1 FROM game_members a JOIN game_members b ON b.game_id=a.game_id WHERE a.user_id=p_owner AND b.user_id=p_validator)
$$;
CREATE FUNCTION personal_settle_card(p_round uuid,p_status text,p_method text,p_actor uuid,p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round FOR UPDATE;
 IF r.status NOT IN('pending_validation','pending_player_confirmation','draft') THEN RETURN; END IF;
 UPDATE personal_rounds SET status=p_status,validation_method=p_method,
 validated_at=CASE WHEN p_status='validated' THEN p_at END,disputed_at=CASE WHEN p_status='disputed' THEN p_at END,
 confirmed_at=CASE WHEN p_status='validated' THEN p_at END WHERE id=p_round;
 UPDATE personal_league_submissions s SET status=CASE
 WHEN p_status='disputed' THEN 'rejected'
 WHEN pr.format IN('stroke_gross','stroke_net') AND v.gross_total IS NULL THEN 'rejected'
 ELSE 'accepted' END,
 reason=CASE WHEN p_status='disputed' THEN 'card_disputed'
 WHEN pr.format IN('stroke_gross','stroke_net') AND v.gross_total IS NULL THEN 'picked_up_in_stroke' END,
 attester_id=r.validator_id,attested_at=p_at
 FROM personal_league_rules pr,personal_card_revisions v
 WHERE s.round_id=p_round AND s.status='pending' AND pr.game_id=s.game_id AND v.id=s.revision_id;
 INSERT INTO personal_card_events(round_id,action,actor_id,old_revision_id,new_revision_id,occurred_at,metadata)
 VALUES(p_round,p_status,p_actor,r.current_revision_id,r.current_revision_id,p_at,jsonb_build_object('method',p_method));
 PERFORM snapshot_personal_level(r.user_id);
 INSERT INTO notifications(user_id,type,title,body,data) VALUES(r.user_id,'personal_card',
 CASE WHEN p_status='validated' THEN 'Card validated' ELSE 'Card disputed' END,
 CASE WHEN p_status='validated' THEN 'Your locked card now counts towards your internal level and eligible leagues.' ELSE 'This card is permanently excluded from your level and all leagues.' END,
 jsonb_build_object('round_id',p_round));
END $$;
CREATE FUNCTION request_personal_validation(p_round uuid,p_expected_version int,p_validator uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; scores jsonb; rev uuid; stamp timestamptz;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 IF p_expected_version IS NULL OR r.draft_version<>p_expected_version THEN RAISE EXCEPTION 'Card changed. Reload before confirming.'; END IF;
 IF r.status<>'draft' THEN
  IF r.status IN('validated','pending_validation') AND r.validator_id IS NOT DISTINCT FROM p_validator THEN
   RETURN jsonb_build_object('revision_id',r.current_revision_id,'unchanged',true,'level',calculate_personal_level(r.user_id));
  END IF;
  RAISE EXCEPTION 'This submitted card is locked.';
 END IF;
 stamp:=clock_timestamp();
 IF stamp>=r.entry_deadline_at THEN RAISE EXCEPTION 'Entry deadline passed.'; END IF;
 IF p_validator IS NOT NULL AND NOT personal_validator_allowed(r.user_id,p_validator) THEN RAISE EXCEPTION 'Choose another player who shares a league with you.'; END IF;
 SELECT jsonb_agg(jsonb_build_object('hole_number',hole_number,'completion',completion,'strokes',strokes) ORDER BY hole_number) INTO scores FROM personal_round_holes WHERE round_id=p_round;
 IF scores IS NULL THEN RAISE EXCEPTION 'Complete or explicitly pick up every hole before confirming.'; END IF;
 rev:=personal_build_revision(p_round,scores,r.user_id,NULL);
 UPDATE personal_rounds SET current_revision_id=rev,submitted_at=stamp,validator_id=p_validator,
 status=CASE WHEN p_validator IS NULL THEN 'draft' ELSE 'pending_validation' END,
 validation_requested_at=CASE WHEN p_validator IS NOT NULL THEN stamp END,
 auto_validation_at=CASE WHEN p_validator IS NOT NULL THEN stamp+interval '72 hours' END WHERE id=p_round;
 INSERT INTO personal_card_events(round_id,action,actor_id,new_revision_id,occurred_at,metadata)
 VALUES(p_round,'submitted',r.user_id,rev,stamp,jsonb_build_object('validator_id',p_validator,'entry_deadline_at',r.entry_deadline_at));
 IF p_validator IS NULL THEN PERFORM personal_settle_card(p_round,'validated','self',r.user_id,stamp);
 ELSE INSERT INTO notifications(user_id,type,title,body,data) VALUES(p_validator,'personal_card','Card awaiting your validation',
 'Review the card or propose a correction within 72 hours.',jsonb_build_object('round_id',p_round)); END IF;
 RETURN jsonb_build_object('revision_id',rev,'level',calculate_personal_level(r.user_id));
END $$;
CREATE OR REPLACE FUNCTION confirm_personal_card(p_round uuid,p_expected_version int) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT request_personal_validation(p_round,p_expected_version,NULL) $$;
CREATE FUNCTION personal_expire_locked(p_round uuid,p_at timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round FOR UPDATE;
 IF r.status='pending_validation' AND r.timer_cancelled_at IS NULL AND r.auto_validation_at<=p_at THEN
  PERFORM personal_settle_card(p_round,'validated','automatic',NULL,p_at); RETURN true;
 END IF;
 RETURN false;
END $$;
CREATE FUNCTION review_personal_card(p_round uuid,p_revision uuid,p_scores jsonb DEFAULT NULL,p_reason text DEFAULT NULL,p_present boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; rev uuid; stamp timestamptz; s personal_league_submissions%ROWTYPE;
BEGIN
 -- All settlement paths use user advisory lock -> card row lock (including cron).
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND validator_id=auth.uid();
 IF r.id IS NULL THEN RAISE EXCEPTION 'Validation request not found.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.user_id::text,0));
 SELECT * INTO r FROM personal_rounds WHERE id=p_round FOR UPDATE;
 stamp:=clock_timestamp();
 IF personal_expire_locked(p_round,stamp) THEN RETURN jsonb_build_object('success',true,'automatic',true); END IF;
 IF r.status<>'pending_validation' OR r.current_revision_id IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'This revision is no longer awaiting your validation.'; END IF;
 IF NOT COALESCE(p_present,false) THEN RAISE EXCEPTION 'Confirm you were present for this round.'; END IF;
 IF p_scores IS NULL THEN
  PERFORM personal_settle_card(p_round,'validated','manual',auth.uid(),stamp);
 ELSE
  IF p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Explain the correction (3 to 500 characters).'; END IF;
  IF p_scores=(SELECT scores FROM personal_card_revisions WHERE id=r.current_revision_id) THEN RAISE EXCEPTION 'Change at least one hole to propose a correction.'; END IF;
  rev:=personal_build_revision(p_round,p_scores,auth.uid(),trim(p_reason));
  UPDATE personal_rounds SET status='pending_player_confirmation',current_revision_id=rev,corrected_at=stamp,timer_cancelled_at=stamp WHERE id=p_round;
  -- Keep each original, timely association and its immutable submitted timestamp.
  FOR s IN SELECT * FROM personal_league_submissions WHERE round_id=p_round AND status='pending' LOOP
   UPDATE personal_league_submissions SET status='superseded',reason='card_corrected' WHERE id=s.id;
   INSERT INTO personal_league_submissions(game_id,round_id,revision_id,user_id,status,submitted_at)
   VALUES(s.game_id,p_round,rev,r.user_id,'pending',s.submitted_at);
  END LOOP;
  INSERT INTO personal_card_events(round_id,action,actor_id,old_revision_id,new_revision_id,occurred_at,metadata)
  VALUES(p_round,'correction_proposed',auth.uid(),r.current_revision_id,rev,stamp,jsonb_build_object('reason',trim(p_reason)));
  INSERT INTO notifications(user_id,type,title,body,data) VALUES(r.user_id,'personal_card','Correction awaiting your decision',
  'Accept to validate the corrected card. Refusing permanently disputes the entire card.',jsonb_build_object('round_id',p_round));
 END IF;
 RETURN jsonb_build_object('success',true);
END $$;
CREATE FUNCTION resolve_personal_correction(p_round uuid,p_revision uuid,p_accept boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 IF r.status<>'pending_player_confirmation' OR r.current_revision_id IS DISTINCT FROM p_revision OR p_accept IS NULL THEN RAISE EXCEPTION 'This correction is no longer awaiting your decision.'; END IF;
 PERFORM personal_settle_card(p_round,CASE WHEN p_accept THEN 'validated' ELSE 'disputed' END,
 CASE WHEN p_accept THEN 'player_acceptance' END,auth.uid(),clock_timestamp());
 RETURN jsonb_build_object('success',true);
END $$;
CREATE FUNCTION auto_validate_personal_cards() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; n int:=0;
BEGIN
 -- Do not take row locks before user locks: manual reviews use the same order.
 FOR r IN SELECT id,user_id FROM personal_rounds WHERE status='pending_validation' AND timer_cancelled_at IS NULL AND auto_validation_at<=clock_timestamp() ORDER BY user_id,id LIMIT 500 LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(r.user_id::text,0)) THEN CONTINUE; END IF;
  IF personal_expire_locked(r.id,clock_timestamp()) THEN n:=n+1; END IF;
 END LOOP;
 RETURN n;
END $$;
SELECT cron.schedule('mulligan_personal_card_validation','* * * * *','SELECT public.auto_validate_personal_cards();');
CREATE OR REPLACE FUNCTION public.personal_submission_reason(p_round uuid,p_game uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; rules personal_league_rules%ROWTYPE; g games%ROWTYPE; rev personal_card_revisions%ROWTYPE;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid();
 IF r.id IS NULL THEN RETURN 'round_not_found'; END IF;
 IF NOT is_game_member(p_game,auth.uid()) THEN RETURN 'not_member'; END IF;
 SELECT * INTO rules FROM personal_league_rules WHERE game_id=p_game;
 IF rules.game_id IS NULL THEN RETURN 'league_not_configured'; END IF;
 SELECT * INTO g FROM games WHERE id=p_game;
 IF g.status NOT IN('active','pending') THEN RETURN 'league_closed'; END IF;
 IF r.status='disputed' THEN RETURN 'card_disputed'; END IF;
 IF r.status NOT IN('validated','pending_validation','pending_player_confirmation') THEN RETURN 'unconfirmed_card'; END IF;
 IF r.tee_id<>rules.tee_id THEN RETURN 'wrong_layout_or_tee'; END IF;
 IF r.played_on<g.start_date OR r.played_on>g.end_date THEN RETURN 'outside_league_dates'; END IF;
 IF clock_timestamp()>=least(r.entry_deadline_at,(g.end_date+1)::timestamp AT TIME ZONE r.course_timezone) THEN RETURN 'submission_deadline'; END IF;
 IF rules.attestation='peer_required' AND r.validator_id IS NULL THEN RETURN 'validator_required'; END IF;
 SELECT * INTO rev FROM personal_card_revisions WHERE id=r.current_revision_id;
 IF rules.format IN('stroke_gross','stroke_net') AND rev.gross_total IS NULL THEN RETURN 'picked_up_in_stroke'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.submit_personal_card(p_round uuid,p_game uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; reason text; rules personal_league_rules%ROWTYPE; s uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 SELECT * INTO rules FROM personal_league_rules WHERE game_id=p_game FOR UPDATE;
 SELECT id INTO s FROM personal_league_submissions WHERE game_id=p_game AND revision_id=r.current_revision_id AND status IN('pending','accepted');
 IF s IS NOT NULL THEN RETURN jsonb_build_object('success',true,'submission_id',s); END IF;
 reason:=personal_submission_reason(p_round,p_game);
 IF reason IS NOT NULL THEN RETURN jsonb_build_object('success',false,'reason',reason); END IF;
 INSERT INTO personal_league_submissions(game_id,round_id,revision_id,user_id,status)
 VALUES(p_game,p_round,r.current_revision_id,auth.uid(),CASE WHEN r.status='validated' THEN 'accepted' ELSE 'pending' END)
 ON CONFLICT(game_id,revision_id) DO NOTHING RETURNING id INTO s;
 IF s IS NULL THEN SELECT id INTO s FROM personal_league_submissions WHERE game_id=p_game AND revision_id=r.current_revision_id; END IF;
 RETURN jsonb_build_object('success',true,'submission_id',s);
END $$;
CREATE OR REPLACE FUNCTION attest_personal_card(p_submission uuid,p_approve boolean,p_present boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s personal_league_submissions%ROWTYPE;
BEGIN
 SELECT * INTO s FROM personal_league_submissions WHERE id=p_submission;
 IF s.id IS NULL OR NOT is_game_member(s.game_id,auth.uid()) THEN RAISE EXCEPTION 'Submission not found.'; END IF;
 IF NOT COALESCE(p_approve,false) THEN RAISE EXCEPTION 'Use the card review to propose a correction.'; END IF;
 RETURN review_personal_card(s.round_id,s.revision_id,NULL,NULL,p_present);
END $$;
CREATE OR REPLACE FUNCTION public.personal_leaderboard(p_game uuid)
RETURNS TABLE("position" bigint,user_id uuid,player_name text,avatar_url text,best_score bigint,total_score bigint,rounds_counted bigint,rounds_played bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH config AS (
 SELECT pr.format,COALESCE(g.scoring_cards_count,1) AS n FROM personal_league_rules pr JOIN games g ON g.id=pr.game_id
 WHERE pr.game_id=p_game AND (is_game_member(p_game,auth.uid()) OR COALESCE(auth.jwt()->>'role','')='service_role')
 ), eligible AS (
 SELECT s.user_id,s.id,r.played_on,CASE c.format WHEN 'stroke_gross' THEN v.gross_total WHEN 'stroke_net' THEN v.net_total ELSE v.stableford_points END AS value
 FROM personal_league_submissions s JOIN personal_rounds r ON r.id=s.round_id AND r.current_revision_id=s.revision_id
 JOIN personal_card_revisions v ON v.id=s.revision_id CROSS JOIN config c
 WHERE s.game_id=p_game AND s.status='accepted' AND r.status='validated'
 ), ranked AS (
 SELECT *,row_number() OVER(PARTITION BY user_id ORDER BY CASE WHEN(SELECT format FROM config)='stableford_net' THEN -value ELSE value END,played_on,id) AS rn,
 count(*) OVER(PARTITION BY user_id) AS played FROM eligible
 ), totals AS (
 SELECT user_id,sum(value)::bigint AS total,count(*) AS counted,max(played) AS played,
 CASE WHEN(SELECT format FROM config)='stableford_net' THEN max(value) ELSE min(value) END::bigint AS best
 FROM ranked WHERE rn<=(SELECT n FROM config) GROUP BY user_id
 ), board AS (
 SELECT gm.user_id,COALESCE(t.counted,0) AS counted,COALESCE(t.total,0) AS total,t.best,COALESCE(t.played,0) AS played
 FROM game_members gm LEFT JOIN totals t ON t.user_id=gm.user_id CROSS JOIN config WHERE gm.game_id=p_game
 ) SELECT CASE WHEN b.counted>=(SELECT n FROM config) THEN rank() OVER(ORDER BY
 CASE WHEN b.counted>=(SELECT n FROM config) THEN 0 ELSE 1 END,
 CASE WHEN(SELECT format FROM config)='stableford_net' THEN -b.total ELSE b.total END)::bigint END,
 b.user_id,COALESCE(p.username,p.first_name,'Player'),p.avatar_url,b.best,b.total,b.counted,b.played
 FROM board b JOIN profiles p ON p.id=b.user_id ORDER BY
 CASE WHEN b.counted>=(SELECT n FROM config) THEN 0 ELSE 1 END,
 CASE WHEN(SELECT format FROM config)='stableford_net' THEN -b.total ELSE b.total END,b.user_id
$$;
CREATE OR REPLACE FUNCTION public.get_personal_card(p_round uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND (user_id=auth.uid() OR validator_id=auth.uid());
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 RETURN jsonb_build_object('server_now',clock_timestamp(),'round',to_jsonb(r),'is_owner',r.user_id=auth.uid(),
 'revisions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY revision_number) FROM personal_card_revisions v WHERE round_id=p_round),
 'events',COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY occurred_at,id) FROM personal_card_events e WHERE round_id=p_round),'[]'::jsonb),
 'validators',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',COALESCE(p.username,p.first_name,'Player')) ORDER BY p.username) FROM profiles p WHERE r.user_id=auth.uid() AND personal_validator_allowed(r.user_id,p.id)),'[]'::jsonb),
 'tee',(SELECT to_jsonb(t)||jsonb_build_object('course_name',c.name,'layout_name',l.name,'hole_count',l.hole_count,'ready',personal_reference_ready(t.id))
   FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE t.id=r.tee_id),
 'reference_holes',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.hole_number) FROM personal_tee_holes h WHERE tee_id=r.tee_id),
 'holes',COALESCE((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.hole_number) FROM personal_round_holes h WHERE round_id=p_round),'[]'::jsonb),
 'revision',(SELECT to_jsonb(v) FROM personal_card_revisions v WHERE id=r.current_revision_id),
 'level',calculate_personal_level(auth.uid()),
 'leagues',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'reason',personal_submission_reason(p_round,g.id),
   'attestation',rules.attestation,'format',rules.format,'submission_status',s.status,'submission_id',s.id)
   ORDER BY g.name) FROM game_members gm JOIN games g ON g.id=gm.game_id
   LEFT JOIN personal_league_rules rules ON rules.game_id=g.id
   LEFT JOIN personal_league_submissions s ON s.game_id=g.id AND s.revision_id=r.current_revision_id
   WHERE gm.user_id=r.user_id AND r.user_id=auth.uid() AND NOT g.is_practice),'[]'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION public.get_personal_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 RETURN jsonb_build_object(
 'level',calculate_personal_level(auth.uid()),
 'inbox',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'played_on',r.played_on,'status',r.status,'auto_validation_at',r.auto_validation_at,'player_name',COALESCE(p.username,p.first_name),'course_name',c.name) ORDER BY r.submitted_at) FROM personal_rounds r JOIN profiles p ON p.id=r.user_id JOIN personal_tees t ON t.id=r.tee_id JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE (r.validator_id=auth.uid() AND r.status='pending_validation') OR (r.user_id=auth.uid() AND r.status='pending_player_confirmation')),'[]'::jsonb),
 'official_index',(SELECT index_value FROM official_index_declarations WHERE user_id=auth.uid()
                  ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1),
 'history',COALESCE((SELECT jsonb_agg(x ORDER BY x.calculated_at DESC) FROM(SELECT level_value,status,cards_count,calculated_at
   FROM personal_level_snapshots WHERE user_id=auth.uid() ORDER BY calculated_at DESC LIMIT 20)x),'[]'::jsonb),
 'tees',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'layout_id',l.id,'layout_name',l.name,
   'course_name',c.name,'course_id',c.id,'hole_count',l.hole_count,'course_rating',t.course_rating,
   'slope_rating',t.slope_rating,'ready',personal_reference_ready(t.id)) ORDER BY c.name,l.hole_count,t.name)
   FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id),'[]'::jsonb),
 'rounds',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'played_on',r.played_on,'status',r.status,
   'course_name',c.name,'tee_name',t.name,'hole_count',l.hole_count,'revision_number',v.revision_number,
   'gross_total',v.gross_total,'net_total',v.net_total,'stableford_points',v.stableford_points,'differential',v.differential)
   ORDER BY r.played_on DESC,r.created_at DESC) FROM personal_rounds r JOIN personal_tees t ON t.id=r.tee_id
   JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id
   LEFT JOIN personal_card_revisions v ON v.id=r.current_revision_id WHERE r.user_id=auth.uid()),'[]'::jsonb));
END $$;
CREATE OR REPLACE FUNCTION public.get_personal_league(p_game uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_game_member(p_game,auth.uid()) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM personal_league_rules WHERE game_id=p_game) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('closure_status',(SELECT CASE WHEN clock_timestamp()<(g.end_date+1)::timestamp AT TIME ZONE c.timezone THEN 'open' WHEN EXISTS(SELECT 1 FROM personal_league_submissions s WHERE s.game_id=p_game AND s.status='pending') THEN 'closed_provisional' ELSE 'finalized' END FROM games g JOIN personal_league_rules pr ON pr.game_id=g.id JOIN personal_tees t ON t.id=pr.tee_id JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE g.id=p_game),
 'rules',(SELECT to_jsonb(r) FROM personal_league_rules r WHERE game_id=p_game),
 'game',(SELECT jsonb_build_object('id',id,'name',name,'start_date',start_date,'end_date',end_date,'invite_code',invite_code,
   'scoring_cards_count',scoring_cards_count,'status',status) FROM games WHERE id=p_game),
 'tee',(SELECT jsonb_build_object('name',t.name,'course_name',c.name,'hole_count',l.hole_count) FROM personal_league_rules pr
 JOIN personal_tees t ON t.id=pr.tee_id JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE pr.game_id=p_game),
 'board',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM personal_leaderboard(p_game)b),'[]'::jsonb),
 'submissions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'round_id',s.round_id,'user_id',s.user_id,
 'card_status',r.status,'validator_id',r.validator_id,'auto_validation_at',r.auto_validation_at,'player_name',COALESCE(p.username,p.first_name),'played_on',r.played_on,'status',s.status,'reason',s.reason,
 'revision_number',v.revision_number,'gross_total',v.gross_total,'net_total',v.net_total,'stableford_points',v.stableford_points,
 'scores',v.scores) ORDER BY s.submitted_at DESC) FROM personal_league_submissions s JOIN profiles p ON p.id=s.user_id
 JOIN personal_rounds r ON r.id=s.round_id JOIN personal_card_revisions v ON v.id=s.revision_id WHERE s.game_id=p_game),'[]'::jsonb));
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY['personal_timezone_valid','personal_entry_deadline','personal_terminal_card_guard','calculate_personal_level','create_personal_round','save_personal_card','personal_build_revision','personal_validator_allowed','personal_settle_card','request_personal_validation','confirm_personal_card','personal_expire_locked','review_personal_card','resolve_personal_correction','auto_validate_personal_cards','personal_submission_reason','submit_personal_card','attest_personal_card','personal_leaderboard','get_personal_card','get_personal_overview','get_personal_league']) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION create_personal_round(uuid,date),save_personal_card(uuid,jsonb,int),confirm_personal_card(uuid,int),
 request_personal_validation(uuid,int,uuid),review_personal_card(uuid,uuid,jsonb,text,boolean),resolve_personal_correction(uuid,uuid,boolean),
 submit_personal_card(uuid,uuid),attest_personal_card(uuid,boolean,boolean),get_personal_card(uuid),get_personal_overview(),get_personal_league(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
