"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

export default function JoinLeaguePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [code, setCode] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [leagueId, setLeagueId] = useState<string | number | null>(null)

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        router.push("/login")
        return
      }

      setUser(session.user)
      setAuthLoading(false)
    }

    checkSession()
  }, [router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

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
      setSuccessMessage(`You've joined ${result.league_name}!`)
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

  return (
    <main className="min-h-screen bg-cream px-4 py-8">
      <div className="mx-auto flex w-full max-w-md flex-col gap-8">
        <header className="text-center">
          <h1 className="text-2xl font-bold text-primary">Join a League</h1>
          <p className="mt-2 text-sm text-primary/70">
            Enter the 6-character invite code shared by your league organizer.
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

          {successMessage && (
            <div
              role="status"
              className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 text-left"
            >
              {successMessage}
            </div>
          )}

          <div>
            <label
              htmlFor="invite-code"
              className="mb-3 block text-xs font-semibold tracking-[0.25em] text-primary/70"
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
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Joining league…" : "Join League"}
          </button>
        </form>

        {leagueId && (
          <button
            type="button"
            onClick={() => router.push(`/leagues/${leagueId}`)}
            className="w-full rounded-lg border border-primary/30 bg-white px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
          >
            Go to League
          </button>
        )}
      </div>
    </main>
  )
}

