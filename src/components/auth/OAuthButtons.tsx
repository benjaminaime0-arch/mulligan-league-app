"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabase"
import { useI18n } from "@/lib/i18n"
import { track } from "@/lib/analytics"

/**
 * Google / Apple sign-in (T1.1, US1).
 *
 * Both providers route through Supabase Auth and land on /auth/callback,
 * which decides onboarding-vs-home. Account linking for an existing email is
 * handled by Supabase itself when "Link accounts with the same email" is
 * enabled on the project (Auth → Providers).
 *
 * The buttons render whenever the app is built; if a provider isn't
 * configured in Supabase yet the SDK returns a clear error, which we surface
 * inline rather than failing silently.
 *
 * PWA/iOS note: signInWithOAuth performs a full-page redirect (not a popup),
 * which is what works inside an installed PWA and iOS Safari.
 */
export function OAuthButtons({ redirectTo }: { redirectTo?: string | null }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState<"google" | "apple" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const signIn = async (provider: "google" | "apple") => {
    setError(null)
    setLoading(provider)
    track("signup_started", { provider })
    try {
      const next = redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ""
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback${next}`,
        },
      })
      if (oauthError) throw oauthError
      // On success the browser navigates away; nothing else to do here.
    } catch (err) {
      setLoading(null)
      const msg = err instanceof Error ? err.message : "Sign-in failed."
      setError(
        /provider is not enabled/i.test(msg)
          ? t("auth.provider.off", { provider: provider === "google" ? "Google" : "Apple" })
          : msg,
      )
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={() => signIn("google")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-primary/20 bg-white px-4 py-3 font-medium text-primary transition-all hover:bg-cream active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleMark />
        {loading === "google" ? t("auth.redirecting") : t("auth.google")}
      </button>

      <button
        type="button"
        onClick={() => signIn("apple")}
        disabled={loading !== null}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-primary/20 bg-black px-4 py-3 font-medium text-white transition-all hover:bg-black/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <AppleMark />
        {loading === "apple" ? t("auth.redirecting") : t("auth.apple")}
      </button>

      <div className="flex items-center gap-3 pt-1">
        <span className="h-px flex-1 bg-primary/10" />
        <span className="text-xs uppercase tracking-wide text-primary/40">{t("auth.or")}</span>
        <span className="h-px flex-1 bg-primary/10" />
      </div>
    </div>
  )
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

function AppleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.78c.02 2.6 2.28 3.47 2.3 3.48-.02.06-.36 1.24-1.19 2.45-.72 1.05-1.47 2.1-2.65 2.12-1.16.02-1.53-.69-2.86-.69-1.32 0-1.74.67-2.83.71-1.14.04-2.01-1.13-2.73-2.18-1.49-2.15-2.63-6.08-1.1-8.73.76-1.32 2.12-2.15 3.59-2.17 1.11-.02 2.17.75 2.85.75.68 0 1.96-.93 3.3-.79.56.02 2.14.23 3.15 1.71-.08.05-1.88 1.1-1.86 3.29M14.2 4.6c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.55 1.31-.56.65-1.05 1.68-.92 2.68.97.07 1.96-.49 2.57-1.23" />
    </svg>
  )
}
