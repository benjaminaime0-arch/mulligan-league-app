import { supabase } from "@/lib/supabase"
import type { Json } from "@/lib/database.types"
export type PersonalLevel = {
  value: number | null
  status: "unavailable" | "provisional" | "established"
  cards_count: number
  cards_used: number
  revision_ids: string[]
}
export type PersonalTee = {
  id: string
  name: string
  course_name: string
  layout_name: string
  hole_count: number
  ready: boolean
  course_rating: number | null
  slope_rating: number | null
}
export type PersonalHole = {
  hole_number: number
  completion: "completed" | "picked_up" | "not_played"
  strokes: number | null
}
export type PersonalRevision = {
  id: string
  revision_number: number
  scores: PersonalHole[]
  gross_total: number | null
  net_total: number | null
  stableford_points: number
  differential: number
  actor_id: string
  correction_reason: string | null
  created_at: string
  playing_handicap: number
}
export type PersonalRoundSummary = {
  id: string
  played_on: string
  status: string
  course_name: string
  tee_name: string
  hole_count: number
  differential: number | null
  gross_total: number | null
  stableford_points: number | null
}
export type PersonalInboxItem = { id: string; played_on: string; status: string; auto_validation_at: string | null; player_name: string; course_name: string; hole_count: number; tee_name: string }
export type PersonalOverview = {
  inbox: PersonalInboxItem[]
  level: PersonalLevel
  official_index: number | null
  tees: PersonalTee[]
  rounds: PersonalRoundSummary[]
  history: {
    level_value: number | null
    cards_count: number
    calculated_at: string
  }[]
}
export type PersonalCard = {
  server_now: string
  is_owner: boolean
  revisions: PersonalRevision[]
  validators: { id: string; name: string }[]
  events: { id: string; action: string; occurred_at: string; actor_id: string | null; actor_name: string | null; metadata: { reason?: string; method?: string } }[]
  round: {
    id: string
    tee_id: string
    played_on: string
    status: string
    draft_version: number
    handicap_index: number
    handicap_source: string
    user_id: string
    validator_id: string | null
    course_timezone: string
    entry_deadline_at: string
    submitted_at: string | null
    validation_requested_at: string | null
    auto_validation_at: string | null
    timer_cancelled_at: string | null
    validated_at: string | null
    validation_method: string | null
  }
  tee: PersonalTee
  reference_holes: {
    hole_number: number
    par: number
    stroke_index: number | null
  }[]
  holes: PersonalHole[]
  revision: PersonalRevision | null
  level: PersonalLevel
  leagues: {
    id: string
    name: string
    reason: string | null
    attestation: string | null
    format: string | null
    submission_status: string | null
    submission_id: string | null
  }[]
}
export type PersonalLeague = {
  closure_status: string
  rules: { tee_id: string; format: string; attestation: string }
  game: {
    id: string
    name: string
    start_date: string
    end_date: string
    scoring_cards_count: number
    invite_code: string
    status: string
  }
  tee: { name: string; course_name: string; hole_count: number }
  board: {
    position: number | null
    user_id: string
    player_name: string
    total_score: number
    best_score: number | null
    rounds_counted: number
    rounds_played: number
  }[]
  submissions: {
    id: string
    round_id: string
    user_id: string
    player_name: string
    played_on: string
    status: string
    reason: string | null
    card_status: string
    validator_id: string | null
    auto_validation_at: string | null
    revision_number: number
    gross_total: number | null
    net_total: number | null
    stableford_points: number
    scores: PersonalHole[]
  }[]
}
export function personalResult<T>(result: {
  data: unknown
  error: { message: string } | null
}): T {
  if (result.error) throw new Error(result.error.message)
  return result.data as T
}
export async function loadPersonalOverview() {
  return personalResult<PersonalOverview>(
    await supabase.rpc("get_personal_overview"),
  )
}
export async function loadPersonalCard(id: string) {
  return personalResult<PersonalCard>(
    await supabase.rpc("get_personal_card", { p_round: id }),
  )
}
export function holesAsJson(holes: PersonalHole[]): Json {
  return holes.map((h) => ({ ...h }))
}
export function cardIsComplete(holes: PersonalHole[], count: number): boolean {
  return (
    (count === 9 || count === 18) &&
    holes.length === count &&
    new Set(holes.map((h) => h.hole_number)).size === count &&
    holes.every(
      (h) =>
        h.hole_number >= 1 &&
        h.hole_number <= count &&
        (h.completion === "picked_up" ||
          (h.completion === "completed" &&
            Number.isInteger(h.strokes) &&
            h.strokes! >= 1 &&
            h.strokes! <= 30)),
    )
  )
}
export const personalInput =
  "w-full rounded-lg border border-primary/20 bg-white px-3 py-2.5 text-sm disabled:opacity-50"
export const personalButton =
  "rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-cream disabled:opacity-50"
