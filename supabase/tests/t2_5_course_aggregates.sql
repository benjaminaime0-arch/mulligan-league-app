-- ============================================================================
-- T2.5 — course aggregates: dist_yellow ↔ hole-card consistency + sync trigger
-- ============================================================================
-- Target: the DISPOSABLE CI database only (after `supabase db reset`).
-- Every assertion RAISEs on failure; run with psql -v ON_ERROR_STOP=1.
-- One rolled-back transaction — nothing persists.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- T1: post-repair invariant — every complete yellow-tee card sums to
--     courses.dist_yellow (two-loop convention for 9T), pars likewise.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM (
    SELECT ch.course_id
    FROM course_holes ch JOIN courses c ON c.id = ch.course_id
    GROUP BY ch.course_id, c.par, c.dist_yellow
    HAVING count(*) IN (9, 18)
       AND (
         c.par IS DISTINCT FROM
           sum(ch.par) * CASE WHEN count(*) = 9 THEN 2 ELSE 1 END
         OR (
           bool_and(ch.dist_yellow_m IS NOT NULL)
           AND count(*) FILTER (WHERE ch.tee_note IS NOT NULL) = 0
           AND c.dist_yellow IS DISTINCT FROM
             sum(ch.dist_yellow_m) * CASE WHEN count(*) = 9 THEN 2 ELSE 1 END
         )
       )
  ) x;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'T2.5 FAIL: % courses where aggregates contradict the hole card', v_bad;
  END IF;
  RAISE NOTICE 'T2.5 T1 PASS: aggregates match hole cards';
END $$;

-- ---------------------------------------------------------------------------
-- T2: the trigger tracks card edits — 18T ×1, 9T ×2, tee_note'd cards frozen
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_18 uuid;
  v_9  uuid;
  v_dist int;
  v_par  int;
  v_now  int;
BEGIN
  SELECT ch.course_id INTO v_18
  FROM course_holes ch
  GROUP BY ch.course_id
  HAVING count(*) = 18
     AND bool_and(ch.dist_yellow_m IS NOT NULL)
     AND count(*) FILTER (WHERE ch.tee_note IS NOT NULL) = 0
  LIMIT 1;

  SELECT ch.course_id INTO v_9
  FROM course_holes ch
  GROUP BY ch.course_id
  HAVING count(*) = 9
     AND bool_and(ch.dist_yellow_m IS NOT NULL)
     AND count(*) FILTER (WHERE ch.tee_note IS NOT NULL) = 0
  LIMIT 1;

  IF v_18 IS NULL OR v_9 IS NULL THEN
    RAISE EXCEPTION 'T2.5 FAIL: no eligible 18T/9T course found for trigger test';
  END IF;

  -- 18T: +7 m on one hole → aggregate +7; +1 par likewise.
  SELECT dist_yellow, par INTO v_dist, v_par FROM courses WHERE id = v_18;
  UPDATE course_holes SET dist_yellow_m = dist_yellow_m + 7
  WHERE course_id = v_18 AND hole_number = 1;
  SELECT dist_yellow INTO v_now FROM courses WHERE id = v_18;
  IF v_now <> v_dist + 7 THEN
    RAISE EXCEPTION 'T2.5 FAIL: 18T dist_yellow % after +7 edit (want %)', v_now, v_dist + 7;
  END IF;
  UPDATE course_holes SET par = par + 1
  WHERE course_id = v_18 AND hole_number = 1;
  SELECT par INTO v_now FROM courses WHERE id = v_18;
  IF v_now <> v_par + 1 THEN
    RAISE EXCEPTION 'T2.5 FAIL: 18T par % after +1 edit (want %)', v_now, v_par + 1;
  END IF;

  -- 9T: +5 m on one hole → two-loop aggregate +10.
  SELECT dist_yellow INTO v_dist FROM courses WHERE id = v_9;
  UPDATE course_holes SET dist_yellow_m = dist_yellow_m + 5
  WHERE course_id = v_9 AND hole_number = 1;
  SELECT dist_yellow INTO v_now FROM courses WHERE id = v_9;
  IF v_now <> v_dist + 10 THEN
    RAISE EXCEPTION 'T2.5 FAIL: 9T dist_yellow % after +5 edit (want %)', v_now, v_dist + 10;
  END IF;

  -- tee_note freezes dist sync (but not par): flag the card as another tee,
  -- then a distance edit must leave courses.dist_yellow alone.
  SELECT dist_yellow INTO v_dist FROM courses WHERE id = v_18;
  UPDATE course_holes SET tee_note = 'blanc'
  WHERE course_id = v_18 AND hole_number = 1;
  UPDATE course_holes SET dist_yellow_m = dist_yellow_m + 500
  WHERE course_id = v_18 AND hole_number = 2;
  SELECT dist_yellow INTO v_now FROM courses WHERE id = v_18;
  IF v_now <> v_dist THEN
    RAISE EXCEPTION 'T2.5 FAIL: tee_note''d card moved dist_yellow % → %', v_dist, v_now;
  END IF;

  -- Partial card (17 rows) is out of scope: deleting a hole leaves the
  -- last-known aggregates in place.
  DELETE FROM course_holes WHERE course_id = v_18 AND hole_number = 18;
  SELECT dist_yellow INTO v_now FROM courses WHERE id = v_18;
  IF v_now <> v_dist THEN
    RAISE EXCEPTION 'T2.5 FAIL: partial card moved dist_yellow % → %', v_dist, v_now;
  END IF;

  RAISE NOTICE 'T2.5 T2 PASS: trigger syncs 18T/9T, skips tee_note''d and partial cards';
