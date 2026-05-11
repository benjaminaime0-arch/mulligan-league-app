-- ============================================================
-- Leaderboard RPC: direction-aware sort + best-of-N picker
-- ============================================================
-- Reads `leagues.format` and flips two things:
--
--   stroke_play  — ORDER BY score ASC  (lowest total wins;
--                  best-of-N picks the lowest N scores)
--   stableford   — ORDER BY score DESC (highest total wins;
--                  best-of-N picks the highest N scores)
--
-- The chronological cap (first-M cards played count) is format-
-- agnostic — a card is a card regardless of how it's scored. Only
-- the "which N count toward the total" selection flips direction.
--
-- Return shape unchanged — the `LeaderboardRow` frontend type
-- still matches. `best_score` is renamed conceptually ("best"
-- means lowest in stroke, highest in stableford) but keeps the
-- same column name and type so no client edit is required.
--
-- Access gate (member-only) kept from the previous revision —
-- see fix_get_leaderboard_member_only.sql for rationale.
--
-- Safe to re-run.
-- ============================================================

DROP FUNCTION IF EXISTS get_leaderboard(uuid);

CREATE OR REPLACE FUNCTION get_leaderboard(p_league_id uuid)
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
  v_caller        uuid := auth.uid();
  v_role          text := current_setting('request.jwt.claim.role', true);
BEGIN
  -- Access gate. Service role always passes; authenticated users
  -- must be members; anon gets nothing.
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF v_caller IS NULL THEN RETURN; END IF;
    IF NOT is_league_member(p_league_id, v_caller) THEN RETURN; END IF;
  END IF;

  SELECT
    l.scoring_cards_count,
    l.total_cards_count,
    COALESCE(l.format, 'stroke_play')
  INTO v_scoring_cards, v_total_cards, v_format
  FROM leagues l
  WHERE l.id = p_league_id;

  RETURN QUERY
  WITH approved_scores AS (
    SELECT
      s.id,
      s.user_id,
      s.score,
      m.match_date,
      s.created_at
    FROM scores s
    JOIN matches m ON m.id = s.match_id
    WHERE m.league_id = p_league_id
      AND s.status    = 'approved'
  ),
  chrono AS (
    SELECT
      a.id,
      a.user_id,
      a.score,
      ROW_NUMBER() OVER (
        PARTITION BY a.user_id
        ORDER BY a.match_date ASC NULLS LAST, a.created_at ASC, a.id ASC
      ) AS chrono_rn
    FROM approved_scores a
  ),
  eligible AS (
    SELECT c.user_id, c.score
    FROM chrono c
    WHERE v_total_cards IS NULL OR c.chrono_rn <= v_total_cards
  ),
  -- Direction-aware best-of-N selection. Stroke play → lowest N
  -- scores count; Stableford → highest N. The CASE inside the
  -- window ORDER BY is the key line — everything downstream is
  -- format-agnostic again because the `rn <= v_scoring_cards`
  -- filter below always means "the N that should count".
  ranked AS (
    SELECT
      e.user_id,
      e.score,
      ROW_NUMBER() OVER (
        PARTITION BY e.user_id
        ORDER BY
          CASE WHEN v_format = 'stableford' THEN -e.score ELSE e.score END ASC
      ) AS rn,
      COUNT(*) OVER (PARTITION BY e.user_id) AS eligible_count
    FROM eligible e
  ),
  player_totals AS (
    SELECT
      r.user_id,
      -- `best_score` is direction-aware: MIN for stroke, MAX for
      -- stableford. From the frontend's perspective it's always
      -- "the one round to brag about" in the current format.
      CASE
        WHEN v_format = 'stableford' THEN MAX(r.score)
        ELSE MIN(r.score)
      END                             AS best_score,
      SUM(r.score)::bigint            AS total_score,
      COUNT(*)::bigint                AS rounds_counted,
      MAX(r.eligible_count)::bigint   AS rounds_played
    FROM ranked r
    WHERE v_scoring_cards IS NULL OR r.rn <= v_scoring_cards
    GROUP BY r.user_id
  ),
  board AS (
    SELECT
      lm.user_id,
      pt.best_score::bigint                  AS best_score,
      COALESCE(pt.total_score, 0)::bigint    AS total_score,
      COALESCE(pt.rounds_counted, 0)::bigint AS rounds_counted,
      COALESCE(pt.rounds_played, 0)::bigint  AS rounds_played
    FROM league_members lm
    LEFT JOIN player_totals pt ON pt.user_id = lm.user_id
    WHERE lm.league_id = p_league_id
  )
  SELECT
    ROW_NUMBER() OVER (
      ORDER BY
        -- Active players (at least one counted round) ahead of zeros.
        CASE WHEN b.rounds_counted > 0 THEN 0 ELSE 1 END,
        -- Direction flip: stroke sorts ASC, stableford DESC. We
        -- encode that by negating the total for stableford so the
        -- ASC clause naturally produces the right order.
        CASE WHEN v_format = 'stableford' THEN -b.total_score ELSE b.total_score END ASC,
        -- Stable tiebreak.
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
    CASE WHEN v_format = 'stableford' THEN -b.total_score ELSE b.total_score END ASC,
    p.username ASC NULLS LAST,
    b.user_id ASC;
END;
$$;

-- ============================================================
-- Verification
-- ============================================================
-- On a stroke_play league: unchanged ordering, best_score = lowest.
-- On a stableford league (flip l.format via
--   UPDATE leagues SET format='stableford' WHERE id='…';):
--   higher totals outrank lower, best_score = highest score.
-- ============================================================
