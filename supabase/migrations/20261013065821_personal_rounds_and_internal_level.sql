-- Personal cards are independent of legacy matches. One immutable revision
-- contributes once to the internal level and may be submitted to many games.
-- Existing matches, practice containers and Elo history remain intact.
CREATE TABLE public.personal_layouts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid NOT NULL REFERENCES courses(id),
 name text NOT NULL, hole_count smallint NOT NULL CHECK(hole_count IN(9,18)),
 UNIQUE(course_id,name,hole_count)
);
CREATE TABLE public.personal_tees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), layout_id uuid NOT NULL REFERENCES personal_layouts(id),
 name text NOT NULL, course_rating numeric(4,1), slope_rating smallint CHECK(slope_rating BETWEEN 55 AND 155),
 version int NOT NULL DEFAULT 1 CHECK(version>0), verified boolean NOT NULL DEFAULT false,
 source text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT verified OR (course_rating IS NOT NULL AND course_rating>0 AND slope_rating IS NOT NULL AND source IS NOT NULL AND length(source)>0)),
 UNIQUE(layout_id,name,version)
);
CREATE TABLE public.personal_tee_holes (
 tee_id uuid NOT NULL REFERENCES personal_tees(id), hole_number smallint NOT NULL CHECK(hole_number BETWEEN 1 AND 18),
 par smallint NOT NULL CHECK(par BETWEEN 3 AND 6), stroke_index smallint CHECK(stroke_index BETWEEN 1 AND 18),
 PRIMARY KEY(tee_id,hole_number), UNIQUE(tee_id,stroke_index)
);
-- Import the existing references as UNVERIFIED. Ratings and missing stroke
-- indexes must be checked by the catalogue administrator, never invented.
INSERT INTO personal_layouts(course_id,name,hole_count)
SELECT course_id,'Reference card',count(*) FROM course_holes GROUP BY course_id HAVING count(*) IN(9,18) AND min(hole_number)=1 AND max(hole_number)=count(*);
INSERT INTO personal_tees(layout_id,name)
SELECT id,'Reference tee — rating pending' FROM personal_layouts;
INSERT INTO personal_tee_holes(tee_id,hole_number,par,stroke_index)
SELECT t.id,h.hole_number,h.par,
 CASE WHEN valid.valid_indices THEN dense_rank() OVER(PARTITION BY t.id ORDER BY h.hcp_index)::smallint END
FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN course_holes h ON h.course_id=l.course_id
JOIN(SELECT course_id,count(hcp_index)=count(*) AND count(DISTINCT hcp_index)=count(*) AS valid_indices
 FROM course_holes GROUP BY course_id) valid ON valid.course_id=l.course_id;

CREATE TABLE public.official_index_declarations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
 index_value numeric(4,1) NOT NULL CHECK(index_value BETWEEN -10 AND 54),
 effective_on date NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON official_index_declarations(user_id,effective_on DESC,recorded_at DESC);
-- No historical effective dates are inferred from the current profile field.
INSERT INTO official_index_declarations(user_id,index_value,effective_on)
SELECT id,handicap,current_date FROM profiles WHERE handicap BETWEEN -10 AND 54;

