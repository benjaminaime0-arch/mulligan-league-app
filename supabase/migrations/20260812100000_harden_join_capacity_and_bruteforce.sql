-- ============================================================================
-- Harden game joins: capacity race (#10) + invite-code brute force (#9)
-- ============================================================================
-- #10 (capacity race): join_game_by_code did SELECT COUNT(*) then INSERT with
--   NO row lock and no backstop on game_members — concurrent invite joins (or
--   an invite join racing an approve_join_request) could exceed max_players.
--   approve_join_request already locks the games row; join_game_by_code did
--   not. Fix: lock the games row FOR UPDATE before the count (serializes both
--   paths), plus a BEFORE INSERT capacity trigger on game_members as the
--   last-resort backstop for every insert path.
--
-- #9 (brute force): invite_code was 6 uppercase hex chars (~2^24 / 16.7M) with
--   no throttling and two oracles (get_invite_preview, join_game_by_code's
--   distinguishable errors) — the whole space is enumerable. Fix: raise NEW
--   codes to 10-char Crockford base32 (~2^50, enumeration infeasible) so the
--   oracles stop mattering, and add a per-user attempt throttle on
--   join_game_by_code as defense in depth. EXISTING codes are untouched so
--   live /join/[code] links keep working; the lookup already normalizes case.
--   (The anon get_invite_preview oracle needs edge/IP throttling to fully
--   close — out of scope for the DB layer; the entropy bump is what defangs
--   it here.)
--
-- Safe to re-run: IF NOT EXISTS / OR REPLACE / DROP TRIGGER IF EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- gen_invite_code: 10 chars of Crockford base32 (no I/L/O/U — unambiguous).
-- 32^10 ≈ 1.1e15 ≈ 2^50. Collisions are astronomically unlikely; the UNIQUE
-- constraint on games.invite_code remains the hard guarantee.
--
-- Randomness comes from gen_random_uuid() (core since PG13) via uuid_send,
-- NOT pgcrypto's gen_random_bytes — the latter lives in the `extensions`
-- schema on Supabase and isn't on the search_path when this runs as a
-- column DEFAULT, so it fails on a fresh db. A v4 uuid gives 16 random
-- bytes; we use the first 10. search_path pinned for safety.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gen_invite_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public'
AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  out text := '';
  b bytea := uuid_send(gen_random_uuid());
  i int;
BEGIN
  FOR i IN 0..9 LOOP
    out := out || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  END LOOP;
  RETURN out;
END;
$$;

-- New games only. The old 6-hex default (baseline_core_schema) is replaced;
-- existing rows keep their codes.
ALTER TABLE public.games
  ALTER COLUMN invite_code SET DEFAULT public.gen_invite_code();

-- ---------------------------------------------------------------------------
-- join_attempts: per-user sliding-window counter for failed code guesses.
-- Written only by the SECURITY DEFINER RPC; RLS on with no policies locks it
-- to clients entirely.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.join_attempts (
  user_id      uuid PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts     int NOT NULL DEFAULT 0
);
ALTER TABLE public.join_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.join_attempts FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- enforce_game_member_limit: BEFORE INSERT backstop on game_members. Mirrors
-- check_match_player_limit for match_players. Practice games (max_players=1,
-- single admin auto-added, fully server-controlled) are skipped so the
-- auto_add_game_admin_to_members insert always succeeds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_game_member_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_max int;
  v_practice boolean;
  v_count int;
BEGIN
  SELECT max_players, is_practice INTO v_max, v_practice
  FROM games WHERE id = NEW.game_id FOR UPDATE;

  IF v_practice OR v_max IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count FROM game_members WHERE game_id = NEW.game_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Game is full' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_game_member_limit ON public.game_members;
CREATE TRIGGER trg_enforce_game_member_limit
  BEFORE INSERT ON public.game_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_game_member_limit();

-- ---------------------------------------------------------------------------
-- join_game_by_code: + FOR UPDATE lock (capacity) + attempt throttle.
-- Body otherwise verbatim from the deployed 2026-08-11 version.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_game_by_code(code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id       uuid := auth.uid();
  v_game_id     uuid;
  v_game_name   text;
  v_max_players   int;
  v_current_count int;
  v_normalized    text;
  v_attempts      int;
  v_window        timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Throttle: max 10 failed guesses per 10-minute sliding window per user.
  SELECT attempts, window_start INTO v_attempts, v_window
  FROM join_attempts WHERE user_id = v_user_id FOR UPDATE;
  IF FOUND
     AND v_window > now() - interval '10 minutes'
     AND v_attempts >= 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Too many attempts. Try again in a few minutes.');
  END IF;

  v_normalized := upper(btrim(code));

  IF length(v_normalized) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invite code is required');
  END IF;

  -- is_practice games are unjoinable by design: same error as an invalid
  -- code, so the response never reveals that a practice game exists.
  SELECT id, name, max_players
  INTO v_game_id, v_game_name, v_max_players
  FROM games
  WHERE upper(btrim(invite_code)) = v_normalized
    AND NOT is_practice
  LIMIT 1;

  IF v_game_id IS NULL THEN
    -- Record the failed guess (bucketed sliding window).
    INSERT INTO join_attempts (user_id, window_start, attempts)
    VALUES (v_user_id, now(), 1)
    ON CONFLICT (user_id) DO UPDATE SET
      attempts = CASE WHEN join_attempts.window_start > now() - interval '10 minutes'
                      THEN join_attempts.attempts + 1 ELSE 1 END,
      window_start = CASE WHEN join_attempts.window_start > now() - interval '10 minutes'
                          THEN join_attempts.window_start ELSE now() END;
    RETURN jsonb_build_object('success', false, 'error', 'Invalid invite code');
  END IF;

  IF EXISTS (
    SELECT 1 FROM game_members
    WHERE game_id = v_game_id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are already a member of this game');
  END IF;

  -- Lock the game row before the capacity check so concurrent joins (and
  -- approve_join_request, which locks the same row) serialize. The trigger
  -- backstops any path that skips this.
  PERFORM 1 FROM games WHERE id = v_game_id FOR UPDATE;

  IF v_max_players IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_count
    FROM game_members WHERE game_id = v_game_id;
    IF v_current_count >= v_max_players THEN
      RETURN jsonb_build_object('success', false, 'error', 'This game is full');
    END IF;
  END IF;

  INSERT INTO game_members (game_id, user_id)
  VALUES (v_game_id, v_user_id);

  -- Successful join clears the throttle for this user.
  DELETE FROM join_attempts WHERE user_id = v_user_id;

  RETURN jsonb_build_object(
    'success', true, 'game_id', v_game_id, 'game_name', v_game_name
  );
END;
$function$;
