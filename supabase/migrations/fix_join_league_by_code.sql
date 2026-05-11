-- ============================================================
-- Rewrite join_league_by_code so it works after the RLS lockdown
-- ============================================================
-- Symptom: a new user with a valid invite code can't join a league
-- that's already started. The invite-code flow (/leagues/join) calls
-- `join_league_by_code(code text)` which historically lived outside
-- our git migrations. After `privatize_leagues.sql` restricted
-- `leagues` SELECT to members and `fix_core_rls_holes.sql` blocked
-- direct INSERTs on `league_members`, any non-SECURITY-DEFINER
-- version of this RPC breaks: it can't find the league by code
-- (viewer isn't a member yet) or can't write the membership row.
--
-- Fix: drop and re-create with:
--   - SECURITY DEFINER (bypasses both the SELECT and INSERT policies)
--   - Explicit search_path (safety vs. search-path hijacking)
--   - Friendly jsonb return shape matching the frontend's expectation:
--       { success: bool, league_id, league_name, error? }
--   - Status-agnostic join: works on draft, active, AND completed
--     leagues. The invite code is the admin's explicit grant; if
--     they shared it on a started league, the intent is to let the
--     code-bearer in directly (no admin approval roundtrip).
--
-- Safe to re-run (DROP + CREATE).
-- ============================================================

DROP FUNCTION IF EXISTS join_league_by_code(text);

CREATE OR REPLACE FUNCTION join_league_by_code(code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_league_id     uuid;
  v_league_name   text;
  v_max_players   int;
  v_current_count int;
  v_normalized    text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Not authenticated'
    );
  END IF;

  -- Normalize: strip whitespace, upper-case. Invite codes are stored
  -- case-sensitive on `leagues.invite_code` but are rendered / typed
  -- as uppercase in the UI, so match both to be forgiving.
  v_normalized := upper(btrim(code));

  IF length(v_normalized) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Invite code is required'
    );
  END IF;

  -- Look up the league. SECURITY DEFINER bypasses the leagues SELECT
  -- policy (members-only), which is exactly what we want pre-join.
  SELECT id, name, max_players
  INTO v_league_id, v_league_name, v_max_players
  FROM leagues
  WHERE upper(btrim(invite_code)) = v_normalized
  LIMIT 1;

  IF v_league_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Invalid invite code'
    );
  END IF;

  -- Already a member? Tell them plainly instead of silently failing.
  IF EXISTS (
    SELECT 1
    FROM league_members
    WHERE league_id = v_league_id
      AND user_id   = v_user_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'You are already a member of this league'
    );
  END IF;

  -- Capacity check — only when a cap is configured. Ties go to
  -- "full" (count >= max).
  IF v_max_players IS NOT NULL THEN
    SELECT COUNT(*)
    INTO v_current_count
    FROM league_members
    WHERE league_id = v_league_id;

    IF v_current_count >= v_max_players THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'This league is full'
      );
    END IF;
  END IF;

  -- Direct insert. The league_members_insert_blocked RLS would
  -- normally reject this, but SECURITY DEFINER runs as the
  -- function owner and bypasses RLS. Intentional: the invite code
  -- IS the permission.
  INSERT INTO league_members (league_id, user_id)
  VALUES (v_league_id, v_user_id);

  RETURN jsonb_build_object(
    'success',     true,
    'league_id',   v_league_id,
    'league_name', v_league_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION join_league_by_code(text) TO authenticated;

-- ============================================================
-- Verification (run as a new user who has a valid invite code)
-- ============================================================
-- SELECT join_league_by_code('ABC123');
--   → expect { success: true, league_id: '…', league_name: '…' }
-- SELECT join_league_by_code('ABC123');  -- second time
--   → expect { success: false, error: 'You are already a member…' }
-- SELECT join_league_by_code('NOPE42');
--   → expect { success: false, error: 'Invalid invite code' }
-- ============================================================
