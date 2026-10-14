-- A distinct wall-clock timestamp orders successive declarations in one transaction.
CREATE OR REPLACE FUNCTION public.capture_legacy_index_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE idx numeric; has_declaration boolean;
BEGIN
 SELECT index_value INTO idx FROM official_index_declarations WHERE user_id=NEW.id
 ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1;
 has_declaration:=FOUND;
 IF (NOT has_declaration AND NEW.handicap IS NOT NULL) OR
    (has_declaration AND NEW.handicap IS DISTINCT FROM idx) THEN
  INSERT INTO official_index_declarations(user_id,index_value,effective_on,recorded_at)
  VALUES(NEW.id,NEW.handicap,(clock_timestamp() AT TIME ZONE 'Europe/Paris')::date,clock_timestamp());
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.declare_personal_index(p_index numeric) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE idx numeric; found_index boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
 IF p_index IS NOT NULL AND (p_index NOT BETWEEN -10 AND 54 OR p_index<>round(p_index,1)) THEN
  RAISE EXCEPTION 'Use an official index between -10 and 54, with at most one decimal.';
 END IF;
 -- Serialize declarations and compatible legacy writes on the same owner row.
 PERFORM 1 FROM profiles WHERE id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.'; END IF;
 SELECT index_value INTO idx FROM official_index_declarations WHERE user_id=auth.uid()
 ORDER BY effective_on DESC,recorded_at DESC,id DESC LIMIT 1;
 found_index:=FOUND;
 IF idx IS NOT DISTINCT FROM p_index AND (found_index OR p_index IS NULL) THEN
  RETURN jsonb_build_object('success',true,'unchanged',true);
 END IF;
 INSERT INTO official_index_declarations(user_id,index_value,effective_on,recorded_at)
 VALUES(auth.uid(),p_index,(clock_timestamp() AT TIME ZONE 'Europe/Paris')::date,clock_timestamp());
 RETURN jsonb_build_object('success',true);
END $$;

NOTIFY pgrst,'reload schema';
