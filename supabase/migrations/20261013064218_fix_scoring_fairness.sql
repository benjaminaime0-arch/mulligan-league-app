-- Scoring fairness: format-aware Elo, complete scorecards, qualified standings.
-- Historical ratings are not rewritten; new matches use the corrected result.
ALTER TABLE public.scores ADD COLUMN has_hole_detail boolean NOT NULL DEFAULT false;
-- This is a metadata backfill, not a player edit. Suppress user triggers for
-- this locked transaction so old cards do not reset match activity or resend
-- Airtable notifications. Restore each trigger's original enabled mode.
DO $backfill$
DECLARE triggers jsonb; item jsonb;
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('name',tgname,'mode',tgenabled)),'[]'::jsonb)
 INTO triggers FROM pg_trigger WHERE tgrelid='public.scores'::regclass AND NOT tgisinternal AND tgenabled<>'D';
 FOR item IN SELECT value FROM jsonb_array_elements(triggers) LOOP
  EXECUTE format('ALTER TABLE public.scores DISABLE TRIGGER %I',item->>'name');
 END LOOP;
 UPDATE public.scores s SET has_hole_detail=true
 WHERE EXISTS(SELECT 1 FROM public.score_holes h WHERE h.score_id=s.id);
 FOR item IN SELECT value FROM jsonb_array_elements(triggers) LOOP
  EXECUTE format('ALTER TABLE public.scores ENABLE %s TRIGGER %I',
   CASE item->>'mode' WHEN 'A' THEN 'ALWAYS' WHEN 'R' THEN 'REPLICA' ELSE '' END,item->>'name');
 END LOOP;
END $backfill$;

-- Remember hole entry even if the player clears every hole. An erased card
-- must not silently become an aggregate card with its last cached total.
CREATE OR REPLACE FUNCTION public.mark_hole_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE scores SET has_hole_detail = true WHERE id = NEW.score_id AND NOT has_hole_detail;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_mark_hole_entry BEFORE INSERT ON public.score_holes
FOR EACH ROW EXECUTE FUNCTION public.mark_hole_entry();
REVOKE ALL ON FUNCTION public.mark_hole_entry() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.scorecard_is_complete(p_score_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT COALESCE((
   SELECT CASE
     -- Match play may finish before the last hole (e.g. 5&4). Only a
     -- mathematically final result on consecutively played holes qualifies.
     WHEN g.format = 'match_play' THEN EXISTS (
       SELECT 1 FROM (SELECT match_play_state(s.match_id) AS state) mp
       WHERE COALESCE((mp.state->>'final')::boolean,false)
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(mp.state->'holes') WITH ORDINALITY h(value,n)
           WHERE (h.value->>'n')::int <> h.n
         )
     )
     WHEN NOT s.has_hole_detail THEN s.holes IN (9,18)
     ELSE s.holes IN (9,18)
       AND (SELECT count(*) FROM score_holes h WHERE h.score_id=s.id) = s.holes
       AND NOT EXISTS (SELECT 1 FROM score_holes h WHERE h.score_id=s.id
                       AND h.hole_number NOT BETWEEN 1 AND s.holes)
   END FROM scores s JOIN matches m ON m.id=s.match_id
       JOIN games g ON g.id=m.game_id WHERE s.id=p_score_id
 ), false);
$$;
REVOKE ALL ON FUNCTION public.scorecard_is_complete(uuid) FROM PUBLIC, anon, authenticated;

-- Defense at the status transition covers peer, captain, cron and direct writes.
CREATE OR REPLACE FUNCTION public.require_complete_scorecard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND NOT scorecard_is_complete(NEW.id) THEN
    RAISE EXCEPTION 'Complete every hole before approving this card.' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_require_complete_scorecard BEFORE UPDATE OF status ON public.scores
