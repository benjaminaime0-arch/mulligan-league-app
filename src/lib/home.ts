import { supabase } from "@/lib/supabase"
import {
  loadUserGames,
  loadMyStandings,
  sectionForStatus,
  type EnrichedGame,
  type LeaderboardStanding,
} from "@/lib/userGames"

/**
 * Data for the Home dashboard (T1.4). Home answers, above the fold:
 * "what does the app want from me right now?" — scores waiting on my
 * approval, rounds I haven't entered, my next match, and where I stand in
 * each active game. Reuses the shared game/standings loaders (src/lib/
 * userGames) so nothing is duplicated.
 */

export type HomeMatch = {
  id: string
  game_id: string | null
  game_name: string | null
  course_name: string | null
  match_date: string | null
  match_time: string | null
  status: string | null
}

export type GamePosition = {
  gameId: string
  gameName: string
  standing: LeaderboardStanding
  totalCards: number | null
}

export type HomeData = {
  /** Matches with scores in that I haven't approved yet — the core loop. */
  needApproval: HomeMatch[]
  /** Past/today matches I'm in but haven't entered a score for. */
  needScore: HomeMatch[]
  /** My earliest upcoming match (today or later, not finished). */
  nextMatch: HomeMatch | null
  /** My position in each active game. */
  positions: GamePosition[]
}

type MatchRow = {
  match_id: string
  approved_at: string | null
  matches: {
    id: string
    game_id: string | null
    course_name: string | null
    match_date: string | null
    match_time: string | null
    status: string | null
    games: { name: string | null; is_practice: boolean | null } | null
  } | null
}

function toHomeMatch(m: NonNullable<MatchRow["matches"]>): HomeMatch {
  return {
    id: m.id,
    game_id: m.game_id,
    game_name: m.games?.name ?? null,
    course_name: m.course_name,
    match_date: m.match_date,
    match_time: m.match_time,
    status: m.status,
  }
}

/**
 * Load everything the Home dashboard needs for `userId`.
 * `todayIso` is the viewer's local calendar date (see src/lib/date).
 */
export async function loadHomeData(
  userId: string,
  todayIso: string,
): Promise<HomeData> {
  // 1. My match memberships in a useful window (recent past → future), with
  //    the match + its game name and my own approval state.
  const { data: myRows, error: myErr } = await supabase
    .from("match_players")
    .select(
      "match_id, approved_at, matches!inner(id, game_id, course_name, match_date, match_time, status, games(name, is_practice))",
    )
    .eq("user_id", userId)

  if (myErr) throw myErr

  const rows = ((myRows as unknown) as MatchRow[]) || []
  // Practice rounds are self-driven — an abandoned solo card shouldn't nag
  // from the action strip, and "next match" means a real match with others.
  const activeMatches = rows.filter(
    (r) =>
      r.matches &&
      r.matches.status !== "cancelled" &&
      !r.matches.games?.is_practice,
  )
  const matchIds = activeMatches.map((r) => r.match_id)

  // 2. Which of those matches have ANY score, and whether I've entered mine.
  const scoredMatchIds = new Set<string>()
  const myScoredMatchIds = new Set<string>()
  if (matchIds.length > 0) {
    const { data: scoreRows } = await supabase
      .from("scores")
      .select("match_id, user_id")
      .in("match_id", matchIds)
    for (const s of (scoreRows || []) as Array<{ match_id: string; user_id: string }>) {
      scoredMatchIds.add(String(s.match_id))
      if (s.user_id === userId) myScoredMatchIds.add(String(s.match_id))
    }
  }

  const needApproval: HomeMatch[] = []
  const needScore: HomeMatch[] = []
  const upcoming: HomeMatch[] = []

  for (const r of activeMatches) {
    const m = r.matches!
    const hm = toHomeMatch(m)
    const finished = m.status === "completed"
    const isPastOrToday = m.match_date != null && m.match_date <= todayIso

    // Approval waiting on me: the match has scores, it isn't finished, and I
    // haven't signed off (my approved_at is null).
    if (!finished && scoredMatchIds.has(r.match_id) && r.approved_at == null) {
      needApproval.push(hm)
    }
    // Score waiting on me: a past/today match I'm in but never scored.
    else if (!finished && isPastOrToday && !myScoredMatchIds.has(r.match_id)) {
      needScore.push(hm)
    }

    // Next match: today or later and not finished.
    if (!finished && m.match_date != null && m.match_date >= todayIso) {
      upcoming.push(hm)
    }
  }

  const cmpDate = (a: HomeMatch, b: HomeMatch) =>
    (a.match_date || "").localeCompare(b.match_date || "")
  needApproval.sort((a, b) => cmpDate(b, a)) // most recent first
  needScore.sort((a, b) => cmpDate(b, a))
  upcoming.sort(cmpDate) // soonest first

  // 3. My position in each active game.
  const games: EnrichedGame[] = await loadUserGames(userId)
  const activeGames = games.filter((g) => sectionForStatus(g.status) === "active")
  const standings = await loadMyStandings(
    activeGames.map((g) => g.id),
    userId,
  )
  const positions: GamePosition[] = activeGames.map((g) => ({
    gameId: String(g.id),
    gameName: g.name,
    standing: standings.get(String(g.id)) ?? { position: null, roundsCounted: null },
    totalCards: g.total_cards_count,
  }))

  return {
    needApproval,
    needScore,
    nextMatch: upcoming[0] ?? null,
    positions,
  }
}
