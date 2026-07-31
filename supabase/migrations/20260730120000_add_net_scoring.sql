-- ============================================================================
-- Handicap & net scoring (Phase C, feature 2)
-- ============================================================================
-- Friend-league handicap model — deliberately NOT WHS certification:
--   * profiles.handicap (integer, self-declared, 0..54, already editable on
--     /profile) is the only input.
--   * Playing handicap is SNAPSHOTTED per (match, player) into
--     match_players.playing_handicap the first time a score row appears for
--     them (aggregate or per-hole entry both create one), so later profile
--     edits never rewrite history: LEAST(36, handicap), halved+rounded for
--     9-hole rounds. Clamped at 0 — plus-handicap golfers give no strokes
--     back in v1.
--   * Stroke allocation (allocate_strokes): the standard method over the
--     course card's published stroke indexes; courses without (or with
--     contradictory → nulled) indexes fall back to par-desc, hole-number-asc
--     — deterministic, documented, test-asserted.
--   * Nothing derived is stored: net and Stableford points are computed on
--     read from score_holes + course_holes + the snapshot.
--
-- games.scoring_basis ('gross' default | 'net' | 'stableford_net') decides
-- what the leaderboard aggregates. Basis applies to stroke_play games only —
-- a stableford game already IS points (CHECK below). stableford_net rounds
-- need hole data; rounds without it are excluded from that leaderboard
-- (an aggregate integer cannot yield per-hole points honestly).
--
-- Safe to re-run: IF NOT EXISTS / OR REPLACE throughout.
-- ============================================================================

