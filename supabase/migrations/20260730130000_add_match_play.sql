-- ============================================================================
-- Match play & Ryder mode (Phase D, feature 3)
-- ============================================================================
-- Match play needs per-hole data for every side, which Phases A–C provide.
--
--   * games.format gains 'match_play'. The sync_game_format trigger — which
--     force-maps every unknown game_type to stroke_play (the very reason the
--     format was hidden in the UI) — now maps match_play through. Without
--     that trigger fix the new format would be silently destroyed on insert.
--   * Sides: a plain match-play game is singles (exactly 2 players per
--     match). Ryder mode (games.team_mode) splits members into two teams
--     (game_members.team, snapshotted onto match_players.team when a player
--     joins a match); a side's hole score is the BEST net ball among its
--     players who entered that hole. One rule covers singles (side = one
--     player), four-ball (best of two), and by-convention foursome (the
--     pair enters ONE shared card under either partner's name — the only
--     entered ball IS the best ball).
--   * Hole results always compare NET (playing-handicap allocation from
--     Phase C); with no handicaps, net = gross.
--   * Nothing derived is stored: match_play_state() computes per-hole
--     results, running state and early-decision ("3&2") on read.
--   * Leaderboards: singles games rank by match points (win 2 / half 1 /
--     loss 0 — integers, so the existing bigint shape survives; the UI
--     divides by 2 for display) with holes-won as tiebreak.
--     get_ryder_score() aggregates the same per-match results by team.
--
-- Safe to re-run: OR REPLACE / IF NOT EXISTS / dynamic constraint swap.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Format plumbing
-- ---------------------------------------------------------------------------
DO $$
DECLARE c text;
BEGIN
  -- Widen the format CHECK (name varies between environments — find it).
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'public.games'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%format%stroke_play%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.games DROP CONSTRAINT %I', c);
  END IF;
  ALTER TABLE public.games ADD CONSTRAINT games_format_check
    CHECK (format IN ('stroke_play', 'stableford', 'match_play'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Basis is a stroke-aggregation concept; stableford and match_play stay gross.
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_basis_format_coherent;
ALTER TABLE public.games ADD CONSTRAINT games_basis_format_coherent
  CHECK (format NOT IN ('stableford', 'match_play') OR scoring_basis = 'gross');

CREATE OR REPLACE FUNCTION public.sync_game_format()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.game_type = 'stableford' THEN
    NEW.format := 'stableford';
  ELSIF NEW.game_type = 'match_play' THEN
    NEW.format := 'match_play';
  ELSE
    -- Unknown / legacy types still compute as stroke play.
    NEW.format := 'stroke_play';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Teams (Ryder mode)
-- ---------------------------------------------------------------------------
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS team_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS team1_name text,
  ADD COLUMN IF NOT EXISTS team2_name text;
ALTER TABLE public.game_members
  ADD COLUMN IF NOT EXISTS team smallint CHECK (team IN (1, 2));
ALTER TABLE public.match_players
  ADD COLUMN IF NOT EXISTS team smallint CHECK (team IN (1, 2));

-- Admin assigns teams; clients have no direct UPDATE on game_members.
CREATE OR REPLACE FUNCTION public.set_member_team(p_game_id uuid, p_user_id uuid, p_team int)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND admin_id = auth.uid()) THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;
  IF p_team IS NOT NULL AND p_team NOT IN (1, 2) THEN
    RETURN json_build_object('success', false, 'error', 'Team must be 1 or 2');
  END IF;
  UPDATE game_members SET team = p_team
  WHERE game_id = p_game_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Not a member');
  END IF;
  RETURN json_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_member_team(uuid, uuid, int) TO authenticated;

-- Snapshot the member's team when they join a match, so a mid-season
-- re-shuffle never rewrites played matches.
CREATE OR REPLACE FUNCTION public.snapshot_match_player_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.team IS NULL THEN
    SELECT gm.team INTO NEW.team
    FROM matches m
    JOIN game_members gm ON gm.game_id = m.game_id AND gm.user_id = NEW.user_id
    WHERE m.id = NEW.match_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_snapshot_match_player_team ON public.match_players;
CREATE TRIGGER trg_snapshot_match_player_team
  BEFORE INSERT ON public.match_players
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_match_player_team();

-- ---------------------------------------------------------------------------
-- 3. Match-play state (computed on read)
-- ---------------------------------------------------------------------------
-- Sides: team_mode → match_players.team (1 vs 2); singles → the two players
-- in join order. Per hole, a side's score = MIN(strokes − allocated) over
-- its players who entered the hole; holes where a side has no ball are
-- skipped (not conceded — friend-league pragmatism, documented).
-- Early decision when lead > holes remaining on the card.
CREATE OR REPLACE FUNCTION public.match_play_state(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_course uuid;
  v_team_mode boolean;
  v_total_holes int;
  v_a_won int := 0;
  v_b_won int := 0;
  v_halved int := 0;
  v_played int := 0;
  v_decided boolean := false;
  v_final boolean := false;
  v_state text;
  v_lead int;
  v_remaining int;
  v_holes jsonb;
  v_side_a jsonb;
  v_side_b jsonb;
BEGIN
  SELECT COALESCE(m.course_id, g.course_id), COALESCE(g.team_mode, false)
  INTO v_course, v_team_mode
  FROM matches m LEFT JOIN games g ON g.id = m.game_id
  WHERE m.id = p_match_id;

  SELECT count(*)::int INTO v_total_holes FROM course_holes WHERE course_id = v_course;
  IF v_total_holes = 0 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_course_holes');
  END IF;

  -- side assignment: 1/2 by team, else by join order (singles)
  WITH sides AS (
    SELECT mp.user_id,
           CASE
             WHEN v_team_mode THEN mp.team
             ELSE ROW_NUMBER() OVER (ORDER BY mp.joined_at ASC, mp.user_id ASC)::int
           END AS side
    FROM match_players mp
    WHERE mp.match_id = p_match_id
  ),
  side_lists AS (
    SELECT jsonb_agg(user_id) FILTER (WHERE side = 1) AS a,
           jsonb_agg(user_id) FILTER (WHERE side = 2) AS b
    FROM sides
  )
  SELECT a, b INTO v_side_a, v_side_b FROM side_lists;

  IF v_side_a IS NULL OR v_side_b IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'need_two_sides');
  END IF;

  -- per-hole net best-ball per side
  WITH sides AS (
    SELECT mp.user_id,
           CASE
             WHEN v_team_mode THEN mp.team
             ELSE ROW_NUMBER() OVER (ORDER BY mp.joined_at ASC, mp.user_id ASC)::int
           END AS side,
           mp.playing_handicap
    FROM match_players mp
    WHERE mp.match_id = p_match_id
  ),
  balls AS (
    SELECT sd.side, sh.hole_number,
           sh.strokes - COALESCE(al.strokes_received, 0) AS net
    FROM sides sd
    JOIN scores s ON s.match_id = p_match_id AND s.user_id = sd.user_id
    JOIN score_holes sh ON sh.score_id = s.id
    LEFT JOIN allocate_strokes(v_course, COALESCE(sd.playing_handicap, 0)) al
      ON al.hole_number = sh.hole_number
    WHERE sd.side IN (1, 2)
  ),
  per_hole AS (
    SELECT hole_number,
           MIN(net) FILTER (WHERE side = 1) AS a,
           MIN(net) FILTER (WHERE side = 2) AS b
    FROM balls
    GROUP BY hole_number
    HAVING MIN(net) FILTER (WHERE side = 1) IS NOT NULL
       AND MIN(net) FILTER (WHERE side = 2) IS NOT NULL
    ORDER BY hole_number
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'n', hole_number,
      'winner', CASE WHEN a < b THEN 1 WHEN b < a THEN 2 ELSE 0 END
    ) ORDER BY hole_number), '[]'::jsonb),
    COALESCE(count(*) FILTER (WHERE a < b), 0),
    COALESCE(count(*) FILTER (WHERE b < a), 0),
    COALESCE(count(*) FILTER (WHERE a = b), 0),
    COALESCE(count(*), 0)
  INTO v_holes, v_a_won, v_b_won, v_halved, v_played
  FROM per_hole;

  v_lead := abs(v_a_won - v_b_won);
  v_remaining := v_total_holes - v_played;
  v_decided := v_lead > v_remaining AND v_played > 0;
  v_final := v_decided OR (v_played = v_total_holes AND v_played > 0);

  -- Classic notation: decided early → "3&2"; finished level → "AS";
  -- otherwise "N UP" (running) with remaining count alongside.
  IF v_played = 0 THEN
    v_state := NULL;
  ELSIF v_decided AND v_remaining > 0 THEN
    v_state := v_lead::text || '&' || v_remaining::text;
  ELSIF v_lead = 0 THEN
    v_state := 'AS';
  ELSE
    v_state := v_lead::text || ' UP';
  END IF;

  RETURN jsonb_build_object(
    'available', true,
    'team_mode', v_team_mode,
    'side_a', v_side_a,
    'side_b', v_side_b,
    'holes', v_holes,
    'a_won', v_a_won,
    'b_won', v_b_won,
    'halved', v_halved,
    'thru', v_played,
    'remaining', v_remaining,
    'leader', CASE WHEN v_a_won > v_b_won THEN 1 WHEN v_b_won > v_a_won THEN 2 ELSE 0 END,
    'decided', v_decided,
    'final', v_final,
    'state', v_state
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.match_play_state(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Leaderboards
-- ---------------------------------------------------------------------------
-- Singles match-play games rank by match points. Reuses the v3 board's
-- shape: total_score = 2×win + 1×half (integers — UI shows /2),
-- best_score = holes won across counted matches (the tiebreak, surfaced).
-- Only completed matches with a computable, final state count.
CREATE OR REPLACE FUNCTION public.get_match_play_board(p_game_id uuid)
RETURNS TABLE (
  user_id uuid,
  match_points bigint,
  holes_won bigint,
  matches_played bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH finals AS (
    SELECT m.id, match_play_state(m.id) AS st
    FROM matches m
    WHERE m.game_id = p_game_id AND m.status = 'completed'
  ),
  usable AS (
    SELECT * FROM finals
    WHERE (st->>'available')::boolean AND (st->>'final')::boolean
      AND NOT (SELECT COALESCE(g.team_mode, false) FROM games g WHERE g.id = p_game_id)
  ),
  results AS (
    SELECT u.id,
           (u.st->'side_a'->>0)::uuid AS a,
           (u.st->'side_b'->>0)::uuid AS b,
           (u.st->>'a_won')::int AS a_won,
           (u.st->>'b_won')::int AS b_won,
           (u.st->>'leader')::int AS leader
    FROM usable u
  ),
  per_player AS (
    SELECT r.a AS uid,
           CASE r.leader WHEN 1 THEN 2 WHEN 0 THEN 1 ELSE 0 END AS pts,
           r.a_won AS won
    FROM results r
    UNION ALL
    SELECT r.b,
           CASE r.leader WHEN 2 THEN 2 WHEN 0 THEN 1 ELSE 0 END,
           r.b_won
    FROM results r
  )
  SELECT uid, SUM(pts)::bigint, SUM(won)::bigint, COUNT(*)::bigint
  FROM per_player
  GROUP BY uid;
$$;
GRANT EXECUTE ON FUNCTION public.get_match_play_board(uuid) TO authenticated;

-- Team scoreboard for Ryder games — same per-match results, aggregated by
-- side. Sides ARE teams in team_mode, so side_a points belong to team 1.
CREATE OR REPLACE FUNCTION public.get_ryder_score(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_game record;
  v_t1 numeric := 0;
  v_t2 numeric := 0;
  v_matches jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF NOT is_game_member(p_game_id, v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Members only');
  END IF;
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT COALESCE(v_game.team_mode, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a team game');
  END IF;

  FOR r IN
    SELECT m.id, m.match_date, match_play_state(m.id) AS st
    FROM matches m
    WHERE m.game_id = p_game_id AND m.status = 'completed'
    ORDER BY m.match_date, m.id
  LOOP
    IF (r.st->>'available')::boolean AND (r.st->>'final')::boolean THEN
      IF (r.st->>'leader')::int = 1 THEN v_t1 := v_t1 + 1;
      ELSIF (r.st->>'leader')::int = 2 THEN v_t2 := v_t2 + 1;
      ELSE v_t1 := v_t1 + 0.5; v_t2 := v_t2 + 0.5;
      END IF;
      v_matches := v_matches || jsonb_build_object(
        'match_id', r.id, 'date', r.match_date,
        'state', r.st->>'state', 'leader', (r.st->>'leader')::int
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'team1', jsonb_build_object('name', COALESCE(v_game.team1_name, 'Équipe 1'), 'points', v_t1),
    'team2', jsonb_build_object('name', COALESCE(v_game.team2_name, 'Équipe 2'), 'points', v_t2),
    'matches', v_matches
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_ryder_score(uuid) TO authenticated;

-- get_leaderboard: route match_play games to the match-points board while
-- keeping the exact return shape every consumer already binds to.
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
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN b.rounds_counted > 0 THEN 0 ELSE 1 END,
        CASE WHEN v_desc THEN -b.total_score ELSE b.total_score END ASC,
        p.username ASC NULLS LAST,
        b.user_id ASC
    )::bigint,
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
    CASE WHEN b.rounds_counted > 0 THEN 0 ELSE 1 END,
    CASE WHEN v_desc THEN -b.total_score ELSE b.total_score END ASC,
    p.username ASC NULLS LAST,
    b.user_id ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. create_game: match_play requires a course with hole data; team mode
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_game(text, text, integer, date, date, integer, integer, text, uuid, text);
CREATE OR REPLACE FUNCTION public.create_game(p_name text, p_course_name text, p_max_players integer, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_scoring_cards integer DEFAULT NULL::integer, p_total_cards integer DEFAULT NULL::integer, p_game_type text DEFAULT 'stroke_play'::text, p_course_id uuid DEFAULT NULL::uuid, p_scoring_basis text DEFAULT 'gross'::text, p_team_mode boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_game_id UUID;
  v_invite_code TEXT;
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Match play compares hole by hole — a card-less course can't host it.
  IF p_game_type = 'match_play' AND (
    p_course_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM course_holes WHERE course_id = p_course_id
    )
  ) THEN
    RETURN json_build_object('success', false, 'error', 'match_play_needs_course_holes');
  END IF;
  IF p_team_mode AND p_game_type <> 'match_play' THEN
    RETURN json_build_object('success', false, 'error', 'team_mode_needs_match_play');
  END IF;

  INSERT INTO public.games (
    name, course_name, course_id, admin_id, max_players, game_type,
    start_date, end_date, scoring_cards_count, total_cards_count,
    scoring_basis, team_mode
  )
  VALUES (
    p_name, p_course_name, p_course_id, v_user_id, p_max_players,
    COALESCE(p_game_type, 'stroke_play'), p_start_date, p_end_date,
    p_scoring_cards, p_total_cards,
    CASE WHEN p_game_type IN ('stableford', 'match_play') THEN 'gross'
         ELSE COALESCE(p_scoring_basis, 'gross') END,
    COALESCE(p_team_mode, false)
  )
  RETURNING id, invite_code INTO v_game_id, v_invite_code;

  RETURN json_build_object(
    'success', true,
    'game_id', v_game_id,
    'invite_code', v_invite_code
  );
EXCEPTION
  WHEN foreign_key_violation THEN
    RETURN json_build_object('success', false, 'error', 'Unknown course');
  WHEN check_violation THEN
    RETURN json_build_object('success', false, 'error', 'Invalid scoring configuration');
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_game(text, text, integer, date, date, integer, integer, text, uuid, text, boolean) TO authenticated;

-- ============================================================================
-- Verification (run manually):
--   SELECT match_play_state('<match>');
--   SELECT * FROM get_leaderboard('<match_play game>');
--   SELECT get_ryder_score('<team game>');
-- ============================================================================
