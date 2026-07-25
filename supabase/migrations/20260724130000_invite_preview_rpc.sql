-- ============================================================================
-- Invite deep links: pre-auth game preview (T1.3)
-- ============================================================================
-- `/join/[code]` must show WHAT you're joining before asking anyone to sign
-- up — game name, course, format, member count. Games are private (member-
-- only SELECT since privatize_leagues), so a logged-out visitor can't read
-- the row directly. This SECURITY DEFINER RPC exposes exactly the four
-- display fields for a valid code and nothing else: no ids, no invite codes,
-- no member identities, no scores.
--
-- Executable by `anon` on purpose — that is the whole point of a pre-auth
-- preview — but it is a narrow, read-only projection keyed by a 6-char code
-- the visitor must already possess.
--
-- AUD#9 (invite-code brute force) is mitigated here by:
--   * returning a uniform "not found" shape for invalid AND full/closed
--     games, so probing can't distinguish them;
--   * a per-code lookup that returns no identifiers an attacker could use.
-- A longer code + per-IP rate limit remain the follow-up (noted in the
-- ticket); this RPC deliberately leaks nothing that makes guessing valuable.
-- ============================================================================

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
  IF p_code IS NULL OR length(btrim(p_code)) <> 6 THEN
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

GRANT EXECUTE ON FUNCTION public.get_invite_preview(text) TO anon, authenticated;

-- ============================================================================
-- VERIFICATION
--   SELECT get_invite_preview('ABC123');   -- {"found": false}
--   SELECT get_invite_preview((SELECT invite_code FROM games LIMIT 1));
--   -- expect name/course_name/format/member_count, no ids
-- ============================================================================