END $$;

-- ---------------------------------------------------------------------------
-- T3: the service-role write path survives the trigger (SECURITY INVOKER —
--     the nested sync_course_aggregates call is EXECUTE-checked against
--     service_role, and the courses UPDATE against its table grants).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_course uuid;
  v_dist int;
  v_now int;
BEGIN
  SELECT ch.course_id INTO v_course
  FROM course_holes ch
  GROUP BY ch.course_id
  HAVING count(*) = 18
     AND bool_and(ch.dist_yellow_m IS NOT NULL)
     AND count(*) FILTER (WHERE ch.tee_note IS NOT NULL) = 0
  LIMIT 1;
  IF v_course IS NULL THEN
    RAISE EXCEPTION 'T2.5 FAIL: no eligible 18T course left for the service_role test';
  END IF;
  SELECT dist_yellow INTO v_dist FROM courses WHERE id = v_course;

  SET LOCAL ROLE service_role;
  UPDATE course_holes SET dist_yellow_m = dist_yellow_m + 3
  WHERE course_id = v_course AND hole_number = 2;
  RESET ROLE;

  SELECT dist_yellow INTO v_now FROM courses WHERE id = v_course;
  IF v_now <> v_dist + 3 THEN
    RAISE EXCEPTION 'T2.5 FAIL: service_role edit left dist_yellow % (want %)', v_now, v_dist + 3;
  END IF;
  RAISE NOTICE 'T2.5 T3 PASS: service_role card writes fire the sync';
END $$;

-- ---------------------------------------------------------------------------
-- T4: completeness gate — a card whose row count contradicts courses.holes
--     (stale rows after a shrinking reseed, mid-edit states) never syncs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_course uuid;
  v_dist int;
  v_par int;
  r record;
BEGIN
  SELECT ch.course_id INTO v_course
  FROM course_holes ch JOIN courses c ON c.id = ch.course_id
  WHERE c.holes = 18
  GROUP BY ch.course_id
  HAVING count(*) = 18
     AND bool_and(ch.dist_yellow_m IS NOT NULL)
     AND count(*) FILTER (WHERE ch.tee_note IS NOT NULL) = 0
  LIMIT 1;
  IF v_course IS NULL THEN
    RAISE EXCEPTION 'T2.5 FAIL: no eligible 18T course left for the freeze-gate test';
  END IF;

  -- Simulate a shrink-repair that fixed courses.holes but left stale rows.
  UPDATE courses SET holes = 9, par = 60, dist_yellow = 2000 WHERE id = v_course;
  UPDATE course_holes SET dist_yellow_m = dist_yellow_m + 11
  WHERE course_id = v_course AND hole_number = 3;

  SELECT par, dist_yellow INTO v_par, v_dist FROM courses WHERE id = v_course;
  IF v_par <> 60 OR v_dist <> 2000 THEN
    RAISE EXCEPTION 'T2.5 FAIL: mixed card (18 rows, holes=9) synced par=% dist=%', v_par, v_dist;
  END IF;
  RAISE NOTICE 'T2.5 T4 PASS: count<>holes cards are frozen, not Franken-summed';
END $$;

ROLLBACK;
