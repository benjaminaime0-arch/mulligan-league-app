#!/usr/bin/env bash
# Real PostgreSQL connections, run only on the disposable CI Supabase database.
set -euo pipefail
: "${PGURL:?Disposable test database required}"
fixture_dir=$(mktemp -d)
trap 'rm -rf "$fixture_dir"' EXIT
psql "$PGURL" -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a4530000-0000-0000-0000-000000000001','race-owner@test.local','{"username":"race-owner"}'),
 ('a4530000-0000-0000-0000-000000000002','race-partner@test.local','{"username":"race-partner"}');
DO $$ DECLARE tee uuid; g uuid; r uuid; holes jsonb; BEGIN
 SELECT t.id INTO tee FROM personal_tees t JOIN personal_layouts l ON l.id=t.layout_id JOIN courses c ON c.id=l.course_id WHERE c.name='Golf de Rueil-Malmaison' AND l.hole_count=9 AND t.name='Jaunes — Messieurs';
 PERFORM set_config('request.jwt.claims','{"sub":"a4530000-0000-0000-0000-000000000001","role":"authenticated"}',true);
 g:=(create_calendar_league('Race fixture',tee,current_date-1,1,'stroke_net',1,'peer_required')->>'game_id')::uuid;
 INSERT INTO game_members(game_id,user_id) VALUES(g,'a4530000-0000-0000-0000-000000000002');
 SELECT jsonb_agg(jsonb_build_object('hole_number',hole_number,'completion','completed','strokes',par+1) ORDER BY hole_number) INTO holes FROM personal_tee_holes WHERE tee_id=tee;
 FOR i IN 1..2 LOOP
  r:=(create_personal_round(tee,current_date)->>'id')::uuid;
  PERFORM save_personal_card(r,holes,0); PERFORM request_personal_validation(r,1,'a4530000-0000-0000-0000-000000000002'); PERFORM submit_personal_card(r,g);
  UPDATE personal_rounds SET auto_validation_at=clock_timestamp()-interval '1 second' WHERE id=r;
 END LOOP;
END $$;
SQL
# One designated reviewer races two workers on the same due cards.
psql "$PGURL" -q -v ON_ERROR_STOP=1 >"$fixture_dir/manual.log" 2>&1 <<'SQL' &
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a4530000-0000-0000-0000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT (value->>'id')::uuid id FROM jsonb_array_elements(get_personal_overview()->'inbox') LOOP
  PERFORM review_personal_card(r.id,(get_personal_card(r.id)->'revision'->>'id')::uuid,NULL,NULL,true);
 END LOOP;
END $$;
COMMIT;
SQL
manual_pid=$!
psql "$PGURL" -q -v ON_ERROR_STOP=1 -c 'SET ROLE service_role; SELECT auto_validate_personal_cards();' >"$fixture_dir/worker1.log" 2>&1 &
worker1_pid=$!
psql "$PGURL" -q -v ON_ERROR_STOP=1 -c 'SET ROLE service_role; SELECT auto_validate_personal_cards();' >"$fixture_dir/worker2.log" 2>&1 &
worker2_pid=$!
# A worker may settle after inbox loading; stale manual reviews must fail safely.
if ! wait "$manual_pid"; then
  if ! grep -Fq 'no longer awaiting your validation' "$fixture_dir/manual.log"; then cat "$fixture_dir/manual.log"; exit 1; fi
fi
wait "$worker1_pid"
wait "$worker2_pid"
psql "$PGURL" -q -v ON_ERROR_STOP=1 <<'SQL'
SELECT auto_validate_personal_cards();
DO $$ BEGIN
 IF (SELECT count(*) FROM personal_rounds WHERE user_id='a4530000-0000-0000-0000-000000000001' AND status='validated' AND validation_method='automatic')<>2 THEN RAISE EXCEPTION 'Concurrent settlements lost a card'; END IF;
 IF (SELECT count(*) FROM personal_card_events e JOIN personal_rounds r ON r.id=e.round_id WHERE r.user_id='a4530000-0000-0000-0000-000000000001' AND e.action='validated')<>2 THEN RAISE EXCEPTION 'Concurrent settlements duplicated an audit'; END IF;
 IF (SELECT count(*) FROM personal_league_submissions WHERE user_id='a4530000-0000-0000-0000-000000000001' AND status='accepted')<>2 THEN RAISE EXCEPTION 'Concurrent settlements duplicated or lost a league contribution'; END IF;
 IF (calculate_personal_level('a4530000-0000-0000-0000-000000000001')->>'cards_count')::int<>2 THEN RAISE EXCEPTION 'Concurrent settlements duplicated level'; END IF;
END $$;
SQL
printf 'PASS: concurrent reviewer and two workers settle exactly once\n'
