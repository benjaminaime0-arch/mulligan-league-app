BEGIN;
SET LOCAL search_path=public,extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4520000-0000-0000-0000-000000000001','pilot-lifecycle@test.local','{"username":"pilot-lifecycle"}'),
 ('a4520000-0000-0000-0000-000000000002','pilot-validator@test.local','{"username":"pilot-validator"}');
DO $$
DECLARE owner uuid:='a4520000-0000-0000-0000-000000000001'; partner uuid:='a4520000-0000-0000-0000-000000000002';
 t record; r uuid; rev uuid; g1 uuid; g2 uuid; holes jsonb; changed jsonb; card jsonb; original_handicap int; n int;
BEGIN
 FOR t IN SELECT pt.*,l.hole_count,c.name course_name FROM personal_tees pt JOIN personal_layouts l ON l.id=pt.layout_id JOIN courses c ON c.id=l.course_id
 WHERE c.name IN('Golf de Rueil-Malmaison','Golf du Haras de Jardy') AND pt.name='Jaunes — Messieurs' LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
  g1:=(create_calendar_league('Pilot lifecycle net',t.id,current_date-1,1,'stroke_net',1,'peer_required')->>'game_id')::uuid;
  g2:=(create_calendar_league('Pilot lifecycle points',t.id,current_date-1,1,'stableford_net')->>'game_id')::uuid;
  RESET ROLE; INSERT INTO game_members(game_id,user_id) VALUES(g1,partner),(g2,partner);
  SELECT jsonb_agg(jsonb_build_object('hole_number',hole_number,'completion','completed','strokes',par+1) ORDER BY hole_number) INTO holes FROM personal_tee_holes WHERE tee_id=t.id;
  SET LOCAL ROLE authenticated; r:=(create_personal_round(t.id,current_date)->>'id')::uuid; PERFORM save_personal_card(r,holes,0);
  rev:=(request_personal_validation(r,1,partner)->>'revision_id')::uuid;
  card:=get_personal_card(r); original_handicap:=(card->'revision'->>'playing_handicap')::int;
  PERFORM submit_personal_card(r,g1); PERFORM submit_personal_card(r,g2);
  RESET ROLE; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',partner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
  changed:=jsonb_set(holes,'{0,completion}','"picked_up"'); changed:=jsonb_set(changed,'{0,strokes}','null');
  PERFORM review_personal_card(r,rev,changed,'First hole was picked up',true);
  RESET ROLE; PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
  card:=get_personal_card(r); rev:=(card->'revision'->>'id')::uuid; PERFORM resolve_personal_correction(r,rev,true); card:=get_personal_card(r);
  IF card->'revision'->>'gross_total' IS NOT NULL OR (card->'revision'->>'playing_handicap')::int<>original_handicap OR jsonb_array_length(card->'revision'->'scores')<>t.hole_count THEN RAISE EXCEPTION 'Correction changed frozen handicap or lost holes: %',t.course_name; END IF;
  SELECT rounds_counted::int INTO n FROM get_leaderboard(g1) WHERE user_id=owner; IF n<>0 THEN RAISE EXCEPTION 'Pickup counted in net stroke'; END IF;
  SELECT rounds_counted::int INTO n FROM get_leaderboard(g2) WHERE user_id=owner; IF n<>1 THEN RAISE EXCEPTION 'Pickup not counted in Stableford'; END IF;
  RESET ROLE;
 END LOOP;
 IF (SELECT count(*) FROM personal_rounds WHERE user_id=owner AND status='validated')<>4 OR (calculate_personal_level(owner)->>'cards_count')::int<>4 THEN RAISE EXCEPTION 'Pilot lifecycle level counted a revision twice'; END IF;
END $$;
ROLLBACK;
