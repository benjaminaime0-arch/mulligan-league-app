-- Synthetic identities; all records and notifications are rolled back.
BEGIN;
SET LOCAL search_path=public,extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4910000-0000-4000-8000-000000000001','return-card-owner@test.invalid','{"username":"return-card-owner"}'),
 ('a4910000-0000-4000-8000-000000000002','return-card-partner@test.invalid','{"username":"return-card-partner"}'),
 ('a4910000-0000-4000-8000-000000000003','return-card-other@test.invalid','{"username":"return-card-other"}');
DO $$
DECLARE owner uuid:='a4910000-0000-4000-8000-000000000001'; partner uuid:='a4910000-0000-4000-8000-000000000002'; outsider uuid:='a4910000-0000-4000-8000-000000000003';
 tee uuid; g uuid; solo uuid; shared uuid; ended uuid; r uuid; self_card uuid; rev uuid; code text; holes jsonb; result jsonb; p jsonb; blocked bool; target uuid;
 dt date:=(clock_timestamp() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
 SELECT t.id INTO tee FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id
 WHERE c.name ILIKE '%Rueil%' AND l.hole_count=9 AND t.name='Jaunes — Messieurs';
 IF tee IS NULL THEN RAISE EXCEPTION 'Missing verified QA tee'; END IF;
 SELECT jsonb_agg(jsonb_build_object('hole_number',hole_number,'completion','completed','strokes',par+1) ORDER BY hole_number) INTO holes FROM personal_tee_holes WHERE tee_id=tee;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);SET LOCAL ROLE authenticated;
 g:=(create_calendar_league('Returning group',tee,dt,1,'stroke_net',1,'peer_required')->>'game_id')::uuid;
 solo:=(create_calendar_league('Returning solo',tee,dt,1,'stableford_net')->>'game_id')::uuid;
 shared:=(create_calendar_league('Other friends',tee,dt,1,'stroke_net')->>'game_id')::uuid;
 ended:=(create_calendar_league('Previous season',tee,(dt-interval '2 months')::date,1,'stroke_net')->>'game_id')::uuid;
 r:=(create_personal_round(tee,dt)->>'id')::uuid;
 PERFORM save_personal_card(r,holes,0);RESET ROLE;
 INSERT INTO game_members(game_id,user_id) VALUES(g,partner),(shared,outsider);
 -- Both a missing witness and a witness from another shared league must undo
 -- confirmation, revisions, level changes and outgoing validation notices.
 FOREACH target IN ARRAY ARRAY[NULL::uuid,outsider] LOOP
  blocked:=false;
  BEGIN SET LOCAL ROLE authenticated;PERFORM confirm_card_into_league(r,1,target,g);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'league_card_rejected:validator_required' THEN RAISE; END IF;blocked:=true; END;RESET ROLE;
  IF NOT blocked OR (SELECT status FROM personal_rounds WHERE id=r)<>'draft'
   OR EXISTS(SELECT 1 FROM personal_card_revisions WHERE round_id=r)
   OR EXISTS(SELECT 1 FROM personal_card_events WHERE round_id=r)
   OR EXISTS(SELECT 1 FROM notifications WHERE type='personal_card' AND data->>'round_id'=r::text)
   OR (calculate_personal_level(owner)->>'cards_count')::int<>0 THEN RAISE EXCEPTION 'Ineligible confirmation escaped rollback'; END IF;
 END LOOP;
 FOREACH target IN ARRAY ARRAY[gen_random_uuid(),ended] LOOP
  blocked:=false;
  BEGIN SET LOCAL ROLE authenticated;PERFORM confirm_card_into_league(r,1,partner,target);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'league_card_rejected:%' THEN RAISE; END IF;blocked:=true; END;RESET ROLE;
  IF NOT blocked OR (SELECT status FROM personal_rounds WHERE id=r)<>'draft' THEN RAISE EXCEPTION 'Bad target locked the card'; END IF;
 END LOOP;
 blocked:=false;
 BEGIN SET LOCAL ROLE authenticated;PERFORM confirm_card_into_league(r,0,partner,g);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Card changed.%' THEN RAISE; END IF;blocked:=true; END;RESET ROLE;
 IF NOT blocked THEN RAISE EXCEPTION 'Stale client accepted'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);blocked:=false;
 BEGIN SET LOCAL ROLE authenticated;PERFORM confirm_card_into_league(r,1,partner,g);
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Round not found.' THEN RAISE; END IF;blocked:=true; END;RESET ROLE;
 IF NOT blocked THEN RAISE EXCEPTION 'Non-owner confirmed'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);SET LOCAL ROLE authenticated;
 result:=confirm_card_into_league(r,1,partner,g);rev:=(result->>'revision_id')::uuid;
 PERFORM confirm_card_into_league(r,1,partner,g);RESET ROLE;
 IF (SELECT status FROM personal_rounds WHERE id=r)<>'pending_validation'
  OR (SELECT count(*) FROM personal_league_submissions WHERE round_id=r AND game_id=g AND status='pending')<>1
  OR (SELECT count(*) FROM notifications WHERE user_id=partner AND type='personal_card' AND data->>'round_id'=r::text)<>1
  OR (SELECT count(*) FROM personal_card_events WHERE round_id=r AND action='submitted')<>1 THEN RAISE EXCEPTION 'Peer handoff duplicated or lost state'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',partner,'role','authenticated')::text,true);SET LOCAL ROLE authenticated;
 PERFORM review_personal_card(r,rev,NULL,NULL,true);RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);SET LOCAL ROLE authenticated;
 IF (SELECT rounds_counted FROM get_leaderboard(g) WHERE user_id=owner)<>1 THEN RAISE EXCEPTION 'Validated handoff did not count'; END IF;
 self_card:=(create_personal_round(tee,dt)->>'id')::uuid;PERFORM save_personal_card(self_card,holes,0);
 PERFORM confirm_card_into_league(self_card,1,NULL,solo);PERFORM confirm_card_into_league(self_card,1,NULL,solo);RESET ROLE;
 IF (SELECT status FROM personal_rounds WHERE id=self_card)<>'validated' OR (SELECT count(*) FROM personal_league_submissions WHERE round_id=self_card AND status='accepted')<>1 THEN RAISE EXCEPTION 'Self-declared handoff failed'; END IF;
 SELECT invite_code INTO code FROM games WHERE id=g;
 UPDATE games SET max_players=2 WHERE id=g;
 SET LOCAL ROLE authenticated;p:=get_invite_preview(code);
 IF p->>'member_game_id'<>g::text OR NOT (p->>'is_full')::boolean THEN RAISE EXCEPTION 'Existing full-league member lost destination'; END IF;RESET ROLE;
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);SET LOCAL ROLE anon;p:=get_invite_preview(code);
 IF NOT (p->>'found')::boolean OR p->>'member_game_id' IS NOT NULL OR p->>'hole_count'<>'9' OR p->>'attestation'<>'peer_required' THEN RAISE EXCEPTION 'Public preview contract failed'; END IF;
 IF p ? 'scores' OR p ? 'members' OR p ? 'invite_code' THEN RAISE EXCEPTION 'Private preview fields exposed'; END IF;
 RESET ROLE;
 IF has_function_privilege('anon','public.confirm_card_into_league(uuid,integer,uuid,uuid)','execute') THEN RAISE EXCEPTION 'Anonymous write exposed'; END IF;
 IF (SELECT prosecdef FROM pg_proc WHERE oid='public.confirm_card_into_league(uuid,integer,uuid,uuid)'::regprocedure) THEN RAISE EXCEPTION 'Wrapper gained definer rights'; END IF;
END $$;
ROLLBACK;
