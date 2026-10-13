-- Regression tests for format-aware Elo, qualified ranks and complete cards.
-- Disposable database only. No rows survive this transaction.
BEGIN;
SET LOCAL search_path = public, extensions;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a3310000-0000-0000-0000-000000000001','fair-a@test.local','{"first_name":"Fair A","username":"fair-a"}'),
 ('a3310000-0000-0000-0000-000000000002','fair-b@test.local','{"first_name":"Fair B","username":"fair-b"}'),
 ('a3310000-0000-0000-0000-000000000003','fair-c@test.local','{"first_name":"Fair C","username":"fair-c"}');
UPDATE profiles SET handicap=0 WHERE id::text LIKE 'a3310000%';

CREATE FUNCTION pg_temp.fair_game(fmt text,basis text,n int DEFAULT 1) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE g uuid;
BEGIN
 INSERT INTO games(name,course_name,admin_id,max_players,game_type,format,scoring_basis,scoring_cards_count,total_cards_count,status)
 VALUES('Fairness test','Test','a3310000-0000-0000-0000-000000000001',4,fmt,fmt,basis,n,10,'active') RETURNING id INTO g;
 INSERT INTO game_members(game_id,user_id) VALUES(g,'a3310000-0000-0000-0000-000000000002');
 RETURN g;
