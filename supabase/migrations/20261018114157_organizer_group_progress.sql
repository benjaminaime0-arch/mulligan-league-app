-- Preserve the member-only league contract; add a narrow organizer-only launch view.
CREATE OR REPLACE FUNCTION public.get_personal_league(p_game uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_game_member(p_game,auth.uid()) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM personal_league_rules WHERE game_id=p_game) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('closure_status',(SELECT CASE WHEN clock_timestamp()<(g.end_date+1)::timestamp AT TIME ZONE c.timezone THEN 'open' WHEN EXISTS(SELECT 1 FROM personal_league_submissions s WHERE s.game_id=p_game AND s.status='pending') THEN 'closed_provisional' ELSE 'finalized' END FROM games g JOIN personal_league_rules pr ON pr.game_id=g.id JOIN personal_tees t ON t.id=pr.tee_id JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE g.id=p_game),
 'rules',(SELECT to_jsonb(r) FROM personal_league_rules r WHERE game_id=p_game),
 'game',(SELECT jsonb_build_object('id',id,'name',name,'start_date',start_date,'end_date',end_date,'invite_code',invite_code,
   'scoring_cards_count',scoring_cards_count,'status',status) FROM games WHERE id=p_game),
 'tee',(SELECT jsonb_build_object('name',t.name,'course_name',c.name,'hole_count',l.hole_count) FROM personal_league_rules pr
 JOIN personal_tees t ON t.id=pr.tee_id JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE pr.game_id=p_game),
 -- Organizer-only projection of named in-app invitations. A notification is
 -- evidence of an invitation, never evidence of delivery, opening or joining.
 'organizer_progress',CASE WHEN auth.uid() IS NOT NULL AND EXISTS(
   SELECT 1 FROM games g WHERE g.id=p_game AND g.admin_id=auth.uid()
 ) THEN jsonb_build_object('awaiting_join',COALESCE((
   SELECT jsonb_agg(jsonb_build_object('user_id',i.user_id,'player_name',COALESCE(p.username,p.first_name,'Player')) ORDER BY lower(COALESCE(p.username,p.first_name,'Player')),i.user_id)
   FROM (SELECT DISTINCT n.user_id FROM notifications n
     WHERE n.type='league_invitation' AND n.data->>'game_id'=p_game::text
       AND NOT EXISTS(SELECT 1 FROM game_members m WHERE m.game_id=p_game AND m.user_id=n.user_id)) i
   JOIN profiles p ON p.id=i.user_id
 ),'[]'::jsonb)) ELSE NULL END,
 'board',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM personal_leaderboard(p_game)b),'[]'::jsonb),
 'submissions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'round_id',s.round_id,'user_id',s.user_id,
 'card_status',r.status,'validator_id',r.validator_id,'auto_validation_at',r.auto_validation_at,'player_name',COALESCE(p.username,p.first_name),'played_on',r.played_on,'status',s.status,'reason',s.reason,
 'revision_number',v.revision_number,'gross_total',v.gross_total,'net_total',v.net_total,'stableford_points',v.stableford_points,
 'scores',v.scores) ORDER BY s.submitted_at DESC) FROM personal_league_submissions s JOIN profiles p ON p.id=s.user_id
 JOIN personal_rounds r ON r.id=s.round_id JOIN personal_card_revisions v ON v.id=s.revision_id WHERE s.game_id=p_game),'[]'::jsonb));
END $$;
