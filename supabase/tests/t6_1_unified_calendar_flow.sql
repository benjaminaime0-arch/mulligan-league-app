-- Full authenticated card/league flow on the four pilot configurations.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4610000-0000-4000-8000-000000000001','unified-owner@test.local','{"username":"unified-owner"}'),
 ('a4610000-0000-4000-8000-000000000002','unified-outsider@test.local','{"username":"unified-outsider"}');
DO $$ DECLARE owner uuid:='a4610000-0000-4000-8000-000000000001'; outsider uuid:='a4610000-0000-4000-8000-000000000002';
 t record; rounds uuid[]:='{}'; leagues uuid[]:='{}'; card uuid; g uuid; result jsonb; holes jsonb; n int; i int; count_before int; idx numeric;
 BEGIN
 IF personal_calendar_end('2026-10-14',1)<>'2026-11-13'
 OR personal_calendar_end('2026-10-14',2)<>'2026-12-13'
 OR personal_calendar_end('2026-10-14',3)<>'2027-01-13'
 OR personal_calendar_end('2024-01-31',1)<>'2024-02-28'
 OR personal_calendar_end('2025-01-31',1)<>'2025-02-27'
 OR personal_calendar_end('2026-12-31',2)<>'2027-02-27' THEN RAISE EXCEPTION 'Calendar golden vectors failed'; END IF;
 UPDATE profiles SET handicap=11.4 WHERE id=owner;
 SELECT count(*) INTO count_before FROM official_index_declarations WHERE user_id=owner;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF (get_personal_overview()->>'official_index')::numeric<>11.4 THEN RAISE EXCEPTION 'Legacy index did not mirror'; END IF;
 PERFORM declare_personal_index(11.4);
 RESET ROLE;
 IF (SELECT count(*) FROM official_index_declarations WHERE user_id=owner)<>count_before THEN RAISE EXCEPTION 'Identical declaration duplicated history'; END IF;
 SET LOCAL ROLE authenticated;
 PERFORM declare_personal_index(NULL);
 IF get_personal_overview()->>'official_index' IS NOT NULL THEN RAISE EXCEPTION 'Withdrawal did not clear canonical index'; END IF;
 RESET ROLE;
 IF (SELECT handicap FROM profiles WHERE id=owner) IS NOT NULL THEN RAISE EXCEPTION 'Withdrawal did not clear profile mirror'; END IF;
 SELECT t1.id INTO card FROM personal_tees t1 JOIN personal_layouts l ON l.id=t1.layout_id JOIN courses c ON c.id=l.course_id
 WHERE c.name='Golf de Rueil-Malmaison' AND l.hole_count=9 AND t1.name='Jaunes — Messieurs';
 SET LOCAL ROLE authenticated;
 result:=create_personal_round(card,current_date);
 IF (get_personal_card((result->>'id')::uuid)->'round'->>'handicap_index')::numeric<>54 THEN RAISE EXCEPTION 'Missing-index fallback failed'; END IF;
 PERFORM declare_personal_index(-1.2); PERFORM declare_personal_index(13.6);
 IF (get_personal_overview()->>'official_index')::numeric<>13.6 THEN RAISE EXCEPTION 'Successive declaration ordering failed'; END IF;
 BEGIN PERFORM declare_personal_index(11.45); RAISE EXCEPTION 'Invalid precision accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Use an official index between -10 and 54, with at most one decimal.' THEN RAISE; END IF; END;
 RESET ROLE;
 FOR t IN SELECT t1.id,l.hole_count,c.name FROM personal_tees t1 JOIN personal_layouts l ON l.id=t1.layout_id JOIN courses c ON c.id=l.course_id
 WHERE c.name IN('Golf de Rueil-Malmaison','Golf du Haras de Jardy') AND l.hole_count IN(9,18) AND t1.name='Jaunes — Messieurs' ORDER BY c.name,l.hole_count LOOP
  SET LOCAL ROLE authenticated;
  card:=(create_personal_round(t.id,current_date)->>'id')::uuid; rounds:=array_append(rounds,card);
  FOR n IN 1..3 LOOP
   result:=create_calendar_league('Unified '||t.name||' '||t.hole_count||' M'||n,t.id,current_date,n,(ARRAY['stroke_gross','stroke_net','stableford_net'])[n]);
   g:=(result->>'game_id')::uuid; leagues:=array_append(leagues,g);
   IF result->>'timezone'<>'Europe/Paris' THEN RAISE EXCEPTION 'Course timezone lost'; END IF;
   RESET ROLE;
   IF (SELECT end_date FROM games WHERE id=g)<>personal_calendar_end(current_date,n) OR (SELECT duration_months FROM personal_league_rules WHERE game_id=g)<>n THEN RAISE EXCEPTION 'Stored duration mismatch'; END IF;
   SET LOCAL ROLE authenticated;
  END LOOP;
  RESET ROLE;
 END LOOP;
 IF cardinality(rounds)<>4 OR cardinality(leagues)<>12 THEN RAISE EXCEPTION 'Pilot matrix incomplete'; END IF;
 SET LOCAL ROLE authenticated;
 PERFORM declare_personal_index(20.5);
 IF jsonb_array_length(get_personal_leagues())<>12 THEN RAISE EXCEPTION 'League membership summary wrong'; END IF;
 FOR i IN 1..4 LOOP
  card:=rounds[i]; result:=get_personal_card(card);
  IF (result->'round'->>'handicap_index')::numeric<>13.6 THEN RAISE EXCEPTION 'Existing card handicap changed'; END IF;
  SELECT jsonb_agg(jsonb_build_object('hole_number',h,'completion','completed','strokes',5)) INTO holes FROM generate_series(1,(result->'tee'->>'hole_count')::int)h;
  PERFORM save_personal_card(card,holes,0); PERFORM confirm_personal_card(card,1);
  FOR n IN 1..3 LOOP
   g:=leagues[(i-1)*3+n]; result:=submit_personal_card(card,g);
   IF (result->>'success')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'Compatible card refused: %',result; END IF;
   PERFORM submit_personal_card(card,g);
  END LOOP;
 END LOOP;
 result:=get_personal_overview();
 IF (result->'level'->>'cards_count')::int<>4 OR result->'level'->>'status'<>'established' THEN RAISE EXCEPTION 'Shared card counted more than once: %',result->'level'; END IF;
 idx:=(result->'level'->>'value')::numeric;
 result:=create_personal_round((get_personal_card(rounds[1])->'round'->>'tee_id')::uuid,current_date);
 result:=get_personal_card((result->>'id')::uuid);
 IF result->'round'->>'handicap_source'<>'internal' OR (result->'round'->>'handicap_index')::numeric<>idx THEN RAISE EXCEPTION 'Established level priority failed'; END IF;
 BEGIN PERFORM create_calendar_league('Bad duration',(result->'round'->>'tee_id')::uuid,current_date,4,'stroke_net'); RAISE EXCEPTION 'Invalid duration accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Choose a duration of 1, 2 or 3 calendar months.' THEN RAISE; END IF; END;
 UPDATE profiles SET handicap=54 WHERE id=outsider; GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Cross-owner index update allowed'; END IF;
 RESET ROLE;
 IF (SELECT count(*) FROM personal_league_submissions WHERE user_id=owner AND status='accepted')<>12 THEN RAISE EXCEPTION 'Submission duplication or rejection'; END IF;
 IF has_function_privilege('authenticated','public.create_game(text,text,int,date,date,int,int,text,uuid,text,boolean)','execute') OR has_function_privilege('anon','public.create_calendar_league(text,uuid,date,int,text,int,text)','execute') THEN RAISE EXCEPTION 'Unchecked creator exposed'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF jsonb_array_length(get_personal_leagues())<>0 THEN RAISE EXCEPTION 'Non-member league leak'; END IF;
 RESET ROLE;
END $$;
ROLLBACK;