CREATE TABLE public.personal_rounds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
 tee_id uuid NOT NULL REFERENCES personal_tees(id), played_on date NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','confirmed','void')),
 handicap_source text NOT NULL CHECK(handicap_source IN('internal','declared_official','default_54')),
 handicap_index numeric(5,1) NOT NULL, draft_version int NOT NULL DEFAULT 0,
 current_revision_id uuid, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz,
 CHECK(played_on <= (created_at AT TIME ZONE 'Europe/Paris')::date)
);
CREATE INDEX ON personal_rounds(user_id,played_on DESC,created_at DESC);
CREATE TABLE public.personal_round_holes (
 round_id uuid NOT NULL REFERENCES personal_rounds(id), hole_number smallint NOT NULL CHECK(hole_number BETWEEN 1 AND 18),
 completion text NOT NULL CHECK(completion IN('completed','picked_up','not_played')),
 strokes smallint CHECK(strokes BETWEEN 1 AND 30), PRIMARY KEY(round_id,hole_number),
 CHECK((completion='completed' AND strokes IS NOT NULL) OR (completion<>'completed' AND strokes IS NULL))
);
CREATE TABLE public.personal_card_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), round_id uuid NOT NULL REFERENCES personal_rounds(id),
 revision_number int NOT NULL CHECK(revision_number>0), scores jsonb NOT NULL, tee_snapshot jsonb NOT NULL,
 playing_handicap int NOT NULL, gross_total int, net_total int, stableford_points int NOT NULL,
 adjusted_gross int NOT NULL, differential numeric(6,1) NOT NULL,
 engine_version text NOT NULL DEFAULT 'personal-v1', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(round_id,revision_number), UNIQUE(id,round_id)
);
ALTER TABLE personal_rounds ADD CONSTRAINT personal_round_revision_fk
 FOREIGN KEY(current_revision_id,id) REFERENCES personal_card_revisions(id,round_id);
CREATE TABLE public.personal_level_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
 level_value numeric(5,1), status text NOT NULL CHECK(status IN('unavailable','provisional','established')),
 cards_count int NOT NULL, cards_used int NOT NULL, revision_ids uuid[] NOT NULL,
 engine_version text NOT NULL DEFAULT 'personal-v1', calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON personal_level_snapshots(user_id,calculated_at DESC);
CREATE TABLE public.personal_league_rules (
 game_id uuid PRIMARY KEY REFERENCES games(id), tee_id uuid NOT NULL REFERENCES personal_tees(id),
 format text NOT NULL CHECK(format IN('stroke_gross','stroke_net','stableford_net')),
 attestation text NOT NULL DEFAULT 'self_declared' CHECK(attestation IN('self_declared','peer_required')),
 submission_deadline_days int NOT NULL DEFAULT 7 CHECK(submission_deadline_days BETWEEN 0 AND 365),
 version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.personal_league_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id uuid NOT NULL REFERENCES personal_league_rules(game_id),
 round_id uuid NOT NULL REFERENCES personal_rounds(id), revision_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES profiles(id),
 status text NOT NULL CHECK(status IN('pending','accepted','superseded','rejected')),
 reason text, submitted_at timestamptz NOT NULL DEFAULT now(),
 attester_id uuid REFERENCES profiles(id), attested_at timestamptz,
 FOREIGN KEY(revision_id,round_id) REFERENCES personal_card_revisions(id,round_id),
 UNIQUE(game_id,revision_id), CHECK(attester_id IS NULL OR attester_id<>user_id)
);
CREATE UNIQUE INDEX ON personal_league_submissions(game_id,round_id) WHERE status IN('pending','accepted');
CREATE INDEX ON personal_league_submissions(game_id,status,user_id);

-- No browser writes: all state changes are validated by the RPCs below.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['personal_layouts','personal_tees','personal_tee_holes','official_index_declarations',
 'personal_rounds','personal_round_holes','personal_card_revisions','personal_level_snapshots',
 'personal_league_rules','personal_league_submissions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
-- Guard immutable historical data even against accidental privileged updates.
CREATE FUNCTION public.personal_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Published reference data and card revisions are immutable; create a new version.'; END $$;
CREATE TRIGGER personal_revision_immutable BEFORE UPDATE OR DELETE ON personal_card_revisions
 FOR EACH ROW EXECUTE FUNCTION personal_immutable();
CREATE TRIGGER personal_layout_immutable BEFORE UPDATE OR DELETE ON personal_layouts
 FOR EACH ROW EXECUTE FUNCTION personal_immutable();
CREATE TRIGGER personal_tee_immutable BEFORE UPDATE OR DELETE ON personal_tees
 FOR EACH ROW WHEN(OLD.verified) EXECUTE FUNCTION personal_immutable();
CREATE FUNCTION public.personal_hole_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM personal_tees WHERE id IN(OLD.tee_id,NEW.tee_id) AND verified) THEN
  RAISE EXCEPTION 'Verified tee holes are immutable; publish a new tee version.';
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER personal_hole_immutable BEFORE INSERT OR UPDATE OR DELETE ON personal_tee_holes
 FOR EACH ROW EXECUTE FUNCTION personal_hole_immutable();
