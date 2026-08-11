# Mulligan League — Audit (2026-07-09)

Three parallel passes: security, database/migrations, frontend code quality. Findings verified against source, ranked by blast radius. `tsc --noEmit` (strict) and `next lint` both pass clean — everything below is design/correctness, not compiler-level.

The headline: **the client is trusted where the database should be the authority.** Scores, match membership, and profile stats are all reachable directly through the public anon key (shipped in the browser bundle) in ways the UI never intends. RLS is enabled everywhere, but several policies and SECURITY DEFINER RPCs don't actually enforce ownership.

---

## Critical / High — fix before more users

### 1. Players can approve their own scores → leaderboard is manipulable
`baseline_core_policies.sql` — `scores_update_own` is `WITH CHECK (auth.uid() = user_id)` with no column restriction; `scores_insert_auth` never constrains `status`. The leaderboard, records, and card-cap all key off `status = 'approved'`.

Exploit: a match member calls PostgREST directly — `.from("scores").update({status:'approved', score:65, approved_by:self})` on their own row — skipping the multi-party `approve_match_scores` RPC. The fake-approved score counts. `reset_approvals_on_score_edit` compounds this: it resets *other* players to pending but leaves the edited row's own status intact.

Fix: block owner writes to `status`/`approved_by`/`approved_at` (column-level policy or trigger); force `status='pending'` on insert; allow `approved` transitions only through the SECURITY DEFINER RPC.

### 2. Every user's email + PII is dumpable, unauthenticated
`baseline_core_policies.sql` — `profiles` SELECT policy is `USING (true)` with no role clause; `grant_service_role_public_access.sql` grants `SELECT` on all tables to `anon`; `profiles.email` is `NOT NULL`.

Exploit: anyone with the public anon key hits `GET /rest/v1/profiles?select=email,first_name,last_name,club,handicap` and dumps every user.

Fix: restrict the policy to `authenticated`, drop `email`/PII from the readable set (expose display fields via a view or RPC). Separately, revoke the blanket `anon` INSERT/UPDATE/DELETE grant in `grant_service_role_public_access.sql` — any future table without RLS is currently anon-writable.

### 3. Profile / activity RPCs leak private-league data for any user id
`add_profile_dashboard_rpcs.sql`, `add_activity_events.sql` (`get_activity_feed`), `patch_profile_score_trend_range.sql`, `purge_casual_match_legacy.sql` (`get_player_round_history`), `patch_profile_week_wider_range.sql`. All SECURITY DEFINER, all take an arbitrary `p_user_id`, none check caller membership. Called from `players/[id]/page.tsx` with any id. The membership guard promised in `privatize_leagues.sql`'s footnote never shipped.

Exploit: any authenticated user reads any player's scores, schedule, rivals, and feed — including leagues they aren't in.

Fix: intersect each query with the caller's leagues, or enforce `p_user_id = auth.uid()` where the data is meant to be self-only.

### 4. `/api/push` is open by default → spoofed OS push to any user
`src/app/api/push/route.ts:37-43` — the webhook-secret check is `if (webhookSecret)`, so when `PUSH_WEBHOOK_SECRET` is unset the endpoint is fully open and trusts the body wholesale.

Exploit: `POST /api/push {"user_id":"<victim>","title":"Click here","body":"..."}` sends an attacker-controlled push (phishing); the response also leaks whether a user has subscriptions.

Fix: fail closed — 401/500 if the secret isn't configured; never derive push content from an unauthenticated body.

### 5. Self-add to any match, bypassing approval and the 4-player cap
`baseline_core_policies.sql` — `match_players_insert_member` lets any league member insert their own `match_players` row for any match. The "full / already requested" checks live only in the `request_join_match` RPC, not in RLS or a trigger.

Exploit: `.from("match_players").insert({match_id, user_id:self})` joins any match directly.

Fix: block direct client INSERT on `match_players`; route joins through the RPC; enforce the cap in a trigger.

### 6. Migrations do not replay — no reproducible environment
Whole `supabase/migrations/` folder. No timestamp prefixes, so tools apply lexicographically: `add_*` runs before `baseline_*`, `sync_league_format_from_type.sql` runs after the leagues→games rename and references dropped tables, and the wrong `get_leaderboard` (`fix_get_leaderboard_with_avatar.sql` — no member gate, no format awareness) wins over the canonical `fix_get_leaderboard_format_aware.sql`. A fresh DB either aborts or silently reinstates the privacy leak. App-critical RPCs (`submit_match_scores`, `approve_match_scores`, `create_game`, `generate_game_periods`) aren't in git at all — Dashboard-authored prod-only objects.

Fix: renumber every file with timestamp prefixes reflecting true apply order (recoverable from git history); `pg_get_functiondef`-export the untracked RPCs into a baseline; delete the five superseded `get_leaderboard` files. Adopt `supabase migration new` going forward.

---

## Medium

