"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Script from "next/script"
import { CONSENT_KEY, consentState } from "@/lib/analytics"
import { useI18n } from "@/lib/i18n"

/**
 * CNIL-compliant analytics consent (T1.8).
 *
 * The rule that shapes this component: **GA must not run before consent.**
 * So the gtag <Script> lives here, not in the root layout, and is only
 * rendered once the visitor has actively accepted. Refusing (or ignoring)
 * means no script, no cookie, no events — `track()` is a no-op too.
 *
 * "Refuse" is given the same visual weight as "Accept", which CNIL requires;
 * a decision is remembered in localStorage so the banner asks once.
 */
export function ConsentBanner({ measurementId }: { measurementId?: string }) {
  const { t } = useI18n()
  // null = undecided (show the banner); read in an effect so SSR and the
  // first client render agree.
  const [state, setState] = useState<"granted" | "denied" | null | "unknown">(
    "unknown",
  )

  useEffect(() => {
    setState(consentState())
  }, [])

  const decide = (value: "granted" | "denied") => {
    try {
      window.localStorage.setItem(CONSENT_KEY, value)
    } catch {
      // storage disabled — the choice applies for this page view only
    }
    setState(value)
  }

  // No GA configured → nothing to consent to.
  if (!measurementId) return null

  return (
    <>
      {/* GA is injected ONLY after an explicit grant. */}
      {state === "granted" && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${measurementId}', { anonymize_ip: true });
            `}
          </Script>
        </>
      )}

      {state === null && (
        // bg-white/95, not /98: Tailwind's opacity scale runs in steps of 5, so
        // /98 generates no rule at all — the banner rendered fully transparent
        // over a backdrop-blur, smearing the login form behind the consent text.
        <div
          role="dialog"
          aria-live="polite"
          aria-label={t("consent.title")}
          className="fixed inset-x-0 bottom-0 z-[60] border-t border-primary/10 bg-white/95 p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur md:bottom-4 md:left-auto md:right-4 md:max-w-sm md:rounded-2xl md:border"
        >
          <p className="text-sm font-semibold text-primary">{t("consent.title")}</p>
          <p className="mt-1 text-xs leading-relaxed text-primary/60">
            {t("consent.body")}{" "}
            <Link href="/privacy" className="underline hover:no-underline">
              {t("consent.privacy")}
            </Link>
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => decide("denied")}
              className="flex-1 rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
            >
              {t("consent.refuse")}
            </button>
            <button
              type="button"
              onClick={() => decide("granted")}
              className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-cream hover:bg-primary/90"
            >
              {t("consent.accept")}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
