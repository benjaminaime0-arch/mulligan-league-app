-- Accept current ten-character league invitations and six-character legacy codes.
-- Preserve the existing read-only, code-keyed anonymous projection.
CREATE OR REPLACE FUNCTION public.get_invite_preview(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
DECLARE
  v_game   public.games%ROWTYPE;
  v_count  integer;
BEGIN
  IF p_code IS NULL OR upper(btrim(p_code)) !~ '^(?:[A-Z0-9]{6}|[A-Z0-9]{10})$' THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_game
  FROM public.games
  WHERE upper(invite_code) = upper(btrim(p_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT count(*) INTO v_count
  FROM public.game_members
  WHERE game_id = v_game.id;

  RETURN jsonb_build_object(
    'found', true,
    'name', v_game.name,
    'course_name', v_game.course_name,
    'format', COALESCE(v_game.format, v_game.game_type, 'stroke_play'),
    'member_count', v_count,
    'max_players', v_game.max_players,
    'status', v_game.status,
    -- Actionability flags so the UI can show a friendly dead-end instead of
    -- letting someone sign up for a game they can't actually enter.
    'is_full', (v_game.max_players IS NOT NULL AND v_count >= v_game.max_players),
    'is_completed', (v_game.status = 'completed')
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_invite_preview(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon,authenticated,service_role;
NOTIFY pgrst,'reload schema';