7. **24h auto-complete is dead.** `add_match_auto_complete_24h.sql`: cron runs with `auth.uid()=NULL` and `pg_trigger_depth()=1`, so the immutability trigger raises `check_violation` every 15 min. SECURITY DEFINER bypasses RLS, not triggers (the file's comment is wrong). Fix: allow the transition when `auth.uid() IS NULL` or via a session GUC.

8. **Legacy JWT-role GUC.** `fix_get_leaderboard_member_only.sql`, `_format_aware.sql`, both `get_league_badges` files read `current_setting('request.jwt.claim.role', true)` — the pre-PostgREST-v9 GUC current Supabase no longer sets. Service-role calls return empty for the exact tooling the gate exists to allow. Fix: use `auth.role()` / `auth.jwt()->>'role'`.

9. **Invite-code brute force.** 6 hex chars, SECURITY DEFINER auto-join, no rate limiting, distinct error messages act as a validity oracle. Fix: longer codes, per-user rate limit, uniform error.

10. **Capacity checks race.** COUNT-then-INSERT with no row lock in `join_league_by_code`, `approve_join_request`, `check_match_player_limit` → concurrent joins exceed limits. Fix: `SELECT … FOR UPDATE` on the parent before counting.

11. **~20 SECURITY DEFINER functions lack `SET search_path`** (all notification/activity RPCs, `auto_complete_stale_matches`, etc.) — search_path-hijack surface Supabase advisors flag. Fix: `ALTER FUNCTION … SET search_path = public`.

12. **OG card leaks members-only data.** `api/og/round/[matchId]/route.tsx` uses the service-role key with no auth to render names/scores. matchId is a UUIDv4 so not enumerable, but it's a permanent unauthenticated leak to anyone with the link. Fix: revocable share token; gate on `status='completed'`.

13. **Full-page blank on every mutation/realtime event.** `games/[id]/page.tsx:165` sets `loading=true` inside `loadData`, which is wired to the realtime debounce and `onRefresh` — saving a score or another player's score landing unmounts the page into "Loading game…" and destroys child state. Fix: only show the full spinner when `game === null`.

14. **Inverted realtime guard.** `games/[id]/page.tsx:498`: `if (!matchId) return bump()` fires the refetch the comment says it prevents. Fix: `return` without `bump()`.

15. **`loadData` has no cancellation/fencing.** `games/[id]/page.tsx:161-399` and `leaderboard/page.tsx:46-62` — overlapping runs resolve out of order and stale responses stomp newer state. The codebase already uses a `cancelled` flag in 9 other files; apply it here.

16. **`notify_score_submitted` spams.** No first-insert guard despite the comment; a 4-player match fires ~12 notifications, bulk inserts fire per row. Fix: WHEN clause / per-match dedupe.

17. **UTC "today" bugs.** `games/[id]/page.tsx:1103`, `profile/page.tsx:147` use `toISOString().slice(0,10)` while the rest of the app deliberately uses local-date helpers (`DatePickerModal.tsx` documents this exact bug). For French users between midnight and 1–2am, "today" is yesterday. Also present server-side in every streak/calendar RPC (`current_date` in UTC). Fix: reuse the local `toIso` helper client-side; compute against `Europe/Paris` server-side.

---

## Low / hygiene

18. **Junk files tracked in git:** `src/app/leaderboard/page.tsx.` (trailing dot, empty) and `src/app/profile/.page.tsx.swp` (vim swap). `git rm` both; add `*.swp` to `.gitignore`.
19. **`onAuthStateChange` used nowhere** — `useAuth.ts` is a one-shot `getSession()` mounted 17×; sign-out/expiry never propagates. Fix: single `AuthProvider` subscribing to auth changes. (Not a vuln — RLS backs the data — but stale-session UX.)
20. **Realtime notification bugs:** INSERT `.slice(0, pageSize)` discards loaded pages (`useNotifications.ts:122`); `payload.old.read_at` is unreliable without `REPLICA IDENTITY FULL`, so the unread badge miscounts (`:139`). Fix: only slice when unpaginated; set replica identity or refetch count.
21. **Swallowed errors** in `useNotifications.ts:54` — an errored fetch shows a permanently empty list with no signal.
22. **Unchecked RPC casts throughout** (`data as LeaderboardRow[]`, 7 `as unknown as` double-casts). Fix: `supabase gen types typescript` and type the client — this also catches finding 3-style drift.
23. **~50-line games+members+periods block duplicated 3×** (`games/list`, `players/[id]`, `profile`); `leaderboard/page.tsx` reimplements `LeaderboardTable`. Extract to `src/lib/`.
24. **Duplicate completion events race, missing FK on `join_requests.target_id`, unindexed jsonb notification filter, stale `league_*` metadata keys/constraint names after rename** — cleanup items, see DB pass.

---

## Verified clean
No hardcoded secrets, service-role key, or VAPID private key in `src/` or config; `.env*.local` correctly gitignored. No `dangerouslySetInnerHTML`, no XSS sinks, no open redirects. RLS enabled on all core tables. The privatize-leagues recursion fix is complete and sound. `fix_notifications_rls.sql` / `fix_activity_events_rls.sql` correctly closed their `WITH CHECK (true)` holes. `tsc --noEmit` strict: 0 errors; `next lint`: 0 warnings; no `console.log`, no empty catch blocks.

## Suggested order
1, 2, 3, 5 (RLS/RPC ownership) → 4 (push) → 6 (migration replay + export untracked RPCs) → the rest.
