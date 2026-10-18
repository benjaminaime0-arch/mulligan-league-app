-- Compose existing permission-checked APIs in one transaction. If the card
-- cannot enter the selected league, confirmation and its side effects roll back.
CREATE FUNCTION public.confirm_card_into_league(p_round uuid,p_expected_version int,p_validator uuid,p_game uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE confirmed jsonb; submitted jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF p_game IS NULL THEN RAISE EXCEPTION 'league_card_rejected:not_member'; END IF;
 confirmed:=public.request_personal_validation(p_round,p_expected_version,p_validator);
 submitted:=public.submit_personal_card(p_round,p_game);
 IF NOT COALESCE((submitted->>'success')::boolean,false) THEN
  RAISE EXCEPTION 'league_card_rejected:%',COALESCE(submitted->>'reason','league_not_configured');
 END IF;
 RETURN jsonb_build_object('success',true,'revision_id',confirmed->'revision_id','submission',submitted);
END $$;
REVOKE ALL ON FUNCTION public.confirm_card_into_league(uuid,int,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_card_into_league(uuid,int,uuid,uuid) TO authenticated;

-- Keep the code-keyed public preview narrow. Only an authenticated current
-- member receives a destination ID; no profile, score or invitation list leaks.
CREATE OR REPLACE FUNCTION public.get_invite_preview(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public AS $$
DECLARE g public.games%ROWTYPE; rules public.personal_league_rules%ROWTYPE;
 member_count int; member boolean; tee_name text; holes int;
BEGIN
 IF p_code IS NULL OR upper(btrim(p_code)) !~ '^(?:[A-Z0-9]{6}|[A-Z0-9]{10})$' THEN RETURN jsonb_build_object('found',false); END IF;
 SELECT * INTO g FROM public.games WHERE upper(invite_code)=upper(btrim(p_code)) AND NOT is_practice LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('found',false); END IF;
 SELECT count(*) INTO member_count FROM public.game_members WHERE game_id=g.id;
 SELECT EXISTS(SELECT 1 FROM public.game_members WHERE game_id=g.id AND user_id=auth.uid()) INTO member;
 SELECT * INTO rules FROM public.personal_league_rules WHERE game_id=g.id;
 IF rules.game_id IS NOT NULL THEN
  SELECT t.name,l.hole_count INTO tee_name,holes FROM public.personal_tees t JOIN public.personal_layouts l ON l.id=t.layout_id WHERE t.id=rules.tee_id;
 END IF;
 RETURN jsonb_build_object('found',true,'name',g.name,'course_name',g.course_name,
 'format',COALESCE(rules.format,g.format,g.game_type,'stroke_play'),
 'member_count',member_count,'max_players',g.max_players,'status',g.status,
 'is_full',g.max_players IS NOT NULL AND member_count>=g.max_players,
 'is_completed',g.status='completed' OR (rules.game_id IS NOT NULL AND clock_timestamp()>=(g.end_date+1)::timestamp AT TIME ZONE rules.timezone),
 'start_date',g.start_date,'end_date',g.end_date,'hole_count',holes,'tee_name',tee_name,
 'attestation',rules.attestation,'scoring_cards_count',g.scoring_cards_count,
 'member_game_id',CASE WHEN member THEN g.id ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.get_invite_preview(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
