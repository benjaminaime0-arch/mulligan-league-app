-- One transaction, one frozen revision, many league associations. No score copies.
CREATE FUNCTION public.submit_personal_card_to_leagues(p_round uuid,p_games uuid[],p_revision uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r personal_rounds%ROWTYPE; targets uuid[]; g uuid; reason text; existing uuid;
 results jsonb:='[]'; rejected jsonb:='[]'; submitted int:=0; response jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF p_games IS NULL OR cardinality(p_games)<1 OR cardinality(p_games)>50 OR array_position(p_games,NULL) IS NOT NULL
 THEN RETURN jsonb_build_object('success',false,'reason','invalid_selection','submitted_count',0); END IF;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO targets FROM unnest(p_games) id;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 SELECT * INTO r FROM personal_rounds WHERE id=p_round AND user_id=auth.uid() FOR UPDATE;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Round not found.'; END IF;
 IF p_revision IS NULL OR r.current_revision_id IS DISTINCT FROM p_revision
 THEN RETURN jsonb_build_object('success',false,'reason','card_changed','submitted_count',0); END IF;
 -- Check membership before allowing locks on a caller-supplied league id.
 FOREACH g IN ARRAY targets LOOP
  IF NOT is_game_member(g,auth.uid()) THEN
   rejected:=rejected||jsonb_build_array(jsonb_build_object('game_id',g,'reason','not_member'));
  END IF;
 END LOOP;
 IF jsonb_array_length(rejected)>0 THEN
  RETURN jsonb_build_object('success',false,'results',rejected,'submitted_count',0);
 END IF;
 -- Consistent UUID order also protects the calendar while admission is checked.
 PERFORM id FROM games WHERE id=ANY(targets) ORDER BY id FOR UPDATE;
 PERFORM game_id FROM personal_league_rules WHERE game_id=ANY(targets) ORDER BY game_id FOR UPDATE;
 FOREACH g IN ARRAY targets LOOP
  SELECT id INTO existing FROM personal_league_submissions WHERE game_id=g AND revision_id=p_revision AND status IN('pending','accepted');
  IF existing IS NULL THEN
   reason:=personal_submission_reason(p_round,g);
   IF reason IS NOT NULL THEN rejected:=rejected||jsonb_build_array(jsonb_build_object('game_id',g,'reason',reason)); END IF;
  END IF;
 END LOOP;
 IF jsonb_array_length(rejected)>0 THEN
  RETURN jsonb_build_object('success',false,'results',rejected,'submitted_count',0);
 END IF;
 FOREACH g IN ARRAY targets LOOP
  SELECT id INTO existing FROM personal_league_submissions WHERE game_id=g AND revision_id=p_revision AND status IN('pending','accepted');
  response:=submit_personal_card(p_round,g);
  -- Recheck at write time: an expired deadline must roll back the whole batch.
  IF (response->>'success')::boolean IS NOT TRUE THEN
   RAISE EXCEPTION 'League eligibility changed. Reload the card and try again.';
  END IF;
  IF existing IS NULL THEN submitted:=submitted+1; END IF;
  results:=results||jsonb_build_array(response||jsonb_build_object('game_id',g,'unchanged',existing IS NOT NULL));
 END LOOP;
 RETURN jsonb_build_object('success',true,'submitted_count',submitted,'results',results);
END $$;
REVOKE ALL ON FUNCTION public.submit_personal_card_to_leagues(uuid,uuid[],uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_personal_card_to_leagues(uuid,uuid[],uuid) TO authenticated;
