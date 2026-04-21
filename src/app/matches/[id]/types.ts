export type Match = {
  id: string | number
  league_id?: string | number | null
  period_id?: string | number | null
  course_name?: string | null
  match_date?: string | null
  match_time?: string | null
  created_by?: string | null
  status?: string | null
  leagues?: {
    id: string | number
    name: string
    admin_id?: string | null
  } | null
}

export type MatchPlayerWithProfile = {
  id: string | number
  match_id: string | number
  user_id: string
  profiles?: {
    id: string
    first_name?: string | null
    last_name?: string | null
    username?: string | null
    avatar_url?: string | null
  } | null
}

export type Score = {
  id: string | number
  match_id: string | number
  user_id: string
  score: number
  holes: number
  status?: string | null
  submitted_by?: string | null
  approved_by?: string | null
  approved_at?: string | null
  created_at?: string
}

export type MatchApproval = {
  id: string
  match_id: string
  user_id: string
  created_at?: string
}

/**
 * Shape used on the match detail page (page.tsx). Like
 * MatchPlayerWithProfile but also carries approved_at, which the
 * detail view reads to show per-player approval status.
 */
export type MatchPlayer = {
  id: string | number
  match_id: string | number
  user_id: string
  approved_at?: string | null
  profiles?: {
    id: string
    username?: string | null
    first_name?: string | null
    last_name?: string | null
    avatar_url?: string | null
  } | null
}

export type ScoreEdit = {
  score: string
  holes: 9 | 18
}

/** Prefer the chosen username; fall back to a generic "Player". */
export function memberDisplayName(player: MatchPlayer): string {
  return player.profiles?.username || "Player"
}