END; $$;
CREATE FUNCTION pg_temp.fair_match(g uuid,a int,b int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE m uuid;
BEGIN
 INSERT INTO matches(game_id,created_by,course_name,match_date,status)
 VALUES(g,'a3310000-0000-0000-0000-000000000001','Test',current_date,'scheduled') RETURNING id INTO m;
 INSERT INTO match_players(match_id,user_id) VALUES
 (m,'a3310000-0000-0000-0000-000000000001'),(m,'a3310000-0000-0000-0000-000000000002');
 INSERT INTO scores(match_id,user_id,score,holes,status) VALUES
 (m,'a3310000-0000-0000-0000-000000000001',a,18,'pending'),
 (m,'a3310000-0000-0000-0000-000000000002',b,18,'pending');
 UPDATE scores SET status='approved' WHERE match_id=m;
 RETURN m;
END; $$;

DO $$
DECLARE g uuid; m uuid; v numeric;
BEGIN
 g:=pg_temp.fair_game('stableford','gross'); m:=pg_temp.fair_match(g,40,30);
 SELECT rating INTO v FROM player_ratings WHERE user_id='a3310000-0000-0000-0000-000000000001';
 IF v IS DISTINCT FROM 1016 THEN RAISE EXCEPTION 'Stableford winner lost Elo: %',v; END IF;
 IF rate_match(m)<>0 THEN RAISE EXCEPTION 'Elo rerun changed ratings'; END IF;
 -- Reset ratings so each direction test starts from equal opponents.
 UPDATE player_ratings SET rating=1000 WHERE user_id::text LIKE 'a3310000%';
 g:=pg_temp.fair_game('stroke_play','gross'); m:=pg_temp.fair_match(g,80,90);
 SELECT rating INTO v FROM player_ratings WHERE user_id='a3310000-0000-0000-0000-000000000001';
 IF v IS DISTINCT FROM 1016 THEN RAISE EXCEPTION 'Stroke winner lost Elo: %',v; END IF;
 UPDATE player_ratings SET rating=1000 WHERE user_id::text LIKE 'a3310000%';
 g:=pg_temp.fair_game('stroke_play','gross'); m:=pg_temp.fair_match(g,80,80);
 SELECT rating INTO v FROM player_ratings WHERE user_id='a3310000-0000-0000-0000-000000000001';
 IF v IS DISTINCT FROM 1000 THEN RAISE EXCEPTION 'Draw changed equal ratings: %',v; END IF;
END; $$;

DO $$
DECLARE g uuid; m uuid; pos bigint;
BEGIN
 PERFORM set_config('request.jwt.claims','{"sub":"a3310000-0000-0000-0000-000000000001","role":"authenticated"}',true);
 g:=pg_temp.fair_game('stroke_play','gross',2);
 m:=pg_temp.fair_match(g,90,75);
 -- B has a second complete round. A remains below the two-card requirement.
 INSERT INTO matches(game_id,created_by,course_name,match_date,status)
 VALUES(g,'a3310000-0000-0000-0000-000000000002','Test',current_date,'scheduled') RETURNING id INTO m;
 INSERT INTO match_players(match_id,user_id) VALUES(m,'a3310000-0000-0000-0000-000000000002');
 INSERT INTO scores(match_id,user_id,score,holes,status) VALUES(m,'a3310000-0000-0000-0000-000000000002',75,18,'pending');
 UPDATE scores SET status='approved' WHERE match_id=m;
 SELECT "position" INTO pos FROM get_leaderboard(g) WHERE user_id='a3310000-0000-0000-0000-000000000001';
 IF pos IS NOT NULL THEN RAISE EXCEPTION 'One-card player ranked: %',pos; END IF;
 SELECT "position" INTO pos FROM get_leaderboard(g) WHERE user_id='a3310000-0000-0000-0000-000000000002';
 IF pos IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Qualified player is not first: %',pos; END IF;
END; $$;

DO $$
DECLARE g uuid; m uuid; c uuid; i int; v numeric;
BEGIN
 UPDATE player_ratings SET rating=1000 WHERE user_id::text LIKE 'a3310000%';
 UPDATE profiles SET handicap=18 WHERE id='a3310000-0000-0000-0000-000000000001';
 g:=pg_temp.fair_game('stroke_play','stableford_net');
 INSERT INTO courses(name,city,holes,par) VALUES('Elo Nine','Test',9,36) RETURNING id INTO c;
 FOR i IN 1..9 LOOP INSERT INTO course_holes(course_id,hole_number,par,hcp_index) VALUES(c,i,4,i); END LOOP;
 UPDATE games SET course_id=c WHERE id=g;
 INSERT INTO matches(game_id,created_by,course_id,course_name,match_date,status)
 VALUES(g,'a3310000-0000-0000-0000-000000000001',c,'Elo Nine',current_date,'scheduled') RETURNING id INTO m;
 INSERT INTO match_players(match_id,user_id) VALUES
 (m,'a3310000-0000-0000-0000-000000000001'),(m,'a3310000-0000-0000-0000-000000000002');
 FOR i IN 1..9 LOOP
  PERFORM upsert_score_hole(m,'a3310000-0000-0000-0000-000000000001',i,5);
  PERFORM upsert_score_hole(m,'a3310000-0000-0000-0000-000000000002',i,CASE WHEN i<=4 THEN 5 ELSE 4 END);
 END LOOP;
 UPDATE scores SET status='approved' WHERE match_id=m;
 -- A's gross 45 loses to B's 40, but net Stableford 18 beats 14.
 SELECT rating INTO v FROM player_ratings WHERE user_id='a3310000-0000-0000-0000-000000000001';
 IF v IS DISTINCT FROM 1016 THEN RAISE EXCEPTION 'Net Stableford winner lost Elo: %',v; END IF;
 UPDATE profiles SET handicap=0 WHERE id='a3310000-0000-0000-0000-000000000001';
END; $$;

DO $$
DECLARE g uuid; m uuid; c uuid; s uuid; res json; i int;
BEGIN
 g:=pg_temp.fair_game('stroke_play','net');
 INSERT INTO courses(name,city,holes,par) VALUES('Fair Nine','Test',9,36) RETURNING id INTO c;
 FOR i IN 1..9 LOOP INSERT INTO course_holes(course_id,hole_number,par,hcp_index) VALUES(c,i,4,i); END LOOP;
 UPDATE games SET course_id=c WHERE id=g;
 INSERT INTO matches(game_id,created_by,course_id,course_name,match_date,status)
 VALUES(g,'a3310000-0000-0000-0000-000000000001',c,'Fair Nine',current_date,'scheduled') RETURNING id INTO m;
 INSERT INTO match_players(match_id,user_id) VALUES(m,'a3310000-0000-0000-0000-000000000001');
 res:=upsert_score_hole(m,'a3310000-0000-0000-0000-000000000001',1,4);
 SELECT id INTO s FROM scores WHERE match_id=m;
 res:=approve_match_scores(m);
 IF (res->>'success')::boolean IS TRUE THEN RAISE EXCEPTION 'Partial peer approval accepted'; END IF;
 res:=finalize_match_scores(m);
 IF (res->>'success')::boolean IS TRUE THEN RAISE EXCEPTION 'Partial captain approval accepted'; END IF;
 BEGIN
  UPDATE scores SET status='approved' WHERE id=s;
  RAISE EXCEPTION 'Partial direct approval accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 -- Automatic jobs leave a stale incomplete card pending and the match open.
 UPDATE matches SET last_edit_at=now()-interval '2 days' WHERE id=m;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM auto_approve_stale_scores(); PERFORM auto_complete_stale_matches();
 IF (SELECT status FROM scores WHERE id=s)<>'pending' OR (SELECT status FROM matches WHERE id=m)='completed' THEN
  RAISE EXCEPTION 'Cron finalized incomplete card';
 END IF;
 IF current_setting('mulligan.system_update',true)='on' THEN RAISE EXCEPTION 'Cron left bypass enabled'; END IF;
 PERFORM set_config('request.jwt.claims','{"sub":"a3310000-0000-0000-0000-000000000001","role":"authenticated"}',true);
 -- Clearing the last hole must not turn its old total into a valid aggregate.
 PERFORM upsert_score_hole(m,'a3310000-0000-0000-0000-000000000001',1,NULL);
 res:=approve_match_scores(m);
 IF (res->>'success')::boolean IS TRUE THEN RAISE EXCEPTION 'Erased card approved'; END IF;
 FOR i IN 1..9 LOOP PERFORM upsert_score_hole(m,'a3310000-0000-0000-0000-000000000001',i,4); END LOOP;
 res:=approve_match_scores(m);
 IF (res->>'success')::boolean IS NOT TRUE OR (SELECT status FROM scores WHERE id=s)<>'approved' THEN
  RAISE EXCEPTION 'Complete nine-hole card refused: %',res;
 END IF;
END; $$;
ROLLBACK;
