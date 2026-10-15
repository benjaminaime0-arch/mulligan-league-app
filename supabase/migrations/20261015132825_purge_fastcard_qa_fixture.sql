-- Disposable fixtures for the four mobile card-flow checks, 15 October.
-- Exact identity, time and scope guards keep real accounts outside this cleanup.
DO $$
DECLARE qa_owner uuid; rounds uuid[]; leagues uuid[];
BEGIN
 SELECT u.id INTO qa_owner FROM auth.users u JOIN public.profiles p ON p.id=u.id
 WHERE u.email='qa-fastcard-owner@test.local' AND p.username='qa-fastcard-owner'
 AND u.created_at >= '2026-10-15 13:00:00+00' AND u.created_at < '2026-10-15 14:00:00+00';
 IF qa_owner IS NULL THEN RETURN; END IF;
 SELECT array_agg(id) INTO rounds FROM public.personal_rounds WHERE user_id=qa_owner;
 SELECT array_agg(id) INTO leagues FROM public.games WHERE admin_id=qa_owner;
 IF cardinality(rounds) IS DISTINCT FROM 4 OR cardinality(leagues) IS DISTINCT FROM 12
 OR (SELECT count(*) FROM public.personal_league_submissions WHERE round_id=ANY(rounds))<>8
 OR EXISTS(SELECT 1 FROM public.personal_league_submissions WHERE game_id=ANY(leagues) AND user_id<>qa_owner)
 OR EXISTS(SELECT 1 FROM public.game_members WHERE game_id=ANY(leagues) AND user_id<>qa_owner)
 THEN RAISE EXCEPTION 'Fast card QA cleanup scope mismatch'; END IF;
 DELETE FROM public.notifications WHERE user_id=qa_owner
 OR data->>'game_id'=ANY(SELECT unnest(leagues)::text)
 OR data->>'round_id'=ANY(SELECT unnest(rounds)::text);
 DELETE FROM public.personal_league_submissions WHERE round_id=ANY(rounds);
 DELETE FROM public.personal_level_snapshots WHERE user_id=qa_owner;
 ALTER TABLE public.personal_rounds DISABLE TRIGGER personal_terminal_card_guard;
 ALTER TABLE public.personal_card_events DISABLE TRIGGER personal_event_immutable;
 ALTER TABLE public.personal_card_revisions DISABLE TRIGGER personal_revision_immutable;
 UPDATE public.personal_rounds SET current_revision_id=NULL WHERE id=ANY(rounds);
 DELETE FROM public.personal_card_events WHERE round_id=ANY(rounds);
 DELETE FROM public.personal_card_revisions WHERE round_id=ANY(rounds);
 ALTER TABLE public.personal_card_revisions ENABLE TRIGGER personal_revision_immutable;
 ALTER TABLE public.personal_card_events ENABLE TRIGGER personal_event_immutable;
 ALTER TABLE public.personal_rounds ENABLE TRIGGER personal_terminal_card_guard;
 DELETE FROM public.personal_round_holes WHERE round_id=ANY(rounds);
 DELETE FROM public.personal_rounds WHERE id=ANY(rounds);
 DELETE FROM public.personal_league_rules WHERE game_id=ANY(leagues);
 DELETE FROM public.games WHERE id=ANY(leagues);
 DELETE FROM auth.users WHERE id=qa_owner;
END $$;
