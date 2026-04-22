// Core match/league types moved to `src/components/match/types.ts` so
// both league and profile pages can share them. Re-exported here for
// back-compat with this directory's existing imports.
export type { Match, League, MatchPlayer } from "@/components/match/types"

export type UserLeague = {
  id: string | number
  name: string
}

export type MemberWithProfile = {
  id: string | number
  league_id: string | number
  user_id: string
  profiles?: {
    id: string
    first_name?: string | null
    last_name?: string | null
    username?: string | null
  } | null
}

export type LeaguePeriod = {
  id: string | number
  league_id: string | number
  name?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string | null
}

export type LeaderboardRow = {
  position?: number | null
  user_id?: string | null
  player_name?: string | null
  avatar_url?: string | null
  best_score?: number | null
  total_score?: number | null
  rounds_counted?: number | null
  rounds_played?: number | null
}
