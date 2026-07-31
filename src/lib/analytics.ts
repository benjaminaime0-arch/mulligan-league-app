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
  | "signup_completed"
  | "onboarding_completed"
  | "invite_link_opened"
  | "invite_preview_viewed"
  | "invite_joined"
  | "game_created"
  | "match_created"
  | "score_entered"
  | "score_confirmed"
  | "scorecard_opened"
  | "home_cta_clicked"

export const CONSENT_KEY = "mulligan.consent.analytics"

/** "granted" | "denied" | null (undecided) */
export function consentState(): "granted" | "denied" | null {
  if (typeof window === "undefined") return null
  const v = window.localStorage.getItem(CONSENT_KEY)
  return v === "granted" || v === "denied" ? v : null
}

export function hasConsent(): boolean {
  return consentState() === "granted"
}

type Gtag = (...args: unknown[]) => void

function gtag(): Gtag | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { gtag?: Gtag }
  return typeof w.gtag === "function" ? w.gtag : null
}

/**
 * Record a funnel event. Safe to call anywhere — server, no-consent, or
 * GA-not-loaded all degrade to a no-op (dev gets a console trace).
 */
export function track(
  event: AnalyticsEvent,
  params: Record<string, string | number | boolean> = {},
): void {
  if (typeof window === "undefined") return
  if (!hasConsent()) return

  const g = gtag()
  if (g) {
    g("event", event, params)
  } else if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[analytics]", event, params)
  }
}
