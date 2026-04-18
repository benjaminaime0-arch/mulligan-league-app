import type { SupabaseClient } from "@supabase/supabase-js"

export type MatchPlayerInfo = {
  name: string
  avatar_url?: string | null
}

export type MatchPlayerWithScore = {
  name: string
  avatar_url?: string | null
  user_id: string
  score?: number | null
  holes?: number | null
}

/**
 * Fetches player display names for a batch of match IDs.
 *
 * @param client  – Supabase client instance
 * @param matchIds – Array of match IDs to look up
 * @param excludeUserId – Optional user ID to exclude (useful for "vs." display)
 * @returns Map of match_id → array of player first names
 */
export async function fetchMatchPlayerNames(
  client: SupabaseClient,
  matchIds: (string | number)[],
  excludeUserId?: string,
): Promise<Map<string | number, string[]>> {
  const result = new Map<string | number, string[]>()

  if (matchIds.length === 0) return result

  const { data, error } = await client
    .from("match_players")
    .select("match_id, user_id, profiles(username, first_name, last_name)")
    .in("match_id", matchIds)

  if (error || !data) return result

  for (const row of data as Array<{
    match_id: string | number
    user_id: string
    profiles: { username?: string | null; first_name?: string | null; last_name?: string | null } | null
  }>) {
    if (excludeUserId && row.user_id === excludeUserId) continue

    const profile = row.profiles
    const name =
      profile?.username ||
      profile?.first_name ||
      profile?.last_name ||
      "Player"

    const existing = result.get(row.match_id) || []
    existing.push(name)
    result.set(row.match_id, existing)
  }

  return result
}

/**
 * Fetches player display names + avatar URLs for a batch of match IDs.
 */
export async function fetchMatchPlayers(
  client: SupabaseClient,
  matchIds: (string | number)[],
): Promise<Map<string | number, MatchPlayerInfo[]>> {
  const result = new Map<string | number, MatchPlayerInfo[]>()

  if (matchIds.length === 0) return result

  const { data, error } = await client
    .from("match_players")
    .select("match_id, user_id, profiles(username, first_name, last_name, avatar_url)")
    .in("match_id", matchIds)

  if (error || !data) return result

  for (const row of data as Array<{
    match_id: string | number
    user_id: string
    profiles: {
      username?: string | null
      first_name?: string | null
      last_name?: string | null
      avatar_url?: string | null
    } | null
  }>) {
    const profile = row.profiles
    const name =
      profile?.username ||
      profile?.first_name ||
      profile?.last_name ||
      "Player"

    const existing = result.get(row.match_id) || []
    existing.push({ name, avatar_url: profile?.avatar_url || null })
    result.set(row.match_id, existing)
  }

  return result
}

/**
 * Fetches player display names, avatars, AND their scores for a batch of match IDs.
 */
export async function fetchMatchPlayersWithScores(
  client: SupabaseClient,
  matchIds: (string | number)[],
): Promise<Map<string | number, MatchPlayerWithScore[]>> {
  const result = new Map<string | number, MatchPlayerWithScore[]>()

  if (matchIds.length === 0) return result

  // Fetch players and scores in parallel
  const [playersRes, scoresRes] = await Promise.all([
    client
      .from("match_players")
      .select("match_id, user_id, profiles(username, first_name, last_name, avatar_url)")
      .in("match_id", matchIds),
    client
      .from("scores")
      .select("match_id, user_id, score, holes")
      .in("match_id", matchIds),
  ])

  // Build a score lookup: "matchId:userId" → { score, holes }
  const scoreLookup = new Map<string, { score: number; holes: number }>()
  if (scoresRes.data) {
    for (const s of scoresRes.data) {
      scoreLookup.set(`${s.match_id}:${s.user_id}`, { score: s.score, holes: s.holes })
    }
  }

  if (playersRes.error || !playersRes.data) return result

  for (const row of playersRes.data as Array<{
    match_id: string | number
    user_id: string
    profiles: {
      username?: string | null
      first_name?: string | null
      last_name?: string | null
      avatar_url?: string | null
    } | null
  }>) {
    const profile = row.profiles
    const name =
      profile?.username ||
      profile?.first_name ||
      profile?.last_name ||
      "Player"

    const scoreData = scoreLookup.get(`${row.match_id}:${row.user_id}`)

    const existing = result.get(row.match_id) || []
    existing.push({
      name,
      avatar_url: profile?.avatar_url || null,
      user_id: row.user_id,
      score: scoreData?.score ?? null,
      holes: scoreData?.holes ?? null,
    })
    result.set(row.match_id, existing)
  }

  return result
}
