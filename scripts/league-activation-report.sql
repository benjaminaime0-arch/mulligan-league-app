-- Read-only operational snapshot. Excludes obvious QA names/accounts, not a definitive production-user filter.
-- No invitation preparation is inferred: this is group membership and validated card state.
WITH cohort AS (
  SELECT g.id,g.created_at
  FROM public.games g JOIN public.personal_league_rules rules ON rules.game_id=g.id
  WHERE rules.duration_months IS NOT NULL
    AND g.name !~* '^(qa|test|e2e|smoke|fastcard)'
    AND NOT EXISTS (SELECT 1 FROM public.game_members gm JOIN public.profiles p ON p.id=gm.user_id
                    WHERE gm.game_id=g.id AND gm.role='owner' AND p.username ~* '^qa')
), progress AS (
  SELECT c.*,
    (SELECT count(*) FROM public.game_members gm WHERE gm.game_id=c.id) AS members,
    EXISTS (SELECT 1 FROM public.personal_league_submissions s
            JOIN public.personal_rounds r ON r.id=s.round_id
            JOIN public.game_members gm ON gm.game_id=s.game_id AND gm.user_id=s.user_id
            WHERE s.game_id=c.id AND s.status='accepted' AND r.status='validated'
              AND s.revision_id=r.current_revision_id) AS has_counted_card
  FROM cohort c
)
SELECT count(*) AS leagues,
       count(*) FILTER (WHERE members<2 AND NOT has_counted_card) AS solo_no_card,
       count(*) FILTER (WHERE members>=2 AND NOT has_counted_card) AS group_no_card,
       count(*) FILTER (WHERE members<2 AND has_counted_card) AS solo_with_card,
       count(*) FILTER (WHERE members>=2 AND has_counted_card) AS active_groups
FROM progress;
