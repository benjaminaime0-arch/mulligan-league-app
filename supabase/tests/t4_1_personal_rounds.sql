-- Personal-round milestone: real RPC flow and permissions on a disposable DB.
BEGIN;
SET LOCAL search_path=public,extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4410000-0000-0000-0000-000000000001','personal-owner@test.local','{"first_name":"Personal","username":"personal-owner"}'),
 ('a4410000-0000-0000-0000-000000000002','personal-witness@test.local','{"first_name":"Witness","username":"personal-witness"}'),
 ('a4410000-0000-0000-0000-000000000003','personal-outsider@test.local','{"first_name":"Outsider","username":"personal-outsider"}');
INSERT INTO courses(id,name,city,holes,par) VALUES('c4410000-0000-0000-0000-000000000001','Personal Test Nine','Test',9,36);

DO $$
DECLARE owner uuid:='a4410000-0000-0000-0000-000000000001'; witness uuid:='a4410000-0000-0000-0000-000000000002';
 tee uuid; other_tee uuid; holes jsonb; r uuid; second uuid; third uuid; future uuid; rev uuid; g1 uuid; g2 uuid; g3 uuid; qualification uuid;
 result jsonb; level jsonb; sid uuid; code text; v int; php int; i int;
BEGIN
 SELECT jsonb_agg(jsonb_build_object('hole_number',n,'par',4,'stroke_index',n)) INTO holes FROM generate_series(1,9)n;
 SET LOCAL ROLE service_role;
 tee:=publish_personal_tee('c4410000-0000-0000-0000-000000000001','Nine','Yellow',36,113,'Verified test fixture',holes);
 other_tee:=publish_personal_tee('c4410000-0000-0000-0000-000000000001','Nine','Red',36,113,'Verified test fixture',holes);
 RESET ROLE;
 PERFORM set_config('t441.tee',tee::text,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM declare_personal_index(18);
 r:=(create_personal_round(tee,current_date)->>'id')::uuid;
 PERFORM set_config('t441.round',r::text,true);
 SELECT jsonb_agg(jsonb_build_object('hole_number',n,'completion','completed','strokes',5)) INTO holes FROM generate_series(1,8)n;
 PERFORM save_personal_card(r,holes,0);
 BEGIN
  PERFORM confirm_personal_card(r,1); RAISE EXCEPTION 'Partial personal card confirmed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Partial personal card confirmed' THEN RAISE; END IF; END;
 SELECT jsonb_agg(jsonb_build_object('hole_number',n,'completion','completed','strokes',5)) INTO holes FROM generate_series(1,9)n;
 BEGIN
  PERFORM save_personal_card(r,holes,0); RAISE EXCEPTION 'Stale draft version overwritten';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Stale draft version overwritten' THEN RAISE; END IF; END;
 BEGIN PERFORM save_personal_card(r,holes,NULL); RAISE EXCEPTION 'Null version bypassed concurrency';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Null version bypassed concurrency' THEN RAISE; END IF; END;
 PERFORM save_personal_card(r,holes,1);
 result:=confirm_personal_card(r,2); rev:=(result->>'revision_id')::uuid;level:=result->'level';
 IF level->>'status'<>'provisional' OR (level->>'value')::numeric<>18 THEN RAISE EXCEPTION 'Wrong first level %',level; END IF;
 result:=confirm_personal_card(r,2);
 IF (result->>'revision_id')::uuid<>rev OR (result->>'unchanged')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Confirmation duplicated revision'; END IF;
 result:=get_personal_card(r);
 IF (result->'revision'->>'playing_handicap')::int<>9 OR (result->'revision'->>'gross_total')::int<>45
 OR (result->'revision'->>'net_total')::int<>36 OR (result->'revision'->>'stableford_points')::int<>18 THEN
  RAISE EXCEPTION 'Wrong nine-hole scoring %',result->'revision';
 END IF;
 -- Three confirmed rounds establish the internal level. No hidden game exists.
 second:=(create_personal_round(tee,current_date)->>'id')::uuid;
 PERFORM save_personal_card(second,holes,0); PERFORM confirm_personal_card(second,1);
 third:=(create_personal_round(tee,current_date)->>'id')::uuid;
 PERFORM save_personal_card(third,holes,0); result:=confirm_personal_card(third,1);
 IF result->'level'->>'status'<>'established' OR (result->'level'->>'value')::numeric<>16 THEN
  RAISE EXCEPTION 'Three-card schedule incorrect %',result;
 END IF;
 future:=(create_personal_round(tee,current_date)->>'id')::uuid;
 result:=get_personal_card(future);
 IF result->'round'->>'handicap_source'<>'internal' OR (result->'round'->>'handicap_index')::numeric<>16 THEN RAISE EXCEPTION 'Internal level not used for next round'; END IF;
 IF (get_personal_overview()->>'official_index')::numeric<>18 THEN RAISE EXCEPTION 'Official index was rewritten'; END IF;
 g1:=(create_calendar_league('Personal League One',tee,current_date-1,1,'stroke_net',1,'self_declared')->>'game_id')::uuid;
 g2:=(create_calendar_league('Personal League Two',tee,current_date-1,1,'stableford_net',1,'self_declared')->>'game_id')::uuid;
 code:=get_personal_league(g2)->'game'->>'invite_code';
 g3:=(create_calendar_league('Other tee',other_tee,current_date-1,1,'stroke_net',1,'self_declared')->>'game_id')::uuid;
 IF (submit_personal_card(r,g1)->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'First league submission failed'; END IF;
 result:=submit_personal_card(r,g2);sid:=(result->>'submission_id')::uuid;
 IF (result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Second league submission failed'; END IF;
 IF submit_personal_card(r,g3)->>'reason'<>'wrong_layout_or_tee' THEN RAISE EXCEPTION 'Wrong tee accepted'; END IF;
 result:=submit_personal_card(r,g1);
 IF (result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Idempotent submission refused'; END IF;
 BEGIN
  PERFORM attest_personal_card(sid,true,true); RAISE EXCEPTION 'Self-attestation accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Self-attestation accepted' THEN RAISE; END IF; END;
 RESET ROLE;
 SELECT count(*) INTO v FROM personal_league_submissions WHERE round_id=r AND revision_id=rev;
 IF v<>2 THEN RAISE EXCEPTION 'Submissions duplicated the card: %',v; END IF;
 SELECT count(*) INTO v FROM personal_rounds WHERE user_id=owner AND status='validated';
 IF v<>3 THEN RAISE EXCEPTION 'League submission duplicated personal round'; END IF;
 -- Witness joins and attests that exact shared revision.
 PERFORM set_config('request.jwt.claims',json_build_object('sub',witness,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 result:=join_game_by_code(code)::jsonb;
 IF (result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Witness could not join with shared invite: %',result; END IF;
 IF get_personal_league(g2) IS NULL THEN RAISE EXCEPTION 'Member cannot review league'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 qualification:=(create_calendar_league('Qualification',tee,current_date-1,1,'stroke_net',2,'self_declared')->>'game_id')::uuid;
 PERFORM submit_personal_card(second,qualification);
 IF EXISTS(SELECT 1 FROM get_leaderboard(qualification) WHERE user_id=owner AND "position" IS NOT NULL) THEN
  RAISE EXCEPTION 'Personal league ranked a player below its required card count';
 END IF;
 PERFORM submit_personal_card(third,qualification);
 SELECT total_score::int INTO v FROM get_leaderboard(qualification) WHERE user_id=owner AND "position"=1;
 IF v IS DISTINCT FROM 72 THEN RAISE EXCEPTION 'Qualified personal sum incorrect %',v; END IF;
 SELECT total_score::int INTO v FROM get_leaderboard(g1) WHERE user_id=owner;
 IF v<>36 THEN RAISE EXCEPTION 'Net leaderboard incorrect %',v; END IF;
 SELECT total_score::int INTO v FROM get_leaderboard(g2) WHERE user_id=owner;
 IF v<>18 THEN RAISE EXCEPTION 'Stableford leaderboard incorrect %',v; END IF;
 -- Validated cards are now terminal; owner edits cannot supersede them.
 BEGIN PERFORM save_personal_card(r,jsonb_set(holes,'{0,strokes}','6'),2); RAISE EXCEPTION 'Validated card edited';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Validated card edited' THEN RAISE; END IF; END;
 IF get_personal_card(r)->'revision'->>'id'<>rev::text THEN RAISE EXCEPTION 'Locked revision changed'; END IF;
 RESET ROLE;
 IF (SELECT handicap_index FROM personal_rounds WHERE id=r)<>18 THEN RAISE EXCEPTION 'Historical handicap snapshot changed'; END IF;
 BEGIN
  UPDATE personal_card_revisions SET gross_total=1 WHERE id=rev; RAISE EXCEPTION 'Immutable revision changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Immutable revision changed' THEN RAISE; END IF; END;
 BEGIN
  UPDATE games SET scoring_cards_count=2 WHERE id=g1; RAISE EXCEPTION 'Submitted league rules changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Submitted league rules changed' THEN RAISE; END IF; END;
END $$;

DO $$
DECLARE r uuid:=current_setting('t441.round')::uuid; tee uuid:=current_setting('t441.tee')::uuid; result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims','{"sub":"a4410000-0000-0000-0000-000000000003","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM get_personal_card(r); RAISE EXCEPTION 'Outsider read private card';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Outsider read private card' THEN RAISE; END IF; END;
 BEGIN PERFORM save_personal_card(r,'[]',3); RAISE EXCEPTION 'Outsider edited private card';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Outsider edited private card' THEN RAISE; END IF; END;
 BEGIN PERFORM calculate_personal_level('a4410000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'Outsider called private helper';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO personal_rounds(user_id,tee_id,played_on,handicap_source,handicap_index)
 VALUES(auth.uid(),tee,current_date,'default_54',54); RAISE EXCEPTION 'Browser bypassed round RPC';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM publish_personal_tee('c4410000-0000-0000-0000-000000000001','Nine','Fake',36,113,'Fake','[]'); RAISE EXCEPTION 'Browser published rating';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=get_personal_overview();
 IF jsonb_array_length(result->'rounds')<>0 THEN RAISE EXCEPTION 'Outsider overview leaked cards'; END IF;
 RESET ROLE;
END $$;
ROLLBACK;
