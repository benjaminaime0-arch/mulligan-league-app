-- Organizer visibility, invitation deduplication and membership are server-authoritative.
BEGIN;
SET LOCAL search_path=public,extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4920000-0000-4000-8000-000000000001','group-owner@test.invalid','{"username":"group-owner"}'),
 ('a4920000-0000-4000-8000-000000000002','group-joined@test.invalid','{"username":"group-joined"}'),
 ('a4920000-0000-4000-8000-000000000003','group-invited@test.invalid','{"username":"group-invited"}'),
 ('a4920000-0000-4000-8000-000000000004','group-other@test.invalid','{"username":"group-other"}');
DO $$
DECLARE owner uuid:='a4920000-0000-4000-8000-000000000001'; member uuid:='a4920000-0000-4000-8000-000000000002'; invited uuid:='a4920000-0000-4000-8000-000000000003'; outsider uuid:='a4920000-0000-4000-8000-000000000004';
 tee uuid; g uuid; other_game uuid; payload jsonb; invitations jsonb;
BEGIN
 SELECT t.id INTO tee FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id
 WHERE c.name ILIKE '%Rueil%' AND l.hole_count=9 AND t.name='Jaunes — Messieurs';
 IF tee IS NULL THEN RAISE EXCEPTION 'Missing QA tee'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 g:=(create_calendar_league('Organizer visibility',tee,current_date,1,'stroke_net',2,'peer_required')->>'game_id')::uuid;
 other_game:=(create_calendar_league('Unrelated invitations',tee,current_date,1,'stroke_net')->>'game_id')::uuid;
 PERFORM invite_league_player(g,'group-joined'); PERFORM invite_league_player(g,'group-invited');
 PERFORM invite_league_player(other_game,'group-other'); RESET ROLE;
 INSERT INTO game_members(game_id,user_id) VALUES(g,member);
 -- Duplicate retained notices must not duplicate an invitee in the launch view.
 INSERT INTO notifications(user_id,type,title,body,data) VALUES(invited,'league_invitation','Private title','Private message',jsonb_build_object('game_id',g));
 SET LOCAL ROLE authenticated; payload:=get_personal_league(g); RESET ROLE;
 invitations:=payload->'organizer_progress'->'awaiting_join';
 IF jsonb_array_length(invitations)<>1 OR invitations->0->>'user_id'<>invited::text OR invitations->0->>'player_name'<>'group-invited' THEN RAISE EXCEPTION 'Invitation list is stale, duplicated or leaks other leagues'; END IF;
 IF invitations->0 ? 'body' OR invitations->0 ? 'email' OR invitations->0 ? 'data' OR invitations->0 ? 'read' THEN RAISE EXCEPTION 'Invitation private fields leaked'; END IF;
 IF jsonb_array_length(payload->'board')<>2 OR jsonb_array_length(payload->'submissions')<>0 THEN RAISE EXCEPTION 'Existing member/card contract changed'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 payload:=get_personal_league(g); RESET ROLE;
 IF payload IS NULL OR payload->'organizer_progress'<>'null'::jsonb THEN RAISE EXCEPTION 'Member saw organizer invitations'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 payload:=get_personal_league(g); RESET ROLE;
 IF payload IS NOT NULL THEN RAISE EXCEPTION 'Non-member saw private league'; END IF;
 -- A new join is reflected by a fresh request, without local/session history.
 INSERT INTO game_members(game_id,user_id) VALUES(g,invited);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 payload:=get_personal_league(g); RESET ROLE;
 IF jsonb_array_length(payload->'organizer_progress'->'awaiting_join')<>0 OR jsonb_array_length(payload->'board')<>3 THEN RAISE EXCEPTION 'Join did not replace the pending invitation'; END IF;
 IF has_function_privilege('anon','public.get_personal_league(uuid)','execute') THEN RAISE EXCEPTION 'Anonymous league access granted'; END IF;
END $$;
ROLLBACK;
