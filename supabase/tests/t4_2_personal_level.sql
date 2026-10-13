BEGIN;
SET LOCAL search_path=public,extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4420000-0000-0000-0000-000000000001','level-owner@test.local','{"first_name":"Level","username":"level-owner"}'),
 ('a4420000-0000-0000-0000-000000000002','level-window@test.local','{"first_name":"Window","username":"level-window"}');
INSERT INTO courses(id,name,city,holes,par) VALUES('c4420000-0000-0000-0000-000000000001','Level Test Eighteen','Test',18,72);
DO $$
DECLARE tee uuid; pending uuid; r uuid; x jsonb; holes jsonb; i int; result jsonb;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('hole_number',n,'par',4,'stroke_index',n)) INTO holes FROM generate_series(1,18)n;
 tee:=publish_personal_tee('c4420000-0000-0000-0000-000000000001','Eighteen','Yellow',72,113,'Verified eighteen-hole test fixture',holes);
 PERFORM set_config('t442.tee',tee::text,true);
 -- A service cannot accidentally revise a published rating or its holes.
 BEGIN UPDATE personal_tees SET slope_rating=140 WHERE id=tee; RAISE EXCEPTION 'Verified tee modified';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Verified tee modified' THEN RAISE; END IF; END;
 BEGIN UPDATE personal_tee_holes SET par=5 WHERE tee_id=tee AND hole_number=1; RAISE EXCEPTION 'Verified holes modified';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Verified holes modified' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claims','{"sub":"a4420000-0000-0000-0000-000000000001","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 r:=(create_personal_round(tee,current_date)->>'id')::uuid;
 IF (get_personal_card(r)->'round'->>'handicap_index')::numeric<>54 THEN RAISE EXCEPTION 'Default index is not 54'; END IF;
 PERFORM declare_personal_index(-1);
 r:=(create_personal_round(tee,current_date)->>'id')::uuid;
 SELECT jsonb_agg(jsonb_build_object('hole_number',n,'completion','completed','strokes',4)) INTO holes FROM generate_series(1,18)n;
 PERFORM save_personal_card(r,holes,0);PERFORM confirm_personal_card(r,1);
 result:=get_personal_card(r);
 IF (result->'revision'->>'playing_handicap')::int<>-1 OR (result->'revision'->>'net_total')::int<>73
 OR (result->'revision'->>'stableford_points')::int<>35 THEN RAISE EXCEPTION 'Plus handicap allocation incorrect %',result->'revision'; END IF;
 -- A pickup remains eligible for personal level, with no fabricated stroke total.
 r:=(create_personal_round(tee,current_date)->>'id')::uuid;
 holes:=jsonb_set(jsonb_set(holes,'{0,completion}','"picked_up"'),'{0,strokes}','null');
 PERFORM save_personal_card(r,holes,0);PERFORM confirm_personal_card(r,1);
 result:=get_personal_card(r);
 IF result->'revision'->>'gross_total' IS NOT NULL OR result->'revision'->>'net_total' IS NOT NULL
 OR (result->'revision'->>'stableford_points')::int<>33 THEN RAISE EXCEPTION 'Pickup mishandled %',result->'revision'; END IF;
 -- Data from an unrated reference can be drafted, never confirmed.
 RESET ROLE;
 SELECT id INTO pending FROM personal_tees WHERE NOT verified LIMIT 1;
 SET LOCAL ROLE authenticated;
 r:=(create_personal_round(pending,current_date)->>'id')::uuid;
 BEGIN PERFORM confirm_personal_card(r,0); RAISE EXCEPTION 'Unverified reference confirmed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unverified reference confirmed' THEN RAISE; END IF; END;
 RESET ROLE;
END $$;
-- Deterministic algorithm fixtures isolate selection and chronology from scoring.
CREATE FUNCTION pg_temp.level_fixture(u uuid,d numeric,days_ago int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r uuid; v uuid;
BEGIN
 INSERT INTO personal_rounds(user_id,tee_id,played_on,handicap_source,handicap_index,entry_deadline_at)
 VALUES(u,current_setting('t442.tee')::uuid,current_date-days_ago,'default_54',54,personal_entry_deadline(current_date-days_ago,'Europe/Paris')) RETURNING id INTO r;
 INSERT INTO personal_card_revisions(round_id,revision_number,scores,tee_snapshot,playing_handicap,gross_total,net_total,stableford_points,adjusted_gross,differential,actor_id)
 VALUES(r,1,'[]','{}',0,72,72,36,72,d,u) RETURNING id INTO v;
 UPDATE personal_rounds SET current_revision_id=v,status='validated' WHERE id=r;
END $$;
DO $$
DECLARE u uuid:='a4420000-0000-0000-0000-000000000002'; result jsonb; i int;
BEGIN
 FOR i IN 1..21 LOOP PERFORM pg_temp.level_fixture(u,i,21-i); END LOOP;
 result:=calculate_personal_level(u);
 IF (result->>'cards_count')::int<>20 OR (result->>'cards_used')::int<>8 OR (result->>'value')::numeric<>5.5 THEN
  RAISE EXCEPTION 'Last-20 / best-8 incorrect %',result;
 END IF;
 -- Historical selection must exclude cards played after the requested date.
 result:=calculate_personal_level(u,current_date-18);
 IF (result->>'cards_count')::int<>3 OR (result->>'value')::numeric<>-1 THEN RAISE EXCEPTION 'Historical snapshot selection incorrect %',result; END IF;
END $$;
ROLLBACK;
