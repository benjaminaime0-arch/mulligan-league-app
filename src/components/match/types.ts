/**
 * Shared match/league types used by cross-page components
 * (MatchDetailCard, MatchCalendarSection). Lives outside any single
 * route so both the league page and profile page can import it.
 *
 * The league page's own `types.ts` re-exports these plus adds
 * page-specific types (MemberWithProfile, LeaderboardRow, etc.).
 */

export type MatchPlayer = {
  name: string
  avatar_url?: string | null
  user_id?: string | null
  score?: number | null
  holes?: number | null
  /**
   * Score row's approval status: "approved" | "pending" | "rejected".
   * null means no score row exists yet (player hasn't submitted).
   */
  status?: string | null
  /**
   * Timestamp when this player signed off on the match's scores.
   * Null if they haven't approved yet. A match flips to completed
   * server-side once every player's approved_at is non-null.
   */
  approved_at?: string | null
  isBestScore?: boolean
}

export type Match = {
  id: string | number
  league_id: string | number
  period_id?: string | number | null
  course_name?: string | null
  match_date?: string | null
  match_time?: string | null
  status?: string | null
  /** user id of the player who created the match (match admin). */
  created_by?: string | null
}

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
  start_date?: string | null
  end_date?: string | null
}
