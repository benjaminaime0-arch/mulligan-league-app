import { isInviteCode } from "@/lib/inviteCodes"

/** Keep the service worker's destination ordering in sync with this function. */
export function notificationTarget(type: string, data: Record<string, unknown> = {}): string | null {
  const text = (key: string) => typeof data[key] === "string" ? data[key] as string : ""
  if (type === "join_rejected") return null
  if (type === "league_invitation") return isInviteCode(text("invite_code")) ? `/join/${text("invite_code")}` : null
  if (text("round_id")) return `/rounds/${encodeURIComponent(text("round_id"))}`
  if (text("match_id")) return `/matches/${encodeURIComponent(text("match_id"))}`
  if (text("game_id") || text("league_id")) return `/games/${encodeURIComponent(text("game_id") || text("league_id"))}`
  if (text("new_member_id")) return `/players/${encodeURIComponent(text("new_member_id"))}`
  return null
}
