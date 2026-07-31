-- ============================================================================
-- Season recap, Indice Mulligan (Elo), rivalries (Phase G, features 8-10)
-- ============================================================================
-- Three read-mostly features sharing one comparison rule:
--
--   A round's comparable value = NET (score − snapshot playing handicap,
--   0 when none). One rule for Elo pairs, head-to-head and recap superlatives
--   — mixing bases per-surface would make the same match count as a win in
--   one place and a loss in another.
--
--   * player_ratings / rating_history: Elo, K=32, computed per COMPLETED
--     match over all approved-score player pairs. Idempotent by
--     construction: rating_history is UNIQUE(match_id, user_id) and the
--     trigger skips matches already recorded. Surfaced in the product as
--     "Indice Mulligan" — never "Elo".
--   * get_game_recap: completed games only — podium, best round vs par,
--     biggest win margin, most improved, attendance, longest streak,
--     head-to-head grid. Computed on read, nothing stored.
--   * get_head_to_head: two players' shared matches — record, streak,
--     margins, last 5. shares_game_with-gated both ways.
--
-- Safe to re-run: OR REPLACE / IF NOT EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.player_ratings (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating numeric NOT NULL DEFAULT 1000,
  matches_rated int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rating_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  rating_before numeric NOT NULL,
  rating_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, user_id)
);

ALTER TABLE public.player_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rating_history ENABLE ROW LEVEL SECURITY;
-- Ratings are an app-wide ladder: readable by any signed-in player,
-- written only by the SECURITY DEFINER machinery below.
DROP POLICY IF EXISTS player_ratings_select ON public.player_ratings;
CREATE POLICY player_ratings_select ON public.player_ratings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rating_history_select ON public.rating_history;
CREATE POLICY rating_history_select ON public.rating_history
  FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.player_ratings FROM anon, authenticated;
REVOKE ALL ON public.rating_history FROM anon, authenticated;
GRANT SELECT ON public.player_ratings TO authenticated;
GRANT SELECT ON public.rating_history TO authenticated;

-- ---------------------------------------------------------------------------
-- Elo core: rate one match (idempotent), trigger on completion, backfill
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_match(p_match_id uuid)
RETURNS int  -- players whose rating moved (0 = skipped/no pairs)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pair record;
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

  -- Accumulate per-player deltas across every approved pair, all computed
  -- against PRE-match ratings (standard multi-opponent treatment).
  FOR v_pair IN
    SELECT a.user_id AS ua, b.user_id AS ub,
           (a.score - COALESCE(mpa.playing_handicap, 0)) AS na,
           (b.score - COALESCE(mpb.playing_handicap, 0)) AS nb
    FROM scores a
    JOIN scores b ON b.match_id = a.match_id AND b.user_id > a.user_id
    LEFT JOIN match_players mpa ON mpa.match_id = a.match_id AND mpa.user_id = a.user_id
    LEFT JOIN match_players mpb ON mpb.match_id = b.match_id AND mpb.user_id = b.user_id
    WHERE a.match_id = p_match_id
      AND a.status = 'approved' AND b.status = 'approved'
  LOOP
    SELECT COALESCE((SELECT rating FROM player_ratings WHERE user_id = v_pair.ua), 1000) INTO v_ra;
    SELECT COALESCE((SELECT rating FROM player_ratings WHERE user_id = v_pair.ub), 1000) INTO v_rb;
    v_ea := 1 / (1 + power(10, (v_rb - v_ra) / 400.0));
    -- Lower net wins (golf).
    v_sa := CASE WHEN v_pair.na < v_pair.nb THEN 1
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