FOR EACH ROW WHEN (NEW.status = 'approved') EXECUTE FUNCTION public.require_complete_scorecard();
REVOKE ALL ON FUNCTION public.require_complete_scorecard() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.approve_match_scores(p_match_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_player_count INT;
  v_approved_count INT;
BEGIN
  -- Verify caller is a player in this match
  IF NOT EXISTS (
    SELECT 1 FROM match_players
    WHERE match_id = p_match_id AND user_id = v_user_id
  ) THEN
    RETURN json_build_object('success', false, 'error', 'You are not a player in this match.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM scores WHERE match_id = p_match_id)
     OR EXISTS (SELECT 1 FROM scores WHERE match_id = p_match_id
                AND NOT scorecard_is_complete(id)) THEN
    RETURN json_build_object('success', false, 'error', 'Complete every hole before approving this card.');
  END IF;

  -- Mark this player as having approved
  UPDATE match_players
  SET approved_at = now()
  WHERE match_id = p_match_id AND user_id = v_user_id;

  -- Check if all players have now approved
  SELECT count(*), count(approved_at)
  INTO v_player_count, v_approved_count
  FROM match_players
  WHERE match_id = p_match_id;

  -- If all approved, mark all scores as official
  IF v_approved_count = v_player_count THEN
    UPDATE scores
    SET status = 'approved'
    WHERE match_id = p_match_id;

    -- Optionally mark match as completed
    UPDATE matches
    SET status = 'completed'
    WHERE id = p_match_id AND status = 'scheduled';
  END IF;

  RETURN json_build_object(
    'success', true,
    'approved_count', v_approved_count,
    'player_count', v_player_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_match_scores(p_match_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_match matches%ROWTYPE;
  v_is_captain boolean;
  v_player_count int;
  v_scored_count int;
  v_idle boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF v_match.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Match not found');
  END IF;
  IF v_match.status IN ('completed', 'cancelled') THEN
    RETURN json_build_object('success', false, 'error', 'Match is closed.');
  END IF;

  SELECT (v_match.created_by = v_caller) OR EXISTS (
    SELECT 1 FROM games g WHERE g.id = v_match.game_id AND g.admin_id = v_caller
  ) INTO v_is_captain;
  IF NOT v_is_captain THEN
    RETURN json_build_object('success', false, 'error', 'Only the game admin or match creator can finalize.');
  END IF;

  SELECT count(*), count(s.id)
  INTO v_player_count, v_scored_count
  FROM match_players mp
  LEFT JOIN scores s ON s.match_id = mp.match_id AND s.user_id = mp.user_id
  WHERE mp.match_id = p_match_id;

  IF v_scored_count = 0 THEN
    RETURN json_build_object('success', false, 'error', 'No scores to finalize.');
  END IF;

  v_idle := COALESCE(v_match.last_edit_at, v_match.created_at) < now() - interval '2 hours';
  IF v_scored_count < v_player_count AND NOT v_idle THEN
    RETURN json_build_object('success', false, 'error', 'Wait for every card, or for 2 hours of inactivity.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM scores WHERE match_id = p_match_id)
     OR EXISTS (SELECT 1 FROM scores WHERE match_id = p_match_id
                AND NOT scorecard_is_complete(id)) THEN
    RETURN json_build_object('success', false, 'error', 'Complete every hole before approving this card.');
  END IF;

  -- Same sanctioned lane as the 24h crons for the cascading writes.
  PERFORM set_config('mulligan.system_update', 'on', true);

  UPDATE scores
  SET status = 'approved', approved_by = v_caller, approved_at = now()
  WHERE match_id = p_match_id AND status = 'pending';

  UPDATE match_players
  SET approved_at = now()
  WHERE match_id = p_match_id AND approved_at IS NULL;

  UPDATE matches
  SET status = 'completed'
  WHERE id = p_match_id AND status IN ('scheduled', 'in_progress');

  -- Drop the system lane before returning: set_config(..., true) lives to
  -- the END OF THE TRANSACTION, not the function — leaving it on would
  -- disable the score lock for whatever else runs in the caller's
  -- transaction (and did exactly that in the single-transaction test file).
  PERFORM set_config('mulligan.system_update', 'off', true);

  RETURN json_build_object(
    'success', true,
    'player_count', v_player_count,
    'scored_count', v_scored_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_approve_stale_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
BEGIN
  -- Transaction-local: honoured by enforce_match_creator_field_immutability
  PERFORM set_config('mulligan.system_update', 'on', true);

  FOR v_match IN
    SELECT DISTINCT s.match_id
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE s.status = 'pending'
      AND NOT EXISTS (SELECT 1 FROM scores other WHERE other.match_id = s.match_id
                      AND NOT scorecard_is_complete(other.id))
      -- 24h of no activity on the match, not 24h since first submission:
      -- last_edit_at bumps on every score insert/update/delete, so an edit
      -- restarts the confirmation window (scores.created_at never changes
      -- on re-submission). NULL last_edit_at = pre-column match; fall back.
      AND COALESCE(m.last_edit_at, s.created_at) < now() - interval '24 hours'
  LOOP
    -- The whole match auto-validates as a unit (existing product semantic):
    -- approved_by stays NULL, which is the marker for "validated by time,
    -- not by a peer".
    UPDATE scores
    SET status = 'approved', approved_at = now()
    WHERE match_id = v_match.match_id AND status = 'pending';

    UPDATE match_players
    SET approved_at = now()
    WHERE match_id = v_match.match_id AND approved_at IS NULL;

    UPDATE matches
    SET status = 'completed'
    WHERE id = v_match.match_id AND status IN ('scheduled', 'in_progress');
  END LOOP;
  PERFORM set_config('mulligan.system_update', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_complete_stale_matches()
RETURNS TABLE (completed_match_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('mulligan.system_update', 'on', true);

  RETURN QUERY
  UPDATE matches m
  SET status = 'completed'
  WHERE m.status IN ('scheduled', 'in_progress')
    AND m.last_edit_at IS NOT NULL
    AND m.last_edit_at < now() - interval '24 hours'
    AND EXISTS (
      SELECT 1 FROM scores s WHERE s.match_id = m.id
    )
    AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.match_id=m.id
                    AND NOT scorecard_is_complete(s.id))
    AND NOT EXISTS (SELECT 1 FROM scores s WHERE s.match_id=m.id AND s.status <> 'approved')
  RETURNING m.id;
  PERFORM set_config('mulligan.system_update', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rate_match(p_match_id uuid)
RETURNS int  -- players whose rating moved (0 = skipped/no pairs)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pair record;
  v_format text;
  v_basis text;
  v_desc boolean;
  v_deltas jsonb := '{}'::jsonb;
  v_count int := 0;
  v_ra numeric; v_rb numeric;
  v_ea numeric; v_sa numeric;
  v_da numeric;
BEGIN
  -- Idempotency guard: a match rates once, ever.
  IF EXISTS (SELECT 1 FROM rating_history WHERE match_id = p_match_id) THEN
    RETURN 0;
  END IF;
  IF (SELECT status FROM matches WHERE id = p_match_id) IS DISTINCT FROM 'completed' THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(g.format,'stroke_play'), COALESCE(g.scoring_basis,'gross')
  INTO v_format, v_basis FROM matches m JOIN games g ON g.id=m.game_id
  WHERE m.id=p_match_id;
  -- Legacy Stableford cards already store points. Never subtract handicap
  -- from points. Net Stableford cards derive points from per-hole strokes.
  IF v_format='stableford' THEN v_basis := 'gross'; END IF;
  v_desc := v_format='stableford' OR v_basis='stableford_net';

  -- Accumulate per-player deltas across every approved pair, all computed
  -- against PRE-match ratings (standard multi-opponent treatment).
  FOR v_pair IN
    SELECT a.user_id AS ua, b.user_id AS ub,
           round_basis_score(a.id, CASE WHEN v_format='match_play' THEN 'net' ELSE v_basis END) AS na,
           round_basis_score(b.id, CASE WHEN v_format='match_play' THEN 'net' ELSE v_basis END) AS nb
    FROM scores a
    JOIN scores b ON b.match_id = a.match_id AND b.user_id > a.user_id
    WHERE a.match_id = p_match_id
      AND a.status = 'approved' AND b.status = 'approved'
      AND scorecard_is_complete(a.id) AND scorecard_is_complete(b.id)
      AND a.holes = b.holes
  LOOP
    SELECT COALESCE((SELECT rating FROM player_ratings WHERE user_id = v_pair.ua), 1000) INTO v_ra;
    SELECT COALESCE((SELECT rating FROM player_ratings WHERE user_id = v_pair.ub), 1000) INTO v_rb;
    v_ea := 1 / (1 + power(10, (v_rb - v_ra) / 400.0));
    IF v_pair.na IS NULL OR v_pair.nb IS NULL THEN CONTINUE; END IF;
    v_sa := CASE WHEN (v_desc AND v_pair.na > v_pair.nb)
                       OR (NOT v_desc AND v_pair.na < v_pair.nb) THEN 1
                 WHEN v_pair.na = v_pair.nb THEN 0.5
                 ELSE 0 END;
    v_da := 32 * (v_sa - v_ea);
    v_deltas := jsonb_set(v_deltas, ARRAY[v_pair.ua::text],
      to_jsonb(COALESCE((v_deltas->>v_pair.ua::text)::numeric, 0) + v_da));
    v_deltas := jsonb_set(v_deltas, ARRAY[v_pair.ub::text],
      to_jsonb(COALESCE((v_deltas->>v_pair.ub::text)::numeric, 0) - v_da));
  END LOOP;

  IF v_deltas = '{}'::jsonb THEN
    RETURN 0;
  END IF;

  -- Apply: seed missing rows at 1000, journal, move.
  DECLARE
    v_uid uuid;
    v_delta numeric;
    v_before numeric;
    k text;
  BEGIN
    FOR k IN SELECT jsonb_object_keys(v_deltas) LOOP
      v_uid := k::uuid;
      v_delta := (v_deltas->>k)::numeric;
      INSERT INTO player_ratings (user_id) VALUES (v_uid)
      ON CONFLICT (user_id) DO NOTHING;
      SELECT rating INTO v_before FROM player_ratings WHERE user_id = v_uid;
      INSERT INTO rating_history (user_id, match_id, rating_before, rating_after)
      VALUES (v_uid, p_match_id, round(v_before, 1), round(v_before + v_delta, 1));
      UPDATE player_ratings
      SET rating = round(rating + v_delta, 1),
          matches_rated = matches_rated + 1,
          updated_at = now()
      WHERE user_id = v_uid;
      v_count := v_count + 1;
    END LOOP;
  END;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION get_leaderboard(p_game_id uuid)
RETURNS TABLE (
  "position" bigint,
  user_id uuid,
  player_name text,
  avatar_url text,
  best_score bigint,
  total_score bigint,
  rounds_counted bigint,
  rounds_played bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scoring_cards int;
  v_total_cards   int;
  v_format        text;
  v_basis         text;
  v_desc          boolean;
  v_caller        uuid := auth.uid();
  v_role          text := current_setting('request.jwt.claim.role', true);
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF v_caller IS NULL THEN RETURN; END IF;
    IF NOT is_game_member(p_game_id, v_caller) THEN RETURN; END IF;
  END IF;

  SELECT
    g.scoring_cards_count,
    g.total_cards_count,
    COALESCE(g.format, 'stroke_play'),
    COALESCE(g.scoring_basis, 'gross')
  INTO v_scoring_cards, v_total_cards, v_format, v_basis
  FROM games g
  WHERE g.id = p_game_id;

  IF v_format = 'match_play' THEN
    -- Match points, halves as 1 (UI divides by 2); holes won breaks ties.
    RETURN QUERY
    WITH board AS (
      SELECT gm.user_id AS uid,
             COALESCE(b.match_points, 0)   AS pts,
             COALESCE(b.holes_won, 0)      AS won,
             COALESCE(b.matches_played, 0) AS played
      FROM game_members gm
      LEFT JOIN get_match_play_board(p_game_id) b ON b.user_id = gm.user_id
      WHERE gm.game_id = p_game_id
    )
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN board.played > 0 THEN 0 ELSE 1 END,
          board.pts DESC, board.won DESC,
          p.username ASC NULLS LAST, board.uid ASC
      )::bigint,
      board.uid,
      COALESCE(p.username, p.first_name, 'Player')::text,
      p.avatar_url::text,
      board.won::bigint,      -- best_score column carries the tiebreak
      board.pts::bigint,
      board.played::bigint,
      board.played::bigint
    FROM board
    JOIN profiles p ON p.id = board.uid
    ORDER BY
      CASE WHEN board.played > 0 THEN 0 ELSE 1 END,
      board.pts DESC, board.won DESC,
      p.username ASC NULLS LAST, board.uid ASC;
    RETURN;
  END IF;

  v_desc := (v_format = 'stableford' OR v_basis = 'stableford_net');

  RETURN QUERY
  WITH approved_scores AS (
    SELECT
      s.id,
      s.user_id,
      round_basis_score(s.id, v_basis) AS score,
      m.match_date,
      s.created_at
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE m.game_id = p_game_id
      AND s.status  = 'approved'
      AND scorecard_is_complete(s.id)
  ),
  usable AS (
    SELECT * FROM approved_scores a WHERE a.score IS NOT NULL
  ),
  chrono AS (
    SELECT
      u.id,
      u.user_id,
      u.score,
      ROW_NUMBER() OVER (
        PARTITION BY u.user_id
        ORDER BY u.match_date ASC NULLS LAST, u.created_at ASC, u.id ASC
      ) AS chrono_rn
    FROM usable u
  ),
  eligible AS (
    SELECT c.user_id, c.score
    FROM chrono c
    WHERE v_total_cards IS NULL OR c.chrono_rn <= v_total_cards
  ),
  ranked AS (
    SELECT
      e.user_id,
      e.score,
      ROW_NUMBER() OVER (
        PARTITION BY e.user_id
        ORDER BY CASE WHEN v_desc THEN -e.score ELSE e.score END ASC
      ) AS rn,
      COUNT(*) OVER (PARTITION BY e.user_id) AS eligible_count
    FROM eligible e
  ),
  player_totals AS (
    SELECT
      r.user_id,
      CASE WHEN v_desc THEN MAX(r.score) ELSE MIN(r.score) END AS best_score,
      SUM(r.score)::bigint            AS total_score,
      COUNT(*)::bigint                AS rounds_counted,
      MAX(r.eligible_count)::bigint   AS rounds_played
    FROM ranked r
    WHERE v_scoring_cards IS NULL OR r.rn <= v_scoring_cards
    GROUP BY r.user_id
  ),
  board AS (
    SELECT
      gm.user_id,
      pt.best_score::bigint                  AS best_score,
      COALESCE(pt.total_score, 0)::bigint    AS total_score,
      COALESCE(pt.rounds_counted, 0)::bigint AS rounds_counted,
      COALESCE(pt.rounds_played, 0)::bigint  AS rounds_played
    FROM game_members gm
    LEFT JOIN player_totals pt ON pt.user_id = gm.user_id
    WHERE gm.game_id = p_game_id
  )
  SELECT
    CASE WHEN b.rounds_counted >= COALESCE(v_scoring_cards, 1) THEN
      RANK() OVER (ORDER BY
        CASE WHEN b.rounds_counted >= COALESCE(v_scoring_cards,1) THEN 0 ELSE 1 END,
        CASE WHEN v_desc THEN -b.total_score ELSE b.total_score END ASC
      )::bigint ELSE NULL END,
    b.user_id,
    COALESCE(p.username, p.first_name, 'Player')::text,
    p.avatar_url::text,
    b.best_score,
    b.total_score,
    b.rounds_counted,
    b.rounds_played
  FROM board b
  JOIN profiles p ON p.id = b.user_id
  ORDER BY
    CASE WHEN b.rounds_counted >= COALESCE(v_scoring_cards,1) THEN 0 ELSE 1 END,
    CASE WHEN v_desc THEN -b.total_score ELSE b.total_score END ASC,
    p.username ASC NULLS LAST,
    b.user_id ASC;
END;
$$;
