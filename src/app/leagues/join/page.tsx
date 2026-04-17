"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

export default function JoinLeaguePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-cream">
          <p className="text-primary/70">Loading…</p>
        </main>
      }
    >
      <JoinLeagueContent />
    </Suspense>
  )
}

function JoinLeagueContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const [code, setCode] = useState(searchParams.get("code")?.toUpperCase().slice(0, 6) || "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leagueId, setLeagueId] = useState<string | number | null>(null)
  const [successLeagueName, setSuccessLeagueName] = useState<string | null>(null)
  const [successCourseName, setSuccessCourseName] = useState<string | null>(null)
  const [successMemberCount, setSuccessMemberCount] = useState<number>(0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmed = code.trim().toUpperCase()
    if (trimmed.length !== 6) {
      setError("Invite code must be 6 characters.")
      return
    }

    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc("join_league_by_code", {
        code: trimmed,
      })

      if (rpcError) {
        throw rpcError
      }

      const result = data as
        | { success: boolean; league_id?: string | number; league_name?: string; error?: string }
        | null

      if (!result || !result.success || !result.league_id || !result.league_name) {
        const message =
          result?.error ||
          "Unable to join league. The code may be invalid, the league may be full, or you may already be a member."
        setError(message)
        return
      }

      setLeagueId(result.league_id)
      setSuccessLeagueName(result.league_name ?? null)

      // Fetch additional league details for the success card
      const [leagueRes, membersRes] = await Promise.all([
        supabase
          .from("leagues")
          .select("course_name")
          .eq("id", result.league_id)
          .maybeSingle(),
        supabase
          .from("league_members")
          .select("id")
          .eq("league_id", result.league_id),
      ])
      setSuccessCourseName(
        (leagueRes.data as { course_name?: string | null } | null)?.course_name ?? null
      )
      setSuccessMemberCount(membersRes.data?.length ?? 0)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong. Please try again."
      if (message.toLowerCase().includes("invalid")) {
        setError("Invalid invite code.")
      } else if (message.toLowerCase().includes("full")) {
        setError("This league is full.")
      } else if (message.toLowerCase().includes("already")) {
        setError("You are already a member of this league.")
      } else {
        setError(message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Checking your session…</p>
      </main>
    )
  }

  if (!user) {
    return null
  }

  // Success state — replace entire form with success card
  if (leagueId) {
    return (
      <main className="min-h-screen bg-cream px-4 py-8">
        <div className="mx-auto flex w-full max-w-md flex-col gap-8">
          <div className="rounded-2xl border border-primary/15 bg-white p-8 text-center shadow-sm">
            {/* Checkmark */}
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>

            <h2 className="text-xl font-bold text-primary">You&apos;re in!</h2>

            <p className="mt-2 text-lg font-semibold text-primary">
              {successLeagueName}
            </p>

            <p className="mt-1 text-sm text-primary/60">
              {successCourseName || "Course TBA"}
              {" · "}
              {successMemberCount} member{successMemberCount !== 1 ? "s" : ""}
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => router.push(`/leagues/${leagueId}`)}
                className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98]"
              >
                Go to League
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="w-full rounded-lg border border-primary/30 bg-white px-4 py-3 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <header className="text-center">
          <h1 className="text-2xl font-bold text-primary">Join a League</h1>
          <p className="mt-2 text-sm text-primary/70">
            Got a code from a friend? Punch it in and you&apos;re in.
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-xl border border-primary/15 bg-white p-6 text-center shadow-sm"
        >
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 text-left">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="invite-code"
              className="mb-3 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60"
            >
              INVITE CODE
            </label>
            <input
              id="invite-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              maxLength={6}
              autoComplete="off"
              className="mx-auto block w-full max-w-xs rounded-xl border border-primary/30 bg-cream px-4 py-3 text-center text-3xl font-mono tracking-[0.4em] text-primary placeholder:text-primary/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="ABC123"
              inputMode="text"
              disabled={submitting}
            />
            <p className="mt-2 text-xs text-primary/60">
              6 letters and numbers, not case sensitive.
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Joining league…" : "Join League"}
          </button>
        </form>
      </div>
    </main>
  )
}

