-- One declared official index. Existing card/competition snapshots stay intact.
ALTER TABLE public.profiles DROP CONSTRAINT profiles_handicap_check;
ALTER TABLE public.profiles ALTER COLUMN handicap TYPE numeric(4,1) USING handicap::numeric;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_handicap_check CHECK(handicap BETWEEN -10 AND 54);
ALTER TABLE public.official_index_declarations ALTER COLUMN index_value DROP NOT NULL;

-- Existing declarations take precedence; import a legacy value only when no
-- declaration exists. The nullable latest declaration represents withdrawal.
INSERT INTO public.official_index_declarations(user_id,index_value,effective_on)
SELECT p.id,p.handicap,(clock_timestamp() AT TIME ZONE 'Europe/Paris')::date
FROM public.profiles p WHERE p.handicap IS NOT NULL
AND NOT EXISTS(SELECT 1 FROM public.official_index_declarations d WHERE d.user_id=p.id);
UPDATE public.profiles p SET handicap=d.index_value FROM (
 SELECT DISTINCT ON(user_id) user_id,index_value FROM public.official_index_declarations
 ORDER BY user_id,effective_on DESC,recorded_at DESC,id DESC
) d WHERE d.user_id=p.id AND p.handicap IS DISTINCT FROM d.index_value;

CREATE FUNCTION public.mirror_official_index() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE idx numeric;
BEGIN
 SELECT index_value INTO idx FROM official_index_declarations WHERE user_id=NEW.user_id
 ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1;
 UPDATE profiles SET handicap=idx WHERE id=NEW.user_id AND handicap IS DISTINCT FROM idx;
 RETURN NEW;
END $$;
CREATE FUNCTION public.capture_legacy_index_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE idx numeric; has_declaration boolean;
BEGIN
 SELECT index_value INTO idx FROM official_index_declarations WHERE user_id=NEW.id
 ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1;
 has_declaration:=FOUND;
 IF (NOT has_declaration AND NEW.handicap IS NOT NULL) OR
    (has_declaration AND NEW.handicap IS DISTINCT FROM idx) THEN
  INSERT INTO official_index_declarations(user_id,index_value,effective_on)
  VALUES(NEW.id,NEW.handicap,(clock_timestamp() AT TIME ZONE 'Europe/Paris')::date);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mirror_official_index(),public.capture_legacy_index_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER mirror_official_index AFTER INSERT ON public.official_index_declarations
 FOR EACH ROW EXECUTE FUNCTION public.mirror_official_index();
CREATE TRIGGER capture_legacy_index_insert AFTER INSERT ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public.capture_legacy_index_change();
CREATE TRIGGER capture_legacy_index_update AFTER UPDATE OF handicap ON public.profiles
 FOR EACH ROW WHEN(OLD.handicap IS DISTINCT FROM NEW.handicap)
 EXECUTE FUNCTION public.capture_legacy_index_change();
