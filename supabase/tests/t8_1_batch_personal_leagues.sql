BEGIN;
SET LOCAL search_path=public,extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4810000-0000-4000-8000-000000000001','batch-owner@test.local','{"username":"batch-owner"}'),
 ('a4810000-0000-4000-8000-000000000002','batch-validator@test.local','{"username":"batch-validator"}');
DO $$
DECLARE owner uuid:='a4810000-0000-4000-8000-000000000001'; partner uuid:='a4810000-0000-4000-8000-000000000002';
 t record; r uuid; rev uuid; g1 uuid; g2 uuid; bad uuid; other_tee uuid; scores jsonb; result jsonb; old_deadline timestamptz; due timestamptz; blocked bool; i int:=0;
BEGIN
 FOR t IN SELECT pt.id,l.hole_count,c.name FROM personal_tees pt JOIN personal_layouts l ON l.id=pt.layout_id JOIN courses c ON c.id=l.course_id
 WHERE c.name IN('Golf de Rueil-Malmaison','Golf du Haras de Jardy') AND pt.name='Jaunes — Messieurs' LOOP
  i:=i+1;
  SELECT id INTO other_tee FROM personal_tees WHERE id<>t.id AND verified LIMIT 1;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
  g1:=(create_calendar_league('Batch net',t.id,current_date,1,'stroke_net',1,'peer_required')->>'game_id')::uuid;
  g2:=(create_calendar_league('Batch points',t.id,current_date,2,'stableford_net',1,'peer_required')->>'game_id')::uuid;
  bad:=(create_calendar_league('Batch incompatible',other_tee,current_date,1,'stroke_net')->>'game_id')::uuid;
  r:=(create_personal_round(t.id,current_date)->>'id')::uuid;
  RESET ROLE; INSERT INTO game_members(game_id,user_id) VALUES(g1,partner),(g2,partner);
  SELECT jsonb_agg(jsonb_build_object('hole_number',hole_number,'completion','completed','strokes',par+1) ORDER BY hole_number) INTO scores FROM personal_tee_holes WHERE tee_id=t.id;
  SET LOCAL ROLE authenticated; PERFORM save_personal_card(r,scores,0);
  rev:=(request_personal_validation(r,1,partner)->>'revision_id')::uuid;
  result:=submit_personal_card_to_leagues(r,'{}',rev);
  IF result->>'reason'<>'invalid_selection' THEN RAISE EXCEPTION 'Empty selection accepted'; END IF;
  result:=submit_personal_card_to_leagues(r,NULL,rev);
  IF result->>'reason'<>'invalid_selection' THEN RAISE EXCEPTION 'NULL selection accepted'; END IF;
  result:=submit_personal_card_to_leagues(r,ARRAY[g1,NULL],rev);
  IF result->>'reason'<>'invalid_selection' THEN RAISE EXCEPTION 'NULL target accepted'; END IF;
  result:=submit_personal_card_to_leagues(r,array_fill(g1,ARRAY[51]),rev);
  IF result->>'reason'<>'invalid_selection' THEN RAISE EXCEPTION 'Oversized request accepted'; END IF;
  result:=submit_personal_card_to_leagues(r,ARRAY[g1,g2],gen_random_uuid());
  IF result->>'reason'<>'card_changed' THEN RAISE EXCEPTION 'Stale revision accepted'; END IF;
  result:=submit_personal_card_to_leagues(r,ARRAY[g1,gen_random_uuid()],rev);
  IF result->>'success'<>'false' OR result->'results'->0->>'reason'<>'not_member' THEN RAISE EXCEPTION 'Unknown or nonmember league accepted'; END IF;
  result:=submit_personal_card_to_leagues(r,ARRAY[g1,bad],rev);
  IF result->>'success'<>'false' OR result->'results'->0->>'reason'<>'wrong_layout_or_tee' THEN RAISE EXCEPTION 'Incompatible batch accepted: %',result; END IF;
  RESET ROLE;
  IF EXISTS(SELECT 1 FROM personal_league_submissions WHERE round_id=r) THEN RAISE EXCEPTION 'Partial batch created associations'; END IF;
  UPDATE games SET status='completed' WHERE id=bad;
  SELECT entry_deadline_at,auto_validation_at INTO old_deadline,due FROM personal_rounds WHERE id=r;
  UPDATE personal_rounds SET entry_deadline_at=clock_timestamp()-interval '1 second' WHERE id=r;
  SET LOCAL ROLE authenticated; result:=submit_personal_card_to_leagues(r,ARRAY[g1,g2],rev);
  IF result->>'success'<>'false' OR result->'results'->0->>'reason'<>'submission_deadline' THEN RAISE EXCEPTION 'Expired batch accepted'; END IF;
  RESET ROLE; UPDATE personal_rounds SET entry_deadline_at=old_deadline WHERE id=r;
  SET LOCAL ROLE authenticated; result:=submit_personal_card_to_leagues(r,ARRAY[g1,g2,bad],rev);
  IF result->>'success'<>'false' OR result->'results'->0->>'reason'<>'league_closed' THEN RAISE EXCEPTION 'Closed league accepted'; END IF;
  result:=submit_personal_card_to_leagues(r,ARRAY[g2,g1,g1],rev);
  IF result->>'success'<>'true' OR (result->>'submitted_count')::int<>2 OR jsonb_array_length(result->'results')<>2 THEN RAISE EXCEPTION 'Two-league dedup failed: %',result; END IF;
  result:=submit_personal_card_to_leagues(r,ARRAY[g1,g2],rev);
  IF result->>'success'<>'true' OR (result->>'submitted_count')::int<>0 THEN RAISE EXCEPTION 'Retry not idempotent'; END IF;
  RESET ROLE;
  IF (SELECT count(*) FROM personal_league_submissions WHERE round_id=r AND status='pending')<>2
   OR (SELECT auto_validation_at FROM personal_rounds WHERE id=r) IS DISTINCT FROM due
   OR (SELECT count(*) FROM notifications WHERE user_id=partner AND type='personal_card' AND data->>'round_id'=r::text)<>1
  THEN RAISE EXCEPTION 'Batch duplicated a card, timer or validation alert'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',partner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
  blocked:=false; BEGIN PERFORM submit_personal_card_to_leagues(r,ARRAY[g1,g2],rev); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'Another player submitted the owner card'; END IF;
  PERFORM review_personal_card(r,rev,NULL,NULL,true);
  RESET ROLE;
  IF (SELECT count(*) FROM personal_league_submissions WHERE round_id=r AND status='accepted')<>2
   OR (calculate_personal_level(owner)->>'cards_count')::int<>i THEN RAISE EXCEPTION 'Validated batch counted a card twice'; END IF;
 END LOOP;
 IF i<>4 THEN RAISE EXCEPTION 'Rueil/Jardy 9/18 matrix incomplete'; END IF;
 IF has_function_privilege('anon','public.submit_personal_card_to_leagues(uuid,uuid[],uuid)','execute') THEN RAISE EXCEPTION 'Anonymous batch access'; END IF;
END $$;
ROLLBACK;