CREATE OR REPLACE FUNCTION public.rate_match_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM rate_match(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rate_match_on_completion ON public.matches;
CREATE TRIGGER trg_rate_match_on_completion
  AFTER UPDATE OF status ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.rate_match_on_completion();

-- Historical replay, chronological. Service-role only; re-runnable (the
-- per-match guard makes replays no-ops).
CREATE OR REPLACE FUNCTION public.backfill_ratings()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_m record;
  v_rated int := 0;
BEGIN
  FOR v_m IN
    SELECT id FROM matches WHERE status = 'completed'
    ORDER BY match_date ASC NULLS LAST, created_at ASC, id ASC
  LOOP
    IF rate_match(v_m.id) > 0 THEN v_rated := v_rated + 1; END IF;
  END LOOP;
  RETURN json_build_object('matches_rated', v_rated);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.backfill_ratings() FROM PUBLIC, anon, authenticated;

SELECT public.backfill_ratings();

-- ---------------------------------------------------------------------------
-- Head-to-head (feature 10)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_head_to_head(p_user_a uuid, p_user_b uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT (shares_game_with(p_user_a) AND shares_game_with(p_user_b)) THEN
    RETURN jsonb_build_object('visible', false);
  END IF;

  WITH shared AS (
    SELECT m.id, m.match_date,
           (sa.score - COALESCE(mpa.playing_handicap, 0)) AS na,
           (sb.score - COALESCE(mpb.playing_handicap, 0)) AS nb
    FROM matches m
    JOIN scores sa ON sa.match_id = m.id AND sa.user_id = p_user_a AND sa.status = 'approved'
    JOIN scores sb ON sb.match_id = m.id AND sb.user_id = p_user_b AND sb.status = 'approved'
    LEFT JOIN match_players mpa ON mpa.match_id = m.id AND mpa.user_id = p_user_a
    LEFT JOIN match_players mpb ON mpb.match_id = m.id AND mpb.user_id = p_user_b
    ORDER BY m.match_date ASC NULLS LAST, m.created_at ASC
  ),
  judged AS (
    SELECT *,
           CASE WHEN na < nb THEN 'a' WHEN nb < na THEN 'b' ELSE 't' END AS winner,
           ROW_NUMBER() OVER (ORDER BY match_date DESC NULLS LAST) AS recency
    FROM shared
  ),
  streak AS (
    -- Current streak: every match more recent than the first result that
    -- differs from the latest one. No flip anywhere → the whole history.
    SELECT count(*) AS len, max(winner) AS who
    FROM judged
    WHERE recency < COALESCE(
      (SELECT min(j2.recency) FROM judged j2
       WHERE j2.winner <> (SELECT j1.winner FROM judged j1 WHERE j1.recency = 1)),
      (SELECT max(j3.recency) + 1 FROM judged j3)
    )
  )
  SELECT jsonb_build_object(
    'visible', true,
    'matches', (SELECT count(*) FROM judged),
    'a_wins', (SELECT count(*) FROM judged WHERE winner = 'a'),
    'b_wins', (SELECT count(*) FROM judged WHERE winner = 'b'),
    'ties', (SELECT count(*) FROM judged WHERE winner = 't'),
    'avg_margin', (SELECT round(avg(abs(na - nb))::numeric, 1) FROM judged),
    'streak_len', COALESCE((SELECT len FROM streak), 0),
    'streak_who', (SELECT who FROM streak),
    'last5', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'match_id', j.id, 'date', j.match_date, 'winner', j.winner,
        'a_net', j.na, 'b_net', j.nb
      ) ORDER BY j.recency)
      FROM judged j WHERE j.recency <= 5
    ), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_head_to_head(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Season recap (feature 8)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_game_recap(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_game record;
  v_out jsonb;
BEGIN
  IF NOT is_game_member(p_game_id, v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Members only');
  END IF;
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF v_game.status IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Game not completed');
  END IF;

  WITH rounds AS (
    SELECT s.user_id, s.score, s.holes,
           (s.score - COALESCE(mp.playing_handicap, 0)) AS net,
           m.match_date, m.id AS match_id,
           c.par AS course_par,
           CASE WHEN s.holes = 9 THEN c.par / 2.0 ELSE c.par::numeric END AS par_ref
    FROM scores s
    JOIN matches m ON m.id = s.match_id AND m.game_id = p_game_id
    LEFT JOIN match_players mp ON mp.match_id = s.match_id AND mp.user_id = s.user_id
    LEFT JOIN courses c ON c.id = COALESCE(m.course_id, v_game.course_id)
    WHERE s.status = 'approved'
  ),
  named AS (
    SELECT r.*, COALESCE(p.username, p.first_name, 'Player') AS name
    FROM rounds r JOIN profiles p ON p.id = r.user_id
  ),
  halves AS (
    -- Most improved: first-half vs second-half average net, players with
    -- at least 2 rounds in each half.
    SELECT user_id, name,
           avg(net) FILTER (WHERE half = 1) AS h1,
           avg(net) FILTER (WHERE half = 2) AS h2
    FROM (
      SELECT n.*, NTILE(2) OVER (PARTITION BY user_id ORDER BY match_date, match_id) AS half
      FROM named n
    ) x
    GROUP BY user_id, name
    HAVING count(*) FILTER (WHERE half = 1) >= 2
       AND count(*) FILTER (WHERE half = 2) >= 2
  ),
  match_wins AS (
    -- Per match: the lowest-net player takes the match (ties = no winner).
    SELECT match_id, match_date,
           CASE WHEN count(*) FILTER (WHERE rk = 1) = 1
                THEN (array_agg(user_id) FILTER (WHERE rk = 1))[1]
           END AS winner_id,
           max(margin) AS margin
    FROM (
      SELECT n.*, RANK() OVER (PARTITION BY match_id ORDER BY net ASC) AS rk,
             (max(net) OVER (PARTITION BY match_id)) - net AS margin
      FROM named n
    ) y
    GROUP BY match_id, match_date
  ),
  streaks AS (
    SELECT winner_id AS user_id, count(*) AS len
    FROM (
      SELECT mw.*,
             ROW_NUMBER() OVER (ORDER BY match_date, match_id)
             - ROW_NUMBER() OVER (PARTITION BY winner_id ORDER BY match_date, match_id) AS grp
      FROM match_wins mw WHERE winner_id IS NOT NULL
    ) z
    GROUP BY winner_id, grp
  ),
  h2h AS (
    SELECT a.user_id AS a, b.user_id AS b, count(*) FILTER (WHERE a.net < b.net) AS a_wins
    FROM rounds a JOIN rounds b ON b.match_id = a.match_id AND b.user_id <> a.user_id
    GROUP BY a.user_id, b.user_id
  )
  SELECT jsonb_build_object(
    'success', true,
    'game', jsonb_build_object('id', v_game.id, 'name', v_game.name,
                               'start_date', v_game.start_date, 'end_date', v_game.end_date,
                               'course_name', v_game.course_name),
    'podium', (
      SELECT jsonb_agg(jsonb_build_object(
        'position', lb."position", 'user_id', lb.user_id, 'name', lb.player_name,
        'avatar_url', lb.avatar_url, 'total', lb.total_score
      ) ORDER BY lb."position")
      FROM get_leaderboard(p_game_id) lb WHERE lb."position" <= 3 AND lb.rounds_counted > 0
    ),
    'best_round', (
      SELECT jsonb_build_object('user_id', user_id, 'name', name, 'score', score,
                                'vs_par', CASE WHEN par_ref IS NOT NULL
                                               THEN round((score - par_ref)::numeric, 0) END,
                                'date', match_date)
      FROM named WHERE par_ref IS NOT NULL
      ORDER BY (score - par_ref) ASC, match_date ASC LIMIT 1
    ),
    'biggest_win', (
      SELECT jsonb_build_object('user_id', mw.winner_id,
                                'name', (SELECT COALESCE(p.username, p.first_name, 'Player')
                                         FROM profiles p WHERE p.id = mw.winner_id),
                                'margin', mw.margin, 'date', mw.match_date)
      FROM match_wins mw WHERE mw.winner_id IS NOT NULL
      ORDER BY mw.margin DESC NULLS LAST, mw.match_date ASC LIMIT 1
    ),
    'most_improved', (
      SELECT jsonb_build_object('user_id', user_id, 'name', name,
                                'delta', round((h1 - h2)::numeric, 1))
      FROM halves WHERE h1 > h2
      ORDER BY (h1 - h2) DESC LIMIT 1
    ),
    'attendance', (
      SELECT jsonb_build_object('user_id', user_id, 'name', name, 'rounds', count(*))
      FROM named GROUP BY user_id, name
      ORDER BY count(*) DESC, name ASC LIMIT 1
    ),
    'longest_streak', (
      SELECT jsonb_build_object('user_id', st.user_id,
                                'name', (SELECT COALESCE(p.username, p.first_name, 'Player')
                                         FROM profiles p WHERE p.id = st.user_id),
                                'len', st.len)
      FROM streaks st ORDER BY st.len DESC LIMIT 1
    ),
    'head_to_head', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('a', h.a, 'b', h.b, 'a_wins', h.a_wins))
      FROM h2h h
    ), '[]'::jsonb),
    'players', (
      SELECT jsonb_agg(DISTINCT jsonb_build_object('user_id', user_id, 'name', name))
      FROM named
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_game_recap(uuid) TO authenticated;

-- ============================================================================
-- Verification (run manually):
--   SELECT rate_match('<completed match>');           -- 0 on second call
--   SELECT * FROM player_ratings ORDER BY rating DESC;
--   SELECT get_head_to_head('<a>', '<b>');
--   SELECT get_game_recap('<completed game>');
-- ============================================================================
