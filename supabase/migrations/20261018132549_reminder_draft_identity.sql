-- Add exact tee identity to the caller-owned round summaries; authorization is unchanged.
CREATE OR REPLACE FUNCTION public.get_personal_overview() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 RETURN jsonb_build_object(
 'level',calculate_personal_level(auth.uid()),
 'inbox',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'played_on',r.played_on,'status',r.status,'auto_validation_at',r.auto_validation_at,'player_name',COALESCE(p.username,p.first_name),'course_name',c.name,'hole_count',l.hole_count,'tee_name',t.name) ORDER BY r.submitted_at) FROM personal_rounds r JOIN profiles p ON p.id=r.user_id JOIN personal_tees t ON t.id=r.tee_id JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE (r.validator_id=auth.uid() AND r.status='pending_validation') OR (r.user_id=auth.uid() AND r.status='pending_player_confirmation')),'[]'::jsonb),
 'official_index',(SELECT index_value FROM official_index_declarations WHERE user_id=auth.uid()
                  ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1),
 'history',COALESCE((SELECT jsonb_agg(x ORDER BY x.calculated_at DESC) FROM(SELECT level_value,status,cards_count,calculated_at
   FROM personal_level_snapshots WHERE user_id=auth.uid() ORDER BY calculated_at DESC LIMIT 20)x),'[]'::jsonb),
 'tees',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'layout_id',l.id,'layout_name',l.name,
   'course_name',c.name,'course_id',c.id,'hole_count',l.hole_count,'course_rating',t.course_rating,
   'slope_rating',t.slope_rating,'ready',personal_reference_ready(t.id)) ORDER BY c.name,l.hole_count,t.name)
   FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id),'[]'::jsonb),
 'rounds',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'tee_id',r.tee_id,'played_on',r.played_on,'status',r.status,
   'course_name',c.name,'tee_name',t.name,'hole_count',l.hole_count,'revision_number',v.revision_number,
   'gross_total',v.gross_total,'net_total',v.net_total,'stableford_points',v.stableford_points,'differential',v.differential)
   ORDER BY r.played_on DESC,r.created_at DESC) FROM personal_rounds r JOIN personal_tees t ON t.id=r.tee_id
   JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id
   LEFT JOIN personal_card_revisions v ON v.id=r.current_revision_id WHERE r.user_id=auth.uid()),'[]'::jsonb));
END $$;
