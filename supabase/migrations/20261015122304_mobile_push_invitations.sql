-- Targeted invitations use the existing notification, preference and join flows.
-- Sharing a link alone does not identify a recipient and cannot send a push.
CREATE FUNCTION public.invite_league_player(p_game uuid, p_username text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := auth.uid(); g games%ROWTYPE; recipient uuid; sender text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in to invite a player.'; END IF;
 -- Serialize invitations per sender: rate limits and duplicate checks are atomic.
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text, 721));
 SELECT * INTO g FROM games WHERE id=p_game FOR UPDATE;
 IF NOT FOUND OR g.is_practice OR NOT EXISTS(
   SELECT 1 FROM game_members WHERE game_id=p_game AND user_id=actor
 ) THEN RAISE EXCEPTION 'Only league members can invite players.'; END IF;
 IF g.status NOT IN ('active','pending') OR g.end_date < (clock_timestamp() AT TIME ZONE 'Europe/Paris')::date
 THEN RAISE EXCEPTION 'This league is closed.'; END IF;
 IF length(btrim(p_username)) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Enter an exact player username.'; END IF;
 SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] END INTO recipient
 FROM profiles WHERE lower(username)=lower(btrim(p_username));
 IF recipient IS NULL THEN RAISE EXCEPTION 'Player not found. Check the exact username.'; END IF;
 IF recipient=actor OR EXISTS(SELECT 1 FROM game_members WHERE game_id=p_game AND user_id=recipient)
 THEN RAISE EXCEPTION 'This player already belongs to the league.'; END IF;
 IF (SELECT count(*) FROM game_members WHERE game_id=p_game)>=g.max_players
 THEN RAISE EXCEPTION 'This league is full.'; END IF;
 IF EXISTS(SELECT 1 FROM notifications WHERE user_id=recipient AND type='league_invitation'
   AND data->>'game_id'=p_game::text AND created_at>clock_timestamp()-interval '24 hours')
 THEN RETURN jsonb_build_object('sent',false,'duplicate',true); END IF;
 IF (SELECT count(*) FROM notifications WHERE type='league_invitation'
   AND data->>'inviter_id'=actor::text AND created_at>clock_timestamp()-interval '1 hour')>=20
 THEN RAISE EXCEPTION 'Invitation limit reached. Try again later.'; END IF;
 SELECT COALESCE(username,first_name,'A player') INTO sender FROM profiles WHERE id=actor;
 INSERT INTO notifications(user_id,type,title,body,data)
 VALUES(recipient,'league_invitation','League invitation',sender || ' invited you to ' || g.name,
   jsonb_build_object('game_id',p_game,'invite_code',g.invite_code,'inviter_id',actor));
 RETURN jsonb_build_object('sent',true,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.invite_league_player(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.invite_league_player(uuid,text) TO authenticated;