CREATE FUNCTION public.personal_reference_ready(p_tee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE((SELECT t.verified AND t.course_rating IS NOT NULL AND t.slope_rating IS NOT NULL
 AND (SELECT count(*) FROM personal_tee_holes h WHERE h.tee_id=t.id)=l.hole_count
 AND NOT EXISTS(SELECT 1 FROM personal_tee_holes h WHERE h.tee_id=t.id
                AND (h.hole_number>l.hole_count OR h.stroke_index IS NULL OR h.stroke_index>l.hole_count))
 FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id WHERE t.id=p_tee),false)
$$;
-- Service-only catalogue import. Each publication creates a new version,
-- including its full hole set, in one transaction. Never exposes service keys.
CREATE FUNCTION public.publish_personal_tee(p_course uuid,p_layout text,p_name text,p_rating numeric,p_slope int,p_source text,p_holes jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE l uuid; t uuid; n int; v int;
BEGIN
 n:=jsonb_array_length(p_holes);
 IF n NOT IN(9,18) THEN RAISE EXCEPTION 'A complete 9/18-hole reference is required.'; END IF;
 INSERT INTO personal_layouts(course_id,name,hole_count) VALUES(p_course,p_layout,n)
 ON CONFLICT(course_id,name,hole_count) DO NOTHING;
 SELECT id INTO l FROM personal_layouts WHERE course_id=p_course AND name=p_layout AND hole_count=n FOR UPDATE;
 SELECT COALESCE(max(version),0)+1 INTO v FROM personal_tees WHERE layout_id=l AND name=p_name;
 INSERT INTO personal_tees(layout_id,name,course_rating,slope_rating,source,version)
 VALUES(l,p_name,p_rating,p_slope,p_source,v) RETURNING id INTO t;
 INSERT INTO personal_tee_holes(tee_id,hole_number,par,stroke_index)
 SELECT t,(h->>'hole_number')::int,(h->>'par')::int,(h->>'stroke_index')::int FROM jsonb_array_elements(p_holes) h;
 UPDATE personal_tees SET verified=true WHERE id=t;
 IF NOT personal_reference_ready(t) THEN RAISE EXCEPTION 'Incomplete or invalid reference data.'; END IF;
 RETURN t;
END $$;

-- Progressive fewer-card schedule, followed by the best 8 of the last 20.
-- This is an internal estimate, not an official WHS index.
CREATE FUNCTION public.calculate_personal_level(p_user uuid,p_as_of date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH recent AS (
  SELECT c.id,c.differential FROM personal_rounds r JOIN personal_card_revisions c ON c.id=r.current_revision_id
  WHERE r.user_id=p_user AND r.status='confirmed' AND (p_as_of IS NULL OR r.played_on<=p_as_of)
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
CREATE FUNCTION public.snapshot_personal_level(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE level jsonb;
BEGIN
 level:=calculate_personal_level(p_user);
 INSERT INTO personal_level_snapshots(user_id,level_value,status,cards_count,cards_used,revision_ids)
 VALUES(p_user,(level->>'value')::numeric,level->>'status',(level->>'cards_count')::int,(level->>'cards_used')::int,
 ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(level->'revision_ids')));
 RETURN level;
END $$;
CREATE FUNCTION public.declare_personal_index(p_index numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF p_index IS NULL OR p_index NOT BETWEEN -10 AND 54 THEN RAISE EXCEPTION 'Index must be between -10 and 54.'; END IF;
 INSERT INTO official_index_declarations(user_id,index_value,effective_on)
 VALUES(auth.uid(),round(p_index,1),(now() AT TIME ZONE 'Europe/Paris')::date);
 RETURN jsonb_build_object('success',true);
END $$;
CREATE FUNCTION public.create_personal_round(p_tee uuid,p_played_on date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE level jsonb; idx numeric; source text; r uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF p_played_on IS NULL OR p_played_on>(now() AT TIME ZONE 'Europe/Paris')::date THEN RAISE EXCEPTION 'Invalid play date.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM personal_tees WHERE id=p_tee) THEN RAISE EXCEPTION 'Unknown tee.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 level:=calculate_personal_level(auth.uid(),p_played_on);
 IF level->>'status'='established' THEN idx:=(level->>'value')::numeric; source:='internal';
 ELSE
  SELECT index_value INTO idx FROM official_index_declarations WHERE user_id=auth.uid() AND effective_on<=p_played_on
  ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1;
  source:=CASE WHEN idx IS NULL THEN 'default_54' ELSE 'declared_official' END; idx:=COALESCE(idx,54);
 END IF;
 INSERT INTO personal_rounds(user_id,tee_id,played_on,handicap_source,handicap_index)
 VALUES(auth.uid(),p_tee,p_played_on,source,idx) RETURNING id INTO r;
 RETURN jsonb_build_object('id',r);
END $$;
CREATE FUNCTION public.save_personal_card(p_round uuid,p_holes jsonb,p_expected_version int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; n int;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 IF p_expected_version IS NULL OR r.draft_version<>p_expected_version THEN RAISE EXCEPTION 'This card changed elsewhere. Reload before saving.'; END IF;
 IF r.status='void' THEN RAISE EXCEPTION 'Round is closed.'; END IF;
 IF p_holes IS NULL OR jsonb_typeof(p_holes)<>'array' OR jsonb_array_length(p_holes)>18 THEN RAISE EXCEPTION 'Invalid hole data.'; END IF;
 SELECT l.hole_count INTO n FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id WHERE t.id=r.tee_id;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_holes) h WHERE (h->>'hole_number')::int NOT BETWEEN 1 AND n) THEN
  RAISE EXCEPTION 'Hole is outside this layout.';
 END IF;
 DELETE FROM personal_round_holes WHERE round_id=p_round;
 INSERT INTO personal_round_holes(round_id,hole_number,completion,strokes)
 SELECT p_round,(h->>'hole_number')::int,h->>'completion',(h->>'strokes')::int FROM jsonb_array_elements(p_holes) h;
 -- A confirmed revision stays current while the owner edits a new draft.
 -- Submissions remain pinned to that immutable revision until confirmation.
 UPDATE personal_rounds SET draft_version=draft_version+1 WHERE id=p_round;
 RETURN jsonb_build_object('draft_version',r.draft_version+1);
END $$;
CREATE FUNCTION public.personal_strokes(p_handicap int,p_index int,p_count int) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN p_handicap>=0 THEN p_handicap/p_count+CASE WHEN p_index<=p_handicap%p_count THEN 1 ELSE 0 END
 ELSE -((-p_handicap)/p_count+CASE WHEN p_index>p_count-((-p_handicap)%p_count) THEN 1 ELSE 0 END) END
$$;
CREATE FUNCTION public.confirm_personal_card(p_round uuid,p_expected_version int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; t record; h record; php int; received int; adjusted int:=0;
 gross int:=0; stableford int:=0; valid_stroke boolean:=true; diff numeric; rev uuid; scores_json jsonb;
 tee_json jsonb; previous personal_card_revisions%ROWTYPE; level jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 IF p_expected_version IS NULL OR r.status='void' OR r.draft_version<>p_expected_version THEN RAISE EXCEPTION 'Card changed. Reload before confirming.'; END IF;
 IF NOT personal_reference_ready(r.tee_id) THEN RAISE EXCEPTION 'This tee needs verified rating, slope and hole data before confirmation.'; END IF;
 SELECT pt.*,l.hole_count,l.course_id,l.name AS layout_name,c.name AS course_name,sum(th.par)::int AS par_total
 INTO t FROM personal_tees pt JOIN personal_layouts l ON l.id=pt.layout_id JOIN courses c ON c.id=l.course_id
 JOIN personal_tee_holes th ON th.tee_id=pt.id WHERE pt.id=r.tee_id GROUP BY pt.id,l.id,c.id;
 IF (SELECT count(*) FROM personal_round_holes WHERE round_id=p_round AND completion<>'not_played')<>t.hole_count THEN
  RAISE EXCEPTION 'Complete or explicitly pick up every hole before confirming.';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('hole_number',sh.hole_number,'completion',sh.completion,'strokes',sh.strokes) ORDER BY sh.hole_number)
 INTO scores_json FROM personal_round_holes sh WHERE sh.round_id=p_round;
 SELECT * INTO previous FROM personal_card_revisions WHERE id=r.current_revision_id;
 IF previous.id IS NOT NULL AND previous.scores=scores_json THEN
  RETURN jsonb_build_object('revision_id',previous.id,'level',calculate_personal_level(auth.uid()),'unchanged',true);
 END IF;
 php:=round((CASE WHEN t.hole_count=9 THEN round(r.handicap_index/2,1) ELSE r.handicap_index END)
       *t.slope_rating/113+t.course_rating-t.par_total)::int;
 FOR h IN SELECT sh.*,th.par,th.stroke_index FROM personal_round_holes sh JOIN personal_tee_holes th
 ON th.tee_id=r.tee_id AND th.hole_number=sh.hole_number WHERE sh.round_id=p_round LOOP
  received:=personal_strokes(php,h.stroke_index,t.hole_count);
  adjusted:=adjusted+CASE WHEN h.completion='picked_up' THEN greatest(1,h.par+2+received)
                         ELSE least(h.strokes,greatest(1,h.par+2+received)) END;
  IF h.completion='picked_up' THEN valid_stroke:=false;
  ELSE gross:=gross+h.strokes; stableford:=stableford+greatest(0,2+h.par+received-h.strokes); END IF;
 END LOOP;
 diff:=round((113.0/t.slope_rating)*(adjusted-t.course_rating)*CASE WHEN t.hole_count=9 THEN 2 ELSE 1 END,1);
 tee_json:=to_jsonb(t)||jsonb_build_object('holes',(SELECT jsonb_agg(to_jsonb(th) ORDER BY hole_number) FROM personal_tee_holes th WHERE tee_id=r.tee_id));
 INSERT INTO personal_card_revisions(round_id,revision_number,scores,tee_snapshot,playing_handicap,gross_total,net_total,stableford_points,adjusted_gross,differential)
 VALUES(p_round,COALESCE(previous.revision_number,0)+1,scores_json,tee_json,php,
 CASE WHEN valid_stroke THEN gross END,CASE WHEN valid_stroke THEN gross-php END,stableford,adjusted,diff) RETURNING id INTO rev;
 UPDATE personal_rounds SET status='confirmed',current_revision_id=rev,confirmed_at=now() WHERE id=p_round;
 UPDATE personal_league_submissions SET status='superseded',reason='card_corrected'
 WHERE round_id=p_round AND status IN('pending','accepted');
 level:=snapshot_personal_level(auth.uid());
 RETURN jsonb_build_object('revision_id',rev,'level',level);
END $$;

CREATE FUNCTION public.create_personal_league(p_name text,p_tee uuid,p_start date,p_end date,p_format text,p_cards int DEFAULT 1,p_attestation text DEFAULT 'self_declared')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t record; result json; g uuid; fmt text; basis text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF NOT personal_reference_ready(p_tee) THEN RAISE EXCEPTION 'Choose a verified tee.'; END IF;
 IF p_name IS NULL OR p_cards IS NULL OR p_format IS NULL OR p_attestation IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 80 OR p_start IS NULL OR p_end IS NULL OR p_end<=p_start
 OR p_cards NOT BETWEEN 1 AND 20 OR p_format NOT IN('stroke_gross','stroke_net','stableford_net')
 OR p_attestation NOT IN('self_declared','peer_required') THEN RAISE EXCEPTION 'Invalid league rules.'; END IF;
 SELECT c.id,c.name INTO t FROM personal_tees pt JOIN personal_layouts l ON l.id=pt.layout_id JOIN courses c ON c.id=l.course_id WHERE pt.id=p_tee;
 fmt:='stroke_play'; basis:=CASE p_format WHEN 'stroke_gross' THEN 'gross' WHEN 'stroke_net' THEN 'net' ELSE 'stableford_net' END;
 result:=create_game(p_name,t.name,10,p_start,p_end,p_cards,NULL,fmt,t.id,basis,false);
 IF NOT COALESCE((result->>'success')::boolean,false) THEN RAISE EXCEPTION '%',result->>'error'; END IF;
 g:=(result->>'game_id')::uuid;
 INSERT INTO personal_league_rules(game_id,tee_id,format,attestation) VALUES(g,p_tee,p_format,p_attestation);
 UPDATE games SET status=CASE WHEN p_start<=(now() AT TIME ZONE 'Europe/Paris')::date THEN 'active' ELSE 'pending' END WHERE id=g;
 RETURN result::jsonb;
END $$;
CREATE FUNCTION public.personal_submission_reason(p_round uuid,p_game uuid) RETURNS text
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
 IF r.status<>'confirmed' THEN RETURN 'unconfirmed_card'; END IF;
 IF r.tee_id<>rules.tee_id THEN RETURN 'wrong_layout_or_tee'; END IF;
 IF r.played_on<g.start_date OR r.played_on>g.end_date THEN RETURN 'outside_league_dates'; END IF;
 IF (now() AT TIME ZONE 'Europe/Paris')::date>g.end_date+rules.submission_deadline_days THEN RETURN 'submission_deadline'; END IF;
 SELECT * INTO rev FROM personal_card_revisions WHERE id=r.current_revision_id;
 IF rules.format IN('stroke_gross','stroke_net') AND rev.gross_total IS NULL THEN RETURN 'picked_up_in_stroke'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION public.submit_personal_card(p_round uuid,p_game uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; reason text; rules personal_league_rules%ROWTYPE; s uuid;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 SELECT * INTO rules FROM personal_league_rules WHERE game_id=p_game FOR UPDATE;
 reason:=personal_submission_reason(p_round,p_game);
 IF reason IS NOT NULL THEN RETURN jsonb_build_object('success',false,'reason',reason); END IF;
 INSERT INTO personal_league_submissions(game_id,round_id,revision_id,user_id,status)
 VALUES(p_game,p_round,r.current_revision_id,auth.uid(),CASE rules.attestation WHEN 'peer_required' THEN 'pending' ELSE 'accepted' END)
 ON CONFLICT(game_id,revision_id) DO NOTHING RETURNING id INTO s;
 IF s IS NULL THEN SELECT id INTO s FROM personal_league_submissions WHERE game_id=p_game AND revision_id=r.current_revision_id; END IF;
 RETURN jsonb_build_object('success',true,'submission_id',s);
END $$;
CREATE FUNCTION public.attest_personal_card(p_submission uuid,p_approve boolean,p_present boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s personal_league_submissions%ROWTYPE;
BEGIN
 SELECT * INTO s FROM personal_league_submissions WHERE id=p_submission;
 IF s.id IS NULL OR NOT is_game_member(s.game_id,auth.uid()) THEN RAISE EXCEPTION 'Submission not found.'; END IF;
 PERFORM 1 FROM personal_rounds WHERE id=s.round_id FOR UPDATE;
 SELECT * INTO s FROM personal_league_submissions WHERE id=p_submission FOR UPDATE;
 IF s.id IS NULL OR NOT is_game_member(s.game_id,auth.uid()) THEN RAISE EXCEPTION 'Submission not found.'; END IF;
 IF s.user_id=auth.uid() THEN RAISE EXCEPTION 'You cannot attest your own card.'; END IF;
 IF s.status<>'pending' OR s.revision_id IS DISTINCT FROM(SELECT current_revision_id FROM personal_rounds WHERE id=s.round_id) THEN
  RAISE EXCEPTION 'This revision is no longer awaiting attestation.';
 END IF;
 IF NOT COALESCE(p_present,false) OR p_approve IS NULL THEN RAISE EXCEPTION 'Confirm you were present for this round.'; END IF;
 UPDATE personal_league_submissions SET status=CASE WHEN p_approve THEN 'accepted' ELSE 'rejected' END,
 attester_id=auth.uid(),attested_at=now(),reason=CASE WHEN NOT p_approve THEN 'witness_rejected' END WHERE id=s.id;
 RETURN jsonb_build_object('success',true);
END $$;
-- Best N sum for this milestone. Primary format reuses the existing league
-- settings. Secondary standings / other aggregations are a later milestone.
CREATE FUNCTION public.personal_leaderboard(p_game uuid)
RETURNS TABLE("position" bigint,user_id uuid,player_name text,avatar_url text,best_score bigint,total_score bigint,rounds_counted bigint,rounds_played bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH config AS (
 SELECT pr.format,COALESCE(g.scoring_cards_count,1) AS n FROM personal_league_rules pr JOIN games g ON g.id=pr.game_id
 WHERE pr.game_id=p_game AND (is_game_member(p_game,auth.uid()) OR COALESCE(auth.jwt()->>'role','')='service_role')
 ), eligible AS (
 SELECT s.user_id,s.id,r.played_on,CASE c.format WHEN 'stroke_gross' THEN v.gross_total WHEN 'stroke_net' THEN v.net_total ELSE v.stableford_points END AS value
 FROM personal_league_submissions s JOIN personal_rounds r ON r.id=s.round_id AND r.current_revision_id=s.revision_id
 JOIN personal_card_revisions v ON v.id=s.revision_id CROSS JOIN config c
 WHERE s.game_id=p_game AND s.status='accepted'
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

CREATE FUNCTION public.get_personal_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 RETURN jsonb_build_object(
 'level',calculate_personal_level(auth.uid()),
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
CREATE FUNCTION public.get_personal_card(p_round uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE;
BEGIN
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid();
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 RETURN jsonb_build_object('round',to_jsonb(r),
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
   WHERE gm.user_id=auth.uid() AND NOT g.is_practice),'[]'::jsonb));
END $$;
CREATE FUNCTION public.get_personal_league(p_game uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_game_member(p_game,auth.uid()) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM personal_league_rules WHERE game_id=p_game) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('rules',(SELECT to_jsonb(r) FROM personal_league_rules r WHERE game_id=p_game),
 'game',(SELECT jsonb_build_object('id',id,'name',name,'start_date',start_date,'end_date',end_date,'invite_code',invite_code,
   'scoring_cards_count',scoring_cards_count,'status',status) FROM games WHERE id=p_game),
 'tee',(SELECT jsonb_build_object('name',t.name,'course_name',c.name,'hole_count',l.hole_count) FROM personal_league_rules pr
 JOIN personal_tees t ON t.id=pr.tee_id JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE pr.game_id=p_game),
 'board',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM personal_leaderboard(p_game)b),'[]'::jsonb),
 'submissions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'round_id',s.round_id,'user_id',s.user_id,
 'player_name',COALESCE(p.username,p.first_name),'played_on',r.played_on,'status',s.status,'reason',s.reason,
 'revision_number',v.revision_number,'gross_total',v.gross_total,'net_total',v.net_total,'stableford_points',v.stableford_points,
 'scores',v.scores) ORDER BY s.submitted_at DESC) FROM personal_league_submissions s JOIN profiles p ON p.id=s.user_id
 JOIN personal_rounds r ON r.id=s.round_id JOIN personal_card_revisions v ON v.id=s.revision_id WHERE s.game_id=p_game),'[]'::jsonb));
END $$;
-- Lock league calculation rules once any card has been submitted.
CREATE FUNCTION public.lock_personal_league_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM personal_league_submissions WHERE game_id=OLD.id)
 AND (OLD.start_date,OLD.end_date,OLD.course_id,OLD.format,OLD.scoring_basis,OLD.scoring_cards_count)
 IS DISTINCT FROM(NEW.start_date,NEW.end_date,NEW.course_id,NEW.format,NEW.scoring_basis,NEW.scoring_cards_count) THEN
  RAISE EXCEPTION 'League scoring rules are locked after the first submission.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lock_personal_league_rules BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION lock_personal_league_rules();
CREATE FUNCTION public.lock_personal_rule_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM personal_league_submissions WHERE game_id=OLD.game_id) THEN
  RAISE EXCEPTION 'Submitted league rules are immutable.';
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER trg_lock_personal_rule_row BEFORE UPDATE OR DELETE ON personal_league_rules
 FOR EACH ROW EXECUTE FUNCTION lock_personal_rule_row();
CREATE FUNCTION public.block_legacy_personal_matches() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM personal_league_rules WHERE game_id=NEW.game_id) THEN
  RAISE EXCEPTION 'Record a personal round and submit its card to this league.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_block_legacy_personal_matches BEFORE INSERT ON matches FOR EACH ROW EXECUTE FUNCTION block_legacy_personal_matches();
