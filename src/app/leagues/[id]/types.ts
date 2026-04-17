import type { MatchPlayer } from "@/lib/matchPlayers"

export type League = {
  id: string | number
  name: string
  course_name?: string | null
  invite_code?: string | null
  max_players?: number | null
  admin_id?: string | null
  status?: string | null
  league_type?: string | null
  scoring_cards_count?: number | null
  total_cards_count?: number | null
}

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
    full_name?: string | null
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

export type Match = {
  id: string | number
  league_id: string | number
  period_id: string | number
  course_name?: string | null
  match_date?: string | null
  match_time?: string | null
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

export type { MatchPlayer }
