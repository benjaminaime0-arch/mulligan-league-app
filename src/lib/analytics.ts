/**
 * Funnel analytics (T1.8).
 *
 * Events are the ones the delivery spec measures the activation funnel with.
 * Nothing is sent unless the visitor has actively granted consent (CNIL —
 * see ConsentBanner): `track()` is a no-op while consent is absent or
 * refused, and the GA script itself is only injected after acceptance, so
 * no analytics cookie is written beforehand.
 */

export type AnalyticsEvent =
  | "signup_started"
  | "signup_confirmation_requested"
  | "signup_completed"
  | "onboarding_completed"
  | "invite_link_opened"
  | "invite_preview_viewed"
  | "invite_joined"
  | "invite_shared"
  | "game_created"
  | "match_created"
  | "score_entered"
  | "score_confirmed"
  | "match_finalized"
  | "scorecard_opened"
  | "live_share_enabled"
  | "home_cta_clicked"
  | "practice_started"
  | "league_create_viewed"
  | "league_card_submitted"
  | "league_progress_viewed"
  | "course_league_viewed"
  | "league_cta_clicked"
  | "signup_viewed"

export const CONSENT_KEY = "mulligan.consent.analytics"
export const ANALYTICS_READY = "mulligan:analytics-ready"
export const CONSENT_CHANGED = "mulligan:consent-changed"

/** "granted" | "denied" | null (undecided) */
export function consentState(): "granted" | "denied" | null {
  if (typeof window === "undefined") return null
  try {
    const v = window.localStorage.getItem(CONSENT_KEY)
    return v === "granted" || v === "denied" ? v : null
  } catch { return null }
}

export function hasConsent(): boolean {
  return consentState() === "granted"
}

type Gtag = (...args: unknown[]) => void
type Params = Record<string, string | number | boolean>
const pending: { event: AnalyticsEvent; params: Params }[] = []
const seen = new Set<string>()

/** Only predefined public entry labels are retained, and only after consent. */
function entryPoint(): string {
  const allowed = ["course_rueil", "course_jardy", "league_guide", "homepage"]
  try {
    const entry = new URLSearchParams(window.location.search).get("entry")
    if (entry && allowed.includes(entry)) window.sessionStorage.setItem("mulligan.entry", entry)
    const stored = window.sessionStorage.getItem("mulligan.entry")
    return stored && allowed.includes(stored) ? stored : "app"
  } catch { return "app" }
}

export function flushAnalytics(): void {
  if (!hasConsent()) { pending.length = 0; return }
  const g = gtag()
  if (g) pending.splice(0).forEach(({ event, params }) => g("event", event, params))
}

function gtag(): Gtag | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { gtag?: Gtag }
  return typeof w.gtag === "function" ? w.gtag : null
}

/**
 * Record a funnel event. Safe to call anywhere — server, no-consent, or
 * absent/refused consent degrade to a no-op. With consent, events wait
 * briefly in memory for GA to initialise.
 */
export function track(
  event: AnalyticsEvent,
  params: Params = {},
): boolean {
  if (typeof window === "undefined" || !hasConsent()) return false

  const data = { entry_point: entryPoint(), ...params }
  const g = gtag()
  if (g) {
    flushAnalytics()
    g("event", event, data)
  } else {
    // A granted visitor can act before the script finishes loading.
    if (pending.length === 50) pending.shift()
    pending.push({ event, params: data })
  }
  return true
}

/** Per-tab deduplication for view snapshots; never presented as global milestones. */
export function trackOnce(event: AnalyticsEvent, key: string, params: Params = {}): void {
  if (!hasConsent()) return
  const id = `mulligan.analytics.${event}.${key}`
  if (seen.has(id)) return
  try { if (window.sessionStorage.getItem(id)) return } catch { /* In-memory fallback. */ }
  if (track(event, params)) {
    seen.add(id)
    try { window.sessionStorage.setItem(id, "1") } catch { /* In-memory fallback. */ }
  }
}
