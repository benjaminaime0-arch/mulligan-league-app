import { supabase } from "@/lib/supabase"

/**
 * Shared loader for "the games a user belongs to, enriched with members and
 * their active period." This block was copy-pasted three times (the games
 * hub, players/[id], profile) with subtle divergences (AUD#23). It now lives
 * here once, typed, so the `as unknown as` casts each copy relied on are gone.
 *
 * Types are hand-authored against the real schema (verified column types) —
 * `supabase gen types` needs a login token the CI/dev environment doesn't
 * have wired yet; swapping these for the generated `Database` types is a
 * mechanical follow-up (AUD#22).
 */

/** games.status domain (baseline_core_constraints CHECK). */
export type GameStatus = "pending" | "active" | "paused" | "completed"

/** The three buckets the games hub groups by. */
export type HubSection = "active" | "upcoming" | "completed"

export type GameRow = {
  id: string
  name: string
  course_name: string | null
  admin_id: string | null
  max_players: number | null
  status: GameStatus | string | null
  game_type: string | null
  format: string | null
  scoring_cards_count: number | null
  total_cards_count: number | null
  start_date: string | null
  end_date: string | null
  invite_code: string | null
}

export type MemberProfile = {
  user_id: string
  profiles: {
    id: string
    first_name: string | null
    last_name: string | null
    username: string | null
    avatar_url: string | null
  } | null
}

export type GamePeriod = {
  id: string
  game_id: string
  name: string | null
  start_date: string | null
  end_date: string | null
  status: string | null
}

export type EnrichedGame = GameRow & {
  members: MemberProfile[]
  memberCount: number
  /** The game's active period, or the latest known one, if any. */
  activePeriod: GamePeriod | null
}

/**
 * Map the raw `games.status` column to a hub bucket. Completed is explicit;
 * active/paused are live; everything else (notably `pending` — created but
 * periods not generated) reads as Upcoming. There is no `upcoming` value in
 * the games table (that exists only on game_periods).
 */
export function sectionForStatus(status: string | null | undefined): HubSection {
  if (status === "completed") return "completed"
  if (status === "active" || status === "paused") return "active"
  return "upcoming"
}

/** A game is finished — no new matches may be created against it. */
export function isGameCompleted(status: string | null | undefined): boolean {
  return status === "completed"
}

/**
 * Load every game `userId` belongs to, each enriched with its member roster
 * (with profiles) and active/latest period. One membership query, then a
 * batched members+periods fetch — the shape all three call sites need.
 */
export async function loadUserGames(userId: string): Promise<EnrichedGame[]> {
  const { data: memberRows, error: memberError } = await supabase
    .from("game_members")
    .select("game_id, games(*)")
    .eq("user_id", userId)

  if (memberError) throw memberError

  // The client isn't typed with the generated Database types, so the
  // embedded `games` resource comes back loosely typed — cast through
  // unknown. (Swapping in `supabase gen types` removes this — AUD#22.)
  const gameMap = new Map<string, GameRow>()
  for (const m of (memberRows || []) as unknown as Array<{ games: GameRow | null }>) {
    const g = m.games
    if (g && !gameMap.has(String(g.id))) gameMap.set(String(g.id), g)
  }

  const games = Array.from(gameMap.values())
  if (games.length === 0) return []

  const gameIds = games.map((g) => g.id)

  const [membersResult, periodsResult] = await Promise.all([
    supabase
      .from("game_members")
      .select(
        "game_id, user_id, profiles(id, first_name, last_name, username, avatar_url)",
      )
      .in("game_id", gameIds),
    supabase
      .from("game_periods")
      .select("id, game_id, name, start_date, end_date, status")
      .in("game_id", gameIds)
      .order("start_date", { ascending: true }),
  ])

  if (membersResult.error) throw membersResult.error
  if (periodsResult.error) throw periodsResult.error

  const membersByGame = new Map<string, MemberProfile[]>()
  for (const m of (membersResult.data || []) as unknown as Array<
    MemberProfile & { game_id: string }
  >) {
    const key = String(m.game_id)
    const list = membersByGame.get(key) ?? []
    list.push({ user_id: m.user_id, profiles: m.profiles })
    membersByGame.set(key, list)
  }

  // Prefer the active period; otherwise keep the latest by start_date
  // (rows arrive ascending, so a later row overwrites an earlier one).
  const periodByGame = new Map<string, GamePeriod>()
  for (const p of (periodsResult.data || []) as GamePeriod[]) {
    const key = String(p.game_id)
    const existing = periodByGame.get(key)
    if (!existing || p.status === "active") periodByGame.set(key, p)
  }

  return games.map((g) => {
    const key = String(g.id)
    const members = membersByGame.get(key) ?? []
    return {
      ...g,
      members,
      memberCount: members.length,
      activePeriod: periodByGame.get(key) ?? null,
    }
  })
}

