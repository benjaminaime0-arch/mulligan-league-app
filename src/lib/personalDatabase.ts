// Additive RPC contract for the personal-card migrations. Keep the generated
// legacy schema intact; regenerate and merge after production deployment.
import type { Database as Legacy, Json } from "./database.types"
type PersonalFunctions = {
  confirm_card_into_league: { Args: { p_round: string; p_expected_version: number; p_validator: string | null; p_game: string }; Returns: Json }
  request_personal_validation: { Args: { p_round: string; p_expected_version: number; p_validator: string | null }; Returns: Json }
  review_personal_card: { Args: { p_round: string; p_revision: string; p_scores?: Json | null; p_reason?: string | null; p_present: boolean }; Returns: Json }
  resolve_personal_correction: { Args: { p_round: string; p_revision: string; p_accept: boolean }; Returns: Json }

  get_personal_overview: { Args: never; Returns: Json }
  get_personal_leagues: { Args: never; Returns: Json }
  get_personal_card: { Args: { p_round: string }; Returns: Json }
  get_personal_league: { Args: { p_game: string }; Returns: Json }
  declare_personal_index: { Args: { p_index: number | null }; Returns: Json }
  create_calendar_league: { Args: { p_name: string; p_tee: string; p_start: string; p_duration_months: number; p_format: string; p_cards?: number; p_attestation?: string }; Returns: Json }
  create_personal_round: {
    Args: { p_tee: string; p_played_on: string }
    Returns: Json
  }
  save_personal_card: {
    Args: { p_round: string; p_holes: Json; p_expected_version: number }
    Returns: Json
  }
  confirm_personal_card: {
    Args: { p_round: string; p_expected_version: number }
    Returns: Json
  }
  create_personal_league: {
    Args: {
      p_name: string
      p_tee: string
      p_start: string
      p_end: string
      p_format: string
      p_cards?: number
      p_attestation?: string
    }
    Returns: Json
  }
  submit_personal_card_to_leagues: {
    Args: { p_round: string; p_games: string[]; p_revision: string }
    Returns: Json
  }
  submit_personal_card: {
    Args: { p_round: string; p_game: string }
    Returns: Json
  }
  attest_personal_card: {
    Args: { p_submission: string; p_approve: boolean; p_present: boolean }
    Returns: Json
  }
}
export type Database = Omit<Legacy, "public"> & {
  public: Omit<Legacy["public"], "Functions"> & {
    Functions: Legacy["public"]["Functions"] & PersonalFunctions
  }
}
