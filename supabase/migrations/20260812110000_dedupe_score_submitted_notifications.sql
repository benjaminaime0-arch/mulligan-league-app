-- ============================================================================
-- notify_score_submitted: dedupe the batch-submit notification storm (#16)
-- ============================================================================
-- trg_score_submitted is AFTER INSERT ON scores FOR EACH ROW. A first-time
-- 4-player batch (submit_match_scores does 4 INSERTs in one txn) fired 4×,
-- each notifying the other 3 → 12 notifications; the per-hole flow repeats the
-- burst when the keeper opens all 4 cards at hole 1. Two more bugs: it named
-- the CARD OWNER (NEW.user_id) as submitter — wrong when one keeper enters
-- everyone's cards — and the keeper self-received N-1 pings (the loop only
-- excluded NEW.user_id, not the real submitter).
--
-- Fix (function body only; trigger unchanged):
--   1. v_submitter := COALESCE(NEW.submitted_by, NEW.user_id) — correct
--      attribution (submit_match_scores/upsert_score_hole both set
--      submitted_by since 2026-08-11) and self-exclusion.
--   2. burst-dedup probe: skip a recipient who already has a score_submitted
--      notification for this match in the last 10 min. Same-transaction row
--      visibility collapses the 4-INSERT batch to exactly 3 notifications;
--      the committed rows from the per-hole flow collapse that burst too.
--      Keyed on (recipient, match) — a second submitter in the window adds no
--      actionable info ("go check the scorecard" was already delivered). Rides
--      the existing (user_id, created_at) index; no schema change.
--   3. game_id/game_name keys + submitted_by in the payload (this body is the
--      deployed post-rename version — the repo's original still said league_*).
--
-- Score EDITS are handled elsewhere (trg_reset_approvals_on_score_edit's
-- "Scores updated" notice), so dropping the AFTER-INSERT storm loses nothing.
--
-- Safe to re-run: OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_score_submitted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_match RECORD;
  v_submitter uuid := COALESCE(NEW.submitted_by, NEW.user_id);
  v_submitter_name TEXT;
  v_player RECORD;
BEGIN
  SELECT m.id, m.course_name, m.game_id, l.name AS game_name
  INTO v_match
  FROM matches m
  LEFT JOIN games l ON l.id = m.game_id
  WHERE m.id = NEW.match_id;

  SELECT COALESCE(p.username, p.first_name, 'Someone') INTO v_submitter_name
  FROM profiles p WHERE p.id = v_submitter;

  FOR v_player IN
    SELECT mp.user_id
    FROM match_players mp
    WHERE mp.match_id = NEW.match_id
      AND mp.user_id <> v_submitter
  LOOP
    -- One notification per recipient per match per burst.
    IF EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = v_player.user_id
        AND n.type = 'score_submitted'
        AND n.data->>'match_id' = NEW.match_id::text
        AND n.created_at > now() - interval '10 minutes'
    ) THEN
      CONTINUE;
    END IF;

    PERFORM create_notification(
      v_player.user_id,
      'score_submitted',
      'Scores submitted',
      v_submitter_name || ' submitted scores for ' || COALESCE(v_match.course_name, 'a match'),
      jsonb_build_object(
        'match_id', NEW.match_id,
        'game_id', v_match.game_id,
        'game_name', v_match.game_name,
        'submitted_by', v_submitter
      )
    );
  END LOOP;
  RETURN NEW;
END;
$function$;
