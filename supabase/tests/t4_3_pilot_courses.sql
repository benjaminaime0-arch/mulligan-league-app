-- Real catalogue references: nine-hole half-slope normalization and two laps.
BEGIN;
SET LOCAL search_path=public,extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4430000-0000-0000-0000-000000000001','pilot-owner@test.local','{"first_name":"Pilot","username":"pilot-owner"}');

DO $$
DECLARE owner uuid:='a4430000-0000-0000-0000-000000000001';
 reference record; r uuid; payload jsonb; result jsonb; card jsonb; frozen numeric;
 expected int; par_sum int; total int; num int; g1 uuid; g2 uuid; rev uuid;
BEGIN
 SELECT count(*) INTO num FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id
 JOIN courses c ON c.id=l.course_id WHERE t.verified
 AND c.name IN('Golf de Rueil-Malmaison','Golf du Haras de Jardy','Golf du Stade Français Haras Lupin');
 IF num<>44 THEN RAISE EXCEPTION 'Expected 44 pilot references, got %',num; END IF;
 IF EXISTS(SELECT 1 FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id
 JOIN courses c ON c.id=l.course_id WHERE t.verified
 AND c.name IN('Golf de Rueil-Malmaison','Golf du Haras de Jardy','Golf du Stade Français Haras Lupin')
 AND (NOT personal_reference_ready(t.id) OR t.source NOT LIKE 'https://pages.ffgolf.org/%')) THEN
  RAISE EXCEPTION 'Pilot reference incomplete or unsourced';
 END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM declare_personal_index(18);
 RESET ROLE;
 -- Run every real tee through create/save/confirm. No synthetic tee replaces it.
 FOR reference IN SELECT t.*,l.hole_count,c.name AS course_name FROM personal_tees t
 JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id
 WHERE t.verified AND c.name IN('Golf de Rueil-Malmaison','Golf du Haras de Jardy','Golf du Stade Français Haras Lupin')
 ORDER BY (c.name='Golf de Rueil-Malmaison' AND l.hole_count=9 AND t.name='Jaunes — Messieurs') DESC,
 c.name,l.hole_count,t.name LOOP
  SELECT jsonb_agg(jsonb_build_object('hole_number',hole_number,'completion','completed','strokes',par+1)
    ORDER BY hole_number),sum(par),sum(par+1) INTO payload,par_sum,total FROM personal_tee_holes WHERE tee_id=reference.id;
  IF par_sum<>(CASE WHEN reference.course_name='Golf du Haras de Jardy' THEN 30 ELSE 32 END) * (reference.hole_count/9) THEN
   RAISE EXCEPTION 'Pilot par mismatch for %',reference.course_name;
  END IF;
  SET LOCAL ROLE authenticated;
  r:=(create_personal_round(reference.id,current_date)->>'id')::uuid;
  frozen:=(get_personal_card(r)->'round'->>'handicap_index')::numeric;
  expected:=round((CASE WHEN reference.hole_count=9 THEN round(frozen/2,1) ELSE frozen END) * reference.slope_rating/113
    +reference.course_rating-par_sum)::int;
  PERFORM save_personal_card(r,payload,0);
  result:=confirm_personal_card(r,1);card:=get_personal_card(r)->'revision';
  IF (card->>'playing_handicap')::int<>expected OR (card->>'gross_total')::int<>total
   OR (card->>'net_total')::int<>total-expected THEN RAISE EXCEPTION 'Pilot scoring failed % %',reference.course_name,card; END IF;
  IF reference.course_name='Golf de Rueil-Malmaison' AND reference.hole_count=9 AND reference.name='Jaunes — Messieurs' THEN
   IF reference.course_rating<>30.4 OR reference.slope_rating<>104 OR expected<>7
    OR (card->>'gross_total')::int<>41 OR (card->>'net_total')::int<>34
    OR (card->>'stableford_points')::int<>16 OR (card->>'differential')::numeric<>23.0 THEN
    RAISE EXCEPTION 'Rueil half-slope normalization failed %',card;
   END IF;
   rev:=(result->>'revision_id')::uuid;
   g1:=(create_calendar_league('Rueil pilot net',reference.id,current_date-1,1,'stroke_net')->>'game_id')::uuid;
   g2:=(create_calendar_league('Rueil pilot points',reference.id,current_date-1,1,'stableford_net')->>'game_id')::uuid;
   PERFORM submit_personal_card(r,g1); PERFORM submit_personal_card(r,g2);
  END IF;
  RESET ROLE;
 END LOOP;
 IF (SELECT count(*) FROM personal_league_submissions WHERE revision_id=rev AND status='accepted')<>2 THEN
  RAISE EXCEPTION 'Real Rueil card not reused across both leagues';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id
 JOIN courses c ON c.id=l.course_id WHERE c.name='Golf de Rueil-Malmaison' AND l.hole_count=18
 AND t.name='Jaunes — Messieurs' AND t.course_rating=60.7 AND t.slope_rating=104) THEN
  RAISE EXCEPTION 'Rueil two-lap rating was inferred from rounded nine-hole rating';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id
 JOIN courses c ON c.id=l.course_id WHERE c.name='Golf du Haras de Jardy' AND l.hole_count=9
 AND t.name='Bleus — Messieurs' AND t.course_rating=28.6 AND t.slope_rating=98) THEN
  RAISE EXCEPTION 'Jardy segment slope rounding was lost';
 END IF;
END $$;
ROLLBACK;
