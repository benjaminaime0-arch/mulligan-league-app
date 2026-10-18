-- Exact draft tee identity is returned only in the caller's own overview.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4930000-0000-4000-8000-000000000001','resume-owner@test.invalid','{"username":"resume-owner"}'),
 ('a4930000-0000-4000-8000-000000000002','resume-other@test.invalid','{"username":"resume-other"}');
DO $$
DECLARE owner uuid:='a4930000-0000-4000-8000-000000000001'; other_player uuid:='a4930000-0000-4000-8000-000000000002'; tee uuid; mine uuid; theirs uuid; p jsonb; blocked bool:=false;
BEGIN
 SELECT t.id INTO tee FROM public.personal_tees t JOIN public.personal_layouts l ON l.id=t.layout_id JOIN public.courses c ON c.id=l.course_id
 WHERE c.name ILIKE '%Rueil%' AND l.hole_count=9 AND t.name='Jaunes — Messieurs';
 IF tee IS NULL THEN RAISE EXCEPTION 'Missing QA tee'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 mine:=(public.create_personal_round(tee,(clock_timestamp() AT TIME ZONE 'Europe/Paris')::date)->>'id')::uuid; RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_player,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 theirs:=(public.create_personal_round(tee,(clock_timestamp() AT TIME ZONE 'Europe/Paris')::date)->>'id')::uuid; RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 p:=public.get_personal_overview(); RESET ROLE;
 IF jsonb_array_length(p->'rounds')<>1 OR p->'rounds'->0->>'id'<>mine::text OR p->'rounds'->0->>'tee_id'<>tee::text OR p->'rounds'->0->>'status'<>'draft' THEN RAISE EXCEPTION 'Wrong owner or draft tee identity'; END IF;
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 BEGIN SET LOCAL ROLE authenticated; PERFORM public.get_personal_overview();
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Authentication required.' THEN RAISE; END IF; blocked:=true; END; RESET ROLE;
 IF NOT blocked OR has_function_privilege('anon','public.get_personal_overview()','execute') THEN RAISE EXCEPTION 'Unauthenticated overview exposed'; END IF;
END $$;
ROLLBACK;
