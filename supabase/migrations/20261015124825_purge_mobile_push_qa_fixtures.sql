-- Remove only the disposable accounts from the 15 October mobile push test.
-- This is a no-op on a fresh database. Real player accounts and shared reference
-- tees/courses are never selected. Triggers are restored within the transaction.
DO $$
DECLARE qa_owner uuid; qa_recipient uuid; rounds uuid[]; leagues uuid[];
BEGIN
 SELECT u.id INTO qa_owner FROM auth.users u JOIN public.profiles p ON p.id=u.id
 WHERE u.email='qa-push-sender@test.local' AND p.username='qa-push-sender'
 AND u.created_at >= '2026-10-15 12:00:00+00' AND u.created_at < '2026-10-15 13:00:00+00';
 SELECT u.id INTO qa_recipient FROM auth.users u JOIN public.profiles p ON p.id=u.id
 WHERE u.email='qa-push-recipient@test.local' AND p.username='qa-push-recipient'
 AND u.created_at >= '2026-10-15 12:00:00+00' AND u.created_at < '2026-10-15 13:00:00+00';
 IF qa_owner IS NULL AND qa_recipient IS NULL THEN RETURN; END IF;
 IF qa_owner IS NULL OR qa_recipient IS NULL OR qa_owner=qa_recipient THEN RAISE EXCEPTION 'QA cleanup identity mismatch'; END IF;
 SELECT array_agg(id) INTO rounds FROM public.personal_rounds WHERE user_id=qa_owner;
 SELECT array_agg(id) INTO leagues FROM public.games WHERE admin_id=qa_owner;
 IF cardinality(rounds) IS DISTINCT FROM 6 OR cardinality(leagues) IS DISTINCT FROM 8
 OR EXISTS(SELECT 1 FROM public.personal_rounds WHERE user_id=qa_recipient)
 OR EXISTS(SELECT 1 FROM public.personal_league_submissions WHERE game_id=ANY(leagues) AND user_id<>qa_owner)
 THEN RAISE EXCEPTION 'QA cleanup scope mismatch'; END IF;
 DELETE FROM public.notifications WHERE user_id IN(qa_owner,qa_recipient)
 OR data->>'game_id'=ANY(SELECT unnest(leagues)::text)
 OR data->>'round_id'=ANY(SELECT unnest(rounds)::text);
 DELETE FROM public.personal_league_submissions WHERE round_id=ANY(rounds);
 DELETE FROM public.personal_level_snapshots WHERE user_id IN(qa_owner,qa_recipient);
 -- Keep FK checks active. Release only the QA round/revision cycle explicitly.
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
 DELETE FROM auth.users WHERE id IN(qa_owner,qa_recipient);
END $$;