CREATE OR REPLACE FUNCTION public.declare_personal_index(p_index numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE idx numeric; found_index boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF p_index IS NOT NULL AND (p_index NOT BETWEEN -10 AND 54 OR p_index<>round(p_index,1)) THEN
  RAISE EXCEPTION 'Use an official index between -10 and 54, with at most one decimal.';
 END IF;
 -- Serialize declarations and compatible legacy writes on the same owner row.
 PERFORM 1 FROM profiles WHERE id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
 SELECT index_value INTO idx FROM official_index_declarations WHERE user_id=auth.uid()
 ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1;
 found_index:=FOUND;
 IF idx IS NOT DISTINCT FROM p_index AND (found_index OR p_index IS NULL) THEN
  RETURN jsonb_build_object('success',true,'unchanged',true);
 END IF;
 INSERT INTO official_index_declarations(user_id,index_value,effective_on)
 VALUES(auth.uid(),p_index,(clock_timestamp() AT TIME ZONE 'Europe/Paris')::date);
 RETURN jsonb_build_object('success',true);
END $$;

-- Calendar periods: start is inclusive, the clamped monthly anniversary is
-- exclusive. End is its preceding date, interpreted in the course timezone.
CREATE FUNCTION public.personal_calendar_end(p_start date,p_months int) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
BEGIN
 IF p_start IS NULL OR p_months IS NULL OR p_months NOT IN(1,2,3) THEN
  RAISE EXCEPTION 'Choose a duration of 1, 2 or 3 calendar months.';
 END IF;
 RETURN (p_start+make_interval(months=>p_months))::date-1;
END $$;
REVOKE ALL ON FUNCTION public.personal_calendar_end(date,int) FROM PUBLIC,anon,authenticated;
ALTER TABLE public.personal_league_rules ADD COLUMN duration_months smallint CHECK(duration_months IN(1,2,3));
ALTER TABLE public.personal_league_rules ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Paris';
-- NULL duration marks historical leagues; never rewrite their dates or cards.
CREATE OR REPLACE FUNCTION public.create_personal_league(p_name text,p_tee uuid,p_start date,p_end date,p_format text,p_cards int DEFAULT 1,p_attestation text DEFAULT 'self_declared')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t record; result json; g uuid; basis text; months int;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF NOT personal_reference_ready(p_tee) THEN RAISE EXCEPTION 'Choose a verified tee.'; END IF;
 IF p_name IS NULL OR p_cards IS NULL OR p_format IS NULL OR p_attestation IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 80
 OR p_start IS NULL OR p_end IS NULL OR p_cards NOT BETWEEN 1 AND 20
 OR p_format NOT IN('stroke_gross','stroke_net','stableford_net') OR p_attestation NOT IN('self_declared','peer_required') THEN
  RAISE EXCEPTION 'Invalid league rules.';
 END IF;
 SELECT m INTO months FROM generate_series(1,3) m WHERE personal_calendar_end(p_start,m)=p_end;
 IF months IS NULL THEN RAISE EXCEPTION 'Choose a duration of 1, 2 or 3 calendar months.'; END IF;
 SELECT c.id,c.name,c.timezone INTO t FROM personal_tees pt JOIN personal_layouts l ON l.id=pt.layout_id JOIN courses c ON c.id=l.course_id WHERE pt.id=p_tee;
 basis:=CASE p_format WHEN 'stroke_gross' THEN 'gross' WHEN 'stroke_net' THEN 'net' ELSE 'stableford_net' END;
 result:=create_game(trim(p_name),t.name,10,p_start,p_end,p_cards,NULL,'stroke_play',t.id,basis,false);
 IF NOT COALESCE((result->>'success')::boolean,false) THEN RAISE EXCEPTION '%',result->>'error'; END IF;
 g:=(result->>'game_id')::uuid;
 INSERT INTO personal_league_rules(game_id,tee_id,format,attestation,duration_months,timezone)
 VALUES(g,p_tee,p_format,p_attestation,months,t.timezone);
 UPDATE games SET status=CASE WHEN p_start<=(clock_timestamp() AT TIME ZONE t.timezone)::date THEN 'active' ELSE 'pending' END WHERE id=g;
 RETURN result::jsonb||jsonb_build_object('end_date',p_end,'duration_months',months,'timezone',t.timezone);
END $$;
CREATE FUNCTION public.create_calendar_league(p_name text,p_tee uuid,p_start date,p_duration_months int,p_format text,p_cards int DEFAULT 1,p_attestation text DEFAULT 'self_declared')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 RETURN create_personal_league(p_name,p_tee,p_start,personal_calendar_end(p_start,p_duration_months),p_format,p_cards,p_attestation);
END $$;
REVOKE ALL ON FUNCTION public.create_calendar_league(text,uuid,date,int,text,int,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_calendar_league(text,uuid,date,int,text,int,text) TO authenticated,service_role;

-- Fail the migration atomically if the calendar convention regresses.
DO $$ BEGIN
 IF personal_calendar_end('2026-10-14',1)<>'2026-11-13' OR
    personal_calendar_end('2026-10-14',2)<>'2026-12-13' OR
    personal_calendar_end('2026-10-14',3)<>'2027-01-13' OR
    personal_calendar_end('2024-01-31',1)<>'2024-02-28' OR
    personal_calendar_end('2025-01-31',1)<>'2025-02-27' OR
    personal_calendar_end('2024-02-29',3)<>'2024-05-28' THEN
  RAISE EXCEPTION 'Calendar period regression.';
 END IF;
END $$;
CREATE FUNCTION public.get_personal_leagues() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 RETURN COALESCE((SELECT jsonb_agg(x ORDER BY x.start_date DESC,x.id) FROM (
  SELECT g.id,g.name,c.name AS course_name,l.hole_count,t.name AS tee_name,
   g.start_date,g.end_date,pr.duration_months,pr.timezone,pr.format,pr.attestation,
   (SELECT count(*) FROM personal_league_submissions s WHERE s.game_id=g.id AND s.status='pending') AS pending_cards,
   CASE WHEN clock_timestamp()<g.start_date::timestamp AT TIME ZONE pr.timezone THEN 'upcoming'
    WHEN clock_timestamp()<(g.end_date+1)::timestamp AT TIME ZONE pr.timezone THEN 'active'
    WHEN EXISTS(SELECT 1 FROM personal_league_submissions s WHERE s.game_id=g.id AND s.status='pending') THEN 'closed_provisional'
    ELSE 'finalized' END AS lifecycle_state
  FROM game_members gm JOIN games g ON g.id=gm.game_id
  JOIN personal_league_rules pr ON pr.game_id=g.id JOIN personal_tees t ON t.id=pr.tee_id
  JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id
  WHERE gm.user_id=auth.uid()
 )x),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_personal_leagues() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_personal_leagues() TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
