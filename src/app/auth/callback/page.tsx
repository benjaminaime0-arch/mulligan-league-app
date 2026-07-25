"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"

/**
 * OAuth landing route (T1.1).
 *
 * Supabase's JS client parses the session out of the URL (PKCE `?code=` or
 * the implicit `#access_token=` hash) automatically because the browser
 * client is created with `detectSessionInUrl: true`. This page waits for
 * that session to materialise, then routes:
 *
 *   no username on the profile  → /welcome   (finish onboarding)
 *   otherwise                   → ?next= or /home
 *
 * A client page (not a route handler) is correct here: the implicit-flow
 * token lives in the URL *fragment*, which never reaches the server.
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<Waiting />}>
      <CallbackContent />
    </Suspense>
  )
}

function Waiting({ message = "Signing you in…" }: { message?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="text-sm text-primary/60">{message}</p>
      </div>
    </main>
  )
}

function CallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get("next")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let done = false

    const route = async (userId: string) => {
      if (done) return
      done = true
      // New social sign-ups have no username yet → send them to onboarding.
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle()

      const target = profile?.username
        ? next || "/home"
        : `/welcome${next ? `?next=${encodeURIComponent(next)}` : ""}`
      router.replace(target)
    }

    // The session may already be present, or arrive moments later once the
    // SDK finishes exchanging the code — handle both.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) route(data.session.user.id)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) route(session.user.id)
    })

    // If nothing shows up, the link was stale or the provider errored.
    const timeout = setTimeout(() => {
      if (!done) {
        const desc = searchParams.get("error_description")
        setError(desc || "We couldn't complete that sign-in. Please try again.")
      }
    }, 8000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [router, next, searchParams])

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => router.replace("/")}
            className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
          >
            Back to sign in
          </button>
        </div>
      </main>
    )
  }

  return <Waiting />
}