-- Existing dashboard callers keep the same RPC contract.
ALTER FUNCTION public.get_leaderboard(uuid) RENAME TO get_legacy_leaderboard;
CREATE FUNCTION public.get_leaderboard(p_game_id uuid)
RETURNS TABLE("position" bigint,user_id uuid,player_name text,avatar_url text,best_score bigint,total_score bigint,rounds_counted bigint,rounds_played bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM personal_league_rules WHERE game_id=p_game_id) THEN
  RETURN QUERY SELECT * FROM personal_leaderboard(p_game_id);
 ELSE RETURN QUERY SELECT * FROM get_legacy_leaderboard(p_game_id); END IF;
END $$;

-- Revoke PostgreSQL's default PUBLIC execution on EVERY new function,
-- including helpers whose arguments can name another user.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN('personal_immutable','personal_hole_immutable','personal_reference_ready',
 'publish_personal_tee','calculate_personal_level','snapshot_personal_level','declare_personal_index',
 'create_personal_round','save_personal_card','personal_strokes','confirm_personal_card','create_personal_league',
 'personal_submission_reason','submit_personal_card','attest_personal_card','personal_leaderboard',
 'get_personal_overview','get_personal_card','get_personal_league','lock_personal_league_rules',
 'block_legacy_personal_matches','lock_personal_rule_row','get_leaderboard') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION publish_personal_tee(uuid,text,text,numeric,int,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION declare_personal_index(numeric),create_personal_round(uuid,date),save_personal_card(uuid,jsonb,int),
 confirm_personal_card(uuid,int),create_personal_league(text,uuid,date,date,text,int,text),
 submit_personal_card(uuid,uuid),attest_personal_card(uuid,boolean,boolean),get_personal_overview(),
 get_personal_card(uuid),get_personal_league(uuid),get_leaderboard(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_leaderboard(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