ALTER TABLE public.match_players
  ADD COLUMN IF NOT EXISTS playing_handicap smallint;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS scoring_basis text NOT NULL DEFAULT 'gross';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.games'::regclass AND conname = 'games_scoring_basis_check'
  ) THEN
    ALTER TABLE public.games ADD CONSTRAINT games_scoring_basis_check
      CHECK (scoring_basis IN ('gross', 'net', 'stableford_net'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.games'::regclass AND conname = 'games_basis_format_coherent'
  ) THEN
    ALTER TABLE public.games ADD CONSTRAINT games_basis_format_coherent
      CHECK (format IS DISTINCT FROM 'stableford' OR scoring_basis = 'gross');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Playing-handicap snapshot: first score row freezes it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.freeze_playing_handicap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE match_players mp
  SET playing_handicap = CASE
    WHEN NEW.holes = 9
      THEN ROUND(LEAST(36, GREATEST(0, p.handicap))::numeric / 2)::smallint
    ELSE LEAST(36, GREATEST(0, p.handicap))::smallint
  END
  FROM profiles p
  WHERE mp.match_id = NEW.match_id
    AND mp.user_id  = NEW.user_id
    AND mp.playing_handicap IS NULL
    AND p.id = NEW.user_id
    AND p.handicap IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_playing_handicap ON public.scores;
CREATE TRIGGER trg_freeze_playing_handicap
  AFTER INSERT ON public.scores
  FOR EACH ROW EXECUTE FUNCTION public.freeze_playing_handicap();

-- ---------------------------------------------------------------------------
-- Stroke allocation over a course card
-- ---------------------------------------------------------------------------
-- Effective index = published hcp_index order when available, else par-desc /
-- hole-number-asc. ROW_NUMBER gives a dense 1..n rank either way, so the
-- arithmetic below works for 9- and 18-hole cards and for playing handicaps
-- above one-lap coverage (base + remainder):
--   strokes = floor(php / n) + (rank <= php % n ? 1 : 0)
--   php=20, n=18 → every hole 1, ranks 1..2 get a second stroke.
CREATE OR REPLACE FUNCTION public.allocate_strokes(p_course_id uuid, p_playing_handicap int)
RETURNS TABLE (hole_number smallint, strokes_received int)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH card AS (
    SELECT
      ch.hole_number,
      ROW_NUMBER() OVER (
        ORDER BY ch.hcp_index ASC NULLS LAST, ch.par DESC, ch.hole_number ASC
      ) AS eff_rank,
      COUNT(*) OVER () AS n
    FROM course_holes ch
    WHERE ch.course_id = p_course_id
  )
  SELECT
    card.hole_number,
    CASE
      WHEN COALESCE(p_playing_handicap, 0) <= 0 THEN 0
      ELSE (p_playing_handicap / card.n)::int
           + CASE WHEN card.eff_rank <= p_playing_handicap % card.n THEN 1 ELSE 0 END
    END AS strokes_received
  FROM card
  ORDER BY card.hole_number;
$$;

GRANT EXECUTE ON FUNCTION public.allocate_strokes(uuid, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- Per-round result on the game's basis (single source for leaderboard math)
-- ---------------------------------------------------------------------------
-- gross: scores.score.
-- net: gross − playing handicap (full-round arithmetic; identical to the
--      hole-by-hole net sum on a complete card, and the honest fallback for
--      aggregate-only rounds). NULL handicap → net = gross.
-- stableford points: per hole, from net vs par:
--      points = max(0, 2 − (net − par)) — par 2, birdie 3, eagle 4, bogey 1.
--      NULL when the round has no hole data or the course no card.
CREATE OR REPLACE FUNCTION public.round_basis_score(p_score_id uuid, p_basis text)
RETURNS int
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p_basis = 'gross' THEN s.score
    WHEN p_basis = 'net' THEN s.score - COALESCE(mp.playing_handicap, 0)
    WHEN p_basis = 'stableford_net' THEN (
      SELECT SUM(GREATEST(0, 2 - ((sh.strokes - al.strokes_received) - ch.par)))::int
      FROM score_holes sh
      JOIN course_holes ch
        ON ch.course_id = COALESCE(m.course_id, g2.course_id)
       AND ch.hole_number = sh.hole_number
      JOIN allocate_strokes(COALESCE(m.course_id, g2.course_id),
                            COALESCE(mp.playing_handicap, 0)) al
        ON al.hole_number = sh.hole_number
      WHERE sh.score_id = s.id
    )
    ELSE s.score
  END
  FROM scores s
  JOIN matches m ON m.id = s.match_id
  LEFT JOIN games g2 ON g2.id = m.game_id
  LEFT JOIN match_players mp
    ON mp.match_id = s.match_id AND mp.user_id = s.user_id
  WHERE s.id = p_score_id;
$$;

GRANT EXECUTE ON FUNCTION public.round_basis_score(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Leaderboard v3: basis-aware
-- ---------------------------------------------------------------------------
-- Same shape, same chronological total_cards cap, same member gate as the
-- format-aware revision (20260511133014). Two changes:
--   * each round's contributing value goes through round_basis_score();
--     stableford_net rounds without hole data yield NULL and are excluded.
--   * "higher is better" now covers stableford format OR stableford_net
--     basis; net keeps stroke-play direction.
DROP FUNCTION IF EXISTS get_leaderboard(uuid);

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
  v_desc          boolean;  -- true = higher is better
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
    -- stableford_net rounds without hole data compute to NULL — they
    -- cannot contribute points and are excluded from the board math
    -- (still counted nowhere; rounds_played reflects contributing rounds).
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
    )::bigint                                                  AS "position",
    b.user_id                                                  AS user_id,
    COALESCE(p.username, p.first_name, 'Player')::text         AS player_name,
    p.avatar_url::text                                         AS avatar_url,
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
-- create_game: p_scoring_basis (drop the 9-param signature — overloads make
-- PostgREST rpc() resolution ambiguous, same reason as Phase A)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_game(text, text, integer, date, date, integer, integer, text, uuid);
CREATE OR REPLACE FUNCTION public.create_game(p_name text, p_course_name text, p_max_players integer, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_scoring_cards integer DEFAULT NULL::integer, p_total_cards integer DEFAULT NULL::integer, p_game_type text DEFAULT 'stroke_play'::text, p_course_id uuid DEFAULT NULL::uuid, p_scoring_basis text DEFAULT 'gross'::text)
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

  INSERT INTO public.games (
    name,
    course_name,
    course_id,
    admin_id,
    max_players,
    game_type,
    start_date,
    end_date,
    scoring_cards_count,
    total_cards_count,
    scoring_basis
  )
  VALUES (
    p_name,
    p_course_name,
    p_course_id,
    v_user_id,
    p_max_players,
    COALESCE(p_game_type, 'stroke_play'),
    p_start_date,
    p_end_date,
    p_scoring_cards,
    p_total_cards,
    COALESCE(p_scoring_basis, 'gross')
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
    RETURN json_build_object('success', false, 'error', 'Invalid scoring basis for this format');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_game(text, text, integer, date, date, integer, integer, text, uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_match_scorecard: net context per player
-- ---------------------------------------------------------------------------
-- Adds playing_handicap + net/stableford totals + per-hole strokes_received
-- so the UI renders "Brut 88 / Net 76" and net-aware cells from one payload.
CREATE OR REPLACE FUNCTION public.get_match_scorecard(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_course jsonb;
  v_players jsonb;
  v_match record;
  v_basis text;
BEGIN
  IF NOT user_can_see_match(p_match_id, v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not visible');
  END IF;

  SELECT m.id, m.status, m.course_name, m.match_date,
         COALESCE(m.course_id, g.course_id) AS course_id,
         COALESCE(g.scoring_basis, 'gross') AS scoring_basis
  INTO v_match
  FROM matches m LEFT JOIN games g ON g.id = m.game_id
  WHERE m.id = p_match_id;

  IF v_match.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not found');
  END IF;
  v_basis := v_match.scoring_basis;

  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'city', c.city, 'par', c.par,
    'holes_count', (SELECT count(*) FROM course_holes ch WHERE ch.course_id = c.id),
    'holes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'n', ch.hole_number, 'par', ch.par, 'hcp', ch.hcp_index,
        'dist', ch.dist_yellow_m, 'tee', ch.tee_note
      ) ORDER BY ch.hole_number)
      FROM course_holes ch WHERE ch.course_id = c.id
    ), '[]'::jsonb)
  ) INTO v_course
  FROM courses c WHERE c.id = v_match.course_id;

  SELECT COALESCE(jsonb_agg(p ORDER BY p->>'display_name'), '[]'::jsonb) INTO v_players
  FROM (
    SELECT jsonb_build_object(
      'user_id', mp.user_id,
      'display_name', COALESCE(pr.username, pr.first_name, 'Player'),
      'avatar_url', pr.avatar_url,
      'score_status', s.status,
      'total', s.score,
      'declared_holes', s.holes,
      'playing_handicap', mp.playing_handicap,
      'net_total', CASE WHEN s.id IS NOT NULL THEN round_basis_score(s.id, 'net') END,
      'stableford_total', CASE WHEN s.id IS NOT NULL THEN round_basis_score(s.id, 'stableford_net') END,
      'thru', COALESCE((SELECT count(*) FROM score_holes sh WHERE sh.score_id = s.id), 0),
      'holes', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('n', sh.hole_number, 'strokes', sh.strokes)
                         ORDER BY sh.hole_number)
        FROM score_holes sh WHERE sh.score_id = s.id
      ), '[]'::jsonb),
      'strokes_received', CASE
        WHEN v_match.course_id IS NOT NULL AND mp.playing_handicap IS NOT NULL THEN (
          SELECT jsonb_object_agg(al.hole_number::text, al.strokes_received)
          FROM allocate_strokes(v_match.course_id, mp.playing_handicap) al
        )
      END
    ) AS p
    FROM match_players mp
    JOIN profiles pr ON pr.id = mp.user_id
    LEFT JOIN scores s ON s.match_id = mp.match_id AND s.user_id = mp.user_id
    WHERE mp.match_id = p_match_id
  ) sub;

  RETURN jsonb_build_object(
    'success', true,
    'match_id', v_match.id,
    'match_status', v_match.status,
    'course_name', v_match.course_name,
    'scoring_basis', v_basis,
    'course', v_course,
    'players', v_players,
    'editable', v_match.status NOT IN ('completed', 'cancelled')
                AND EXISTS (SELECT 1 FROM match_players
                            WHERE match_id = p_match_id AND user_id = v_caller)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_match_scorecard(uuid) TO authenticated;

-- ============================================================================
-- Verification (run manually):
--   SELECT * FROM allocate_strokes('<course>', 20);  -- 18 rows summing 20
--   SELECT round_basis_score('<score>', 'net');
--   SELECT * FROM get_leaderboard('<net game>');     -- 20-hcp can tie 5-hcp
-- ============================================================================