export type LeaderboardStanding = {
  position: number | null
  roundsCounted: number | null
}

/**
 * The caller's own standing in each of their games: position + counted
 * rounds, keyed by game id. One member-gated `get_leaderboard` RPC per game
 * (small, ≤8 players) run in parallel. Games where the caller has no row (or
 * the RPC errors) simply map to nulls.
 */
export async function loadMyStandings(
  gameIds: string[],
  userId: string,
): Promise<Map<string, LeaderboardStanding>> {
  const out = new Map<string, LeaderboardStanding>()
  await Promise.all(
    gameIds.map(async (gameId) => {
      const { data, error } = await supabase.rpc("get_leaderboard", {
        p_game_id: gameId,
      })
      if (error || !data) {
        out.set(gameId, { position: null, roundsCounted: null })
        return
      }
      const mine = (data as Array<{
        user_id: string | null
        position: number | null
        rounds_counted: number | null
      }>).find((r) => r.user_id === userId)
      out.set(gameId, {
        position: mine?.position ?? null,
        roundsCounted: mine?.rounds_counted ?? null,
      })
    }),
  )
  return out
}

/**
 * The caller's next scheduled match per game: earliest match on/after today
 * (local date) that isn't completed/cancelled, keyed by game id. Batched in
 * one query across all the caller's games.
 */
export async function loadNextMatches(
  gameIds: string[],
  userId: string,
  todayIso: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (gameIds.length === 0) return out

  const { data, error } = await supabase
    .from("match_players")
    .select("match_id, matches!inner(game_id, match_date, status)")
    .eq("user_id", userId)

  if (error || !data) return out

  for (const row of data as unknown as Array<{
    matches: {
      game_id: string | null
      match_date: string | null
      status: string | null
    } | null
  }>) {
    const m = row.matches
    if (!m || !m.game_id || !m.match_date) continue
    if (m.status === "completed" || m.status === "cancelled") continue
    if (m.match_date < todayIso) continue
    const key = String(m.game_id)
    const current = out.get(key)
    if (!current || m.match_date < current) out.set(key, m.match_date)
  }
  return out
}

/** Pending join-requests addressed to `userId` as the admin (to review). */
export type PendingInvite = {
  id: string
  target_type: string
  requester_id: string
  requesterName: string
  created_at: string | null
}

export async function loadPendingReviewRequests(
  userId: string,
): Promise<PendingInvite[]> {
  const { data, error } = await supabase
    .from("join_requests")
    .select("id, target_type, requester_id, created_at")
    .eq("admin_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  if (error || !data || data.length === 0) return []

  const requesterIds = Array.from(
    new Set((data as Array<{ requester_id: string }>).map((r) => r.requester_id)),
  )
  // requester_id FKs auth.users, so profiles can't be embedded — join here.
  const { data: profs } = await supabase
    .from("profiles")
    .select("id, username, first_name")
    .in("id", requesterIds)

  const nameById = new Map<string, string>()
  for (const p of (profs || []) as Array<{
    id: string
    username: string | null
    first_name: string | null
  }>) {
    nameById.set(p.id, p.username || p.first_name || "A player")
  }

  return (data as Array<{
    id: string
    target_type: string
    requester_id: string
    created_at: string | null
  }>).map((r) => ({
    id: r.id,
    target_type: r.target_type,
    requester_id: r.requester_id,
    requesterName: nameById.get(r.requester_id) || "A player",
    created_at: r.created_at,
  }))
}
