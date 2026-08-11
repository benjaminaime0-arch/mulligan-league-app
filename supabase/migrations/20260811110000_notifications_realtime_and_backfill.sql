-- ============================================================================
-- Notifications: realtime publication + legacy league_id data backfill
-- ============================================================================
-- (a) useNotifications/useUnreadCount subscribe to postgres_changes on
--     public.notifications (INSERT + UPDATE), but no migration ever added
--     the table to the supabase_realtime publication — verified missing in
--     prod on 2026-08-11 (only match_players, matches, score_holes, scores
--     are published). The bell badge therefore never live-updates; it only
--     refreshes on remount. Guarded so replays and already-patched
--     environments no-op.
--
-- (b) Rows created before the leagues→games rename carry data.league_id /
--     data.league_name. The in-app click handlers only route match_id /
--     game_id, so those rows render permanently unclickable (369 rows in
--     prod at time of writing). Game ids ARE the old league ids — the table
--     was renamed in place — so the keys can be rewritten 1:1. Idempotent:
--     the WHERE clause empties after the first run.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

UPDATE public.notifications
SET data = (data - 'league_id' - 'league_name')
        || jsonb_build_object('game_id', data->'league_id')
        || CASE WHEN data ? 'league_name'
                THEN jsonb_build_object('game_name', data->'league_name')
                ELSE '{}'::jsonb END
WHERE data ? 'league_id';
