BEGIN;
SET LOCAL search_path=public,extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4710000-0000-0000-0000-000000000001','push-owner@test.local','{"username":"push-owner"}'),
 ('a4710000-0000-0000-0000-000000000002','push-validator@test.local','{"username":"push-validator"}'),
 ('a4710000-0000-0000-0000-000000000003','push-outsider@test.local','{"username":"push-outsider"}');
DO $$
DECLARE owner uuid:='a4710000-0000-0000-0000-000000000001'; partner uuid:='a4710000-0000-0000-0000-000000000002'; outsider uuid:='a4710000-0000-0000-0000-000000000003';
 t record; r uuid; rev uuid; g1 uuid; g2 uuid; g uuid; code text; holes jsonb; result jsonb; before_count int; blocked bool; tests int:=0;
BEGIN
 FOR t IN SELECT pt.*,l.hole_count,c.name course_name FROM personal_tees pt JOIN personal_layouts l ON l.id=pt.layout_id JOIN courses c ON c.id=l.course_id
 WHERE c.name IN('Golf de Rueil-Malmaison','Golf du Haras de Jardy') AND pt.name='Jaunes — Messieurs' LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
  g1:=(create_calendar_league('Push pilot one',t.id,current_date,1,'stroke_net',1,'peer_required')->>'game_id')::uuid;
  g2:=(create_calendar_league('Push pilot two',t.id,current_date,1,'stableford_net')->>'game_id')::uuid;
  FOREACH g IN ARRAY ARRAY[g1,g2] LOOP
   result:=invite_league_player(g,' PUSH-VALIDATOR ');
   IF result->>'sent'<>'true' THEN RAISE EXCEPTION 'Invitation not created'; END IF;
   result:=invite_league_player(g,'push-validator');
   IF result->>'duplicate'<>'true' THEN RAISE EXCEPTION 'Repeated invitation was not deduplicated'; END IF;
   RESET ROLE;
   IF (SELECT count(*) FROM notifications WHERE user_id=partner AND type='league_invitation' AND data->>'game_id'=g::text)<>1 THEN RAISE EXCEPTION 'Invitation duplicated'; END IF;
   SELECT data->>'invite_code' INTO code FROM notifications WHERE user_id=partner AND type='league_invitation' AND data->>'game_id'=g::text;
   IF code IS DISTINCT FROM (SELECT invite_code FROM games WHERE id=g) THEN RAISE EXCEPTION 'Wrong invitation deep link'; END IF;
   IF EXISTS(SELECT 1 FROM game_members WHERE user_id=partner AND game_id=g) THEN RAISE EXCEPTION 'Invitation silently joined recipient'; END IF;
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
   blocked:=false; BEGIN PERFORM invite_league_player(g,'push-validator'); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Non-member could invite'; END IF;
   RESET ROLE; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',partner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
   PERFORM join_game_by_code(code);
   RESET ROLE; IF NOT EXISTS(SELECT 1 FROM game_members WHERE user_id=partner AND game_id=g) THEN RAISE EXCEPTION 'Invitation join failed'; END IF;
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
   blocked:=false; BEGIN PERFORM invite_league_player(g,'push-validator'); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
   IF NOT blocked THEN RAISE EXCEPTION 'Existing member reinvited'; END IF;
  END LOOP;
  RESET ROLE;
  SELECT count(*) INTO before_count FROM notifications WHERE user_id=partner AND type='personal_card';
  SELECT jsonb_agg(jsonb_build_object('hole_number',hole_number,'completion','completed','strokes',par+1) ORDER BY hole_number) INTO holes FROM personal_tee_holes WHERE tee_id=t.id;
  SET LOCAL ROLE authenticated; r:=(create_personal_round(t.id,current_date)->>'id')::uuid; PERFORM save_personal_card(r,holes,0);
  rev:=(request_personal_validation(r,1,partner)->>'revision_id')::uuid;
  PERFORM submit_personal_card(r,g1); PERFORM submit_personal_card(r,g2);
  RESET ROLE;
  IF (SELECT count(*) FROM notifications WHERE user_id=partner AND type='personal_card')<>before_count+1 THEN RAISE EXCEPTION 'Two leagues duplicated card validation alert'; END IF;
  IF NOT EXISTS(SELECT 1 FROM notifications WHERE user_id=partner AND type='personal_card' AND data->>'round_id'=r::text) THEN RAISE EXCEPTION 'Validation alert missing card link'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',partner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
  PERFORM set_notification_preference('personal_card',false);
  RESET ROLE; IF should_send_push(partner,'personal_card') THEN RAISE EXCEPTION 'Muted card preferences ignored'; END IF;
  SET LOCAL ROLE authenticated; PERFORM set_notification_preference('personal_card',true); PERFORM review_personal_card(r,rev,NULL,NULL,true);
  RESET ROLE;
  IF (SELECT count(*) FROM personal_league_submissions WHERE round_id=r AND status='accepted')<>2 THEN RAISE EXCEPTION 'Both league cards did not validate'; END IF;
  tests:=tests+1;
 END LOOP;
 IF tests<>4 THEN RAISE EXCEPTION 'Expected Rueil/Jardy 9/18, got %',tests; END IF;
 IF (calculate_personal_level(owner)->>'cards_count')::int<>4 THEN RAISE EXCEPTION 'Level counted the same card twice'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 blocked:=false; BEGIN PERFORM invite_league_player(g1,'no-such-push-player'); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Unknown player invitation succeeded'; END IF;
 blocked:=false; BEGIN PERFORM invite_league_player(g1,'push-owner'); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Self invitation succeeded'; END IF;
 RESET ROLE;
 UPDATE games SET max_players=2 WHERE id=g1;
 SET LOCAL ROLE authenticated;
 blocked:=false; BEGIN PERFORM invite_league_player(g1,'push-outsider'); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Full league accepted invitation'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true); SET LOCAL ROLE anon;
 blocked:=false; BEGIN PERFORM invite_league_player(g1,'push-outsider'); EXCEPTION WHEN insufficient_privilege THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Anonymous caller could invite'; END IF;
 RESET ROLE;
END $$;
ROLLBACK;
