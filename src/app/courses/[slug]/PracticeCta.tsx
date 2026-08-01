"use client"

/**
 * "Practice round" CTA on a course page. Client island in a server-rendered
 * public page (same pattern as MyCourseStats):
 *
 *   Logged-in  → one tap: create_practice_match(course) then straight into
 *                the hole-by-hole scorecard (/profile/matches?match=X&card=1).
 *   Logged-out → same button, but it routes through the auth page with
 *                ?redirect back here, so after signing in the visitor lands
 *                on this course again with the button one tap away.
 *
 * useAuthContext, NOT useAuth: the hook is a route GUARD that bounces
 * logged-out visitors to "/" — fatal on a public SEO page.
 */

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthContext } from "@/components/AuthProvider"
import { useT } from "@/lib/i18n"
import { track } from "@/lib/analytics"

export function PracticeCta({
  courseId,
  courseName,
  slug,
}: {
  courseId: string
  courseName: string
  slug: string
}) {
  const t = useT()
  const router = useRouter()
  const { user } = useAuthContext()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleStart = async () => {
    if (!user) {
      // Auth page honors ?redirect= after both OAuth and email login.
      router.push(`/?redirect=${encodeURIComponent(`/courses/${slug}`)}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "create_practice_match",
        { p_course_id: courseId, p_course_name: courseName },
      )
      if (rpcError) throw rpcError
      const res = data as {
        success?: boolean
        error?: string
        match_id?: string
      } | null
      if (!res?.success || !res.match_id) {
        setError(res?.error || t("practice.error"))
        return
      }
      track("practice_started", { course_id: courseId })
      router.push(`/profile/matches?match=${res.match_id}&card=1`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("practice.error"))
      setBusy(false)
    }
    // No setBusy(false) on success: keep the button locked through the
    // navigation so a double-tap can't create two practice matches.
  }

  return (
    <section className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <h2 className="text-sm font-bold text-emerald-900">
        {t("practice.cta.title")}
      </h2>
      <p className="mt-0.5 text-xs text-emerald-800/70">
        {user ? t("practice.cta.sub") : t("practice.cta.sub.loggedout")}
      </p>
      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 sm:w-auto"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
        </svg>
        {busy ? t("practice.starting") : t("practice.cta")}
      </button>
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
