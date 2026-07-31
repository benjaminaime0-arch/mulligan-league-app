-- ============================================================================
-- Live scoring (Phase E, feature 4): realtime publication + match_live ping
-- ============================================================================
-- FIXES A PRE-EXISTING PROD BUG while it's here: the game workspace has
-- subscribed to postgres_changes on scores+matches since T0.5, but the
-- supabase_realtime publication contained NO tables — every "realtime"
-- subscription in the app has been silently dead. Adding the tables makes
-- the existing code work as designed; score_holes joins them so hole-by-hole
-- entry streams to every open scorecard.
--
-- Authorization: postgres_changes respects RLS — a client only receives
-- rows its SELECT policies allow, which for score_holes is exactly
-- user_can_see_match (Phase B) and for scores/matches the existing member
-- policies. No new policy needed, no broadcast keys involved.
--
-- match_live: one in-app notification to the other game members when the
-- FIRST hole score of a match lands. In-app rows are always created (the
-- prefs model gates only OS push, via should_send_push in /api/push);
-- match_live is registered in the client prefs UI like every other type.
--
-- Safe to re-run: guarded ALTER PUBLICATION + OR REPLACE.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['scores', 'matches', 'score_holes', 'match_players'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- match_live notification: first hole of a match wakes the game
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_match_live()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_match_id uuid;
  v_game_id uuid;
  v_writer uuid;
  v_writer_name text;
  v_course text;
  v_member record;
BEGIN
  SELECT s.match_id INTO v_match_id FROM scores s WHERE s.id = NEW.score_id;

  -- Only the very first hole entry of the whole match fires the ping.
  IF (SELECT count(*)
      FROM score_holes sh JOIN scores s ON s.id = sh.score_id
      WHERE s.match_id = v_match_id) <> 1 THEN
    RETURN NEW;
  END IF;

  SELECT m.game_id, COALESCE(m.course_name, g.course_name, 'le parcours'),
         s.submitted_by
  INTO v_game_id, v_course, v_writer
  FROM matches m
  LEFT JOIN games g ON g.id = m.game_id
  LEFT JOIN scores s ON s.id = NEW.score_id
  WHERE m.id = v_match_id;

  IF v_game_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.username, p.first_name, 'Un joueur') INTO v_writer_name
  FROM profiles p WHERE p.id = v_writer;

  FOR v_member IN
    SELECT gm.user_id FROM game_members gm
    WHERE gm.game_id = v_game_id AND gm.user_id IS DISTINCT FROM v_writer
  LOOP
    PERFORM create_notification(
      v_member.user_id,
      'match_live',
      'Match en direct',
      v_writer_name || ' a commencé la carte sur ' || v_course,
      jsonb_build_object('match_id', v_match_id, 'game_id', v_game_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_match_live ON public.score_holes;
CREATE TRIGGER trg_notify_match_live
  AFTER INSERT ON public.score_holes
  FOR EACH ROW EXECUTE FUNCTION public.notify_match_live();

-- ============================================================================
-- Verification (run manually):
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime';   -- 4 public tables
--   -- first upsert_score_hole on a fresh match → notifications rows for
--   -- every other game member, type 'match_live'.
-- ============================================================================
