"use client"

/**
 * `/matches/[id]` is retired as a standalone surface — all match
 * interactions (edit scores, approve, invite, share, leave/delete)
 * now live inline on the parent league page's match carousel.
 *
 * This route is kept as a thin client redirect so that old deep
 * links (notifications, emails, shared invites, bookmarks) keep
 * working. It:
 *
 *   1. Fetches the match's league_id
 *   2. Forwards any `?edit=1` query as `?match=[id]&edit=1` on the
 *      league URL so the league page can auto-select that match +
 *      auto-open the score editor
 *   3. Falls back to /dashboard if the match is gone or not visible
 *      to the current user (RLS-filtered)
 *
 * The previous full-page experience (1000+ lines) along with its
 * components/ directory has been removed. Everything ports to
 * `src/app/leagues/[id]/components/MatchDetailCard.tsx`.
 */

import { useEffect, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { LoadingSpinner } from "@/components/LoadingSpinner"

export default function MatchRedirectPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const matchId = params?.id
    if (!matchId) return

    const run = async () => {
      const { data, error: fetchError } = await supabase
        .from("matches")
        .select("league_id")
        .eq("id", matchId)
        .maybeSingle()

      if (fetchError) {
        setError(fetchError.message)
        return
      }

      const leagueId = data?.league_id as string | null | undefined

      if (!leagueId) {
        // Match isn't visible (RLS), or doesn't exist, or was
        // casual (shouldn't happen post-purge). Punt to dashboard.
        router.replace("/dashboard")
        return
      }

      // Preserve the auto-edit intent by passing `match` + `edit` on
      // the league URL. League page reads these and delegates to
      // ScheduledMatches → MatchDetailCard.
      const edit = searchParams?.get("edit") === "1"
      const qs = new URLSearchParams()
      qs.set("match", matchId)
      if (edit) qs.set("edit", "1")

      router.replace(`/leagues/${leagueId}?${qs.toString()}`)
    }

    run()
  }, [params, router, searchParams])

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream px-4">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-5 text-center shadow-sm">
          <p className="text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream"
          >
            Back to dashboard
          </button>
        </div>
      </main>
    )
  }

  return <LoadingSpinner message="Loading match…" />
}
