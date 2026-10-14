-- The legacy creator remains an implementation detail of the checked wrapper.
REVOKE EXECUTE ON FUNCTION public.create_game(text,text,int,date,date,int,int,text,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.check_calendar_league_dates() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE months int;
BEGIN
 SELECT duration_months INTO months FROM personal_league_rules WHERE game_id=NEW.id;
 IF months IS NOT NULL AND (NEW.start_date IS NULL OR NEW.end_date IS DISTINCT FROM personal_calendar_end(NEW.start_date,months)) THEN
  RAISE EXCEPTION 'League dates must match its calendar duration.';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_calendar_league_dates() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER check_calendar_league_dates BEFORE UPDATE OF start_date,end_date ON public.games
 FOR EACH ROW EXECUTE FUNCTION public.check_calendar_league_dates();
CREATE FUNCTION public.check_calendar_league_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE g record;
BEGIN
 IF NEW.duration_months IS NOT NULL THEN
  SELECT start_date,end_date INTO g FROM games WHERE id=NEW.game_id;
  IF g.start_date IS NULL OR g.end_date IS DISTINCT FROM personal_calendar_end(g.start_date,NEW.duration_months) THEN
   RAISE EXCEPTION 'League dates must match its calendar duration.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_calendar_league_rules() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER check_calendar_league_rules BEFORE INSERT OR UPDATE ON public.personal_league_rules
 FOR EACH ROW EXECUTE FUNCTION public.check_calendar_league_rules();
NOTIFY pgrst,'reload schema';
