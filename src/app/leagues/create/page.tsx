"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

export default function CreateLeaguePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [name, setName] = useState("")
  const [course, setCourse] = useState("")
  const [players, setPlayers] = useState(4)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [leagueId, setLeagueId] = useState<string | number | null>(null)
  const [copied, setCopied] = useState(false)

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
    setCopied(false)

    if (!name.trim() || !course.trim()) {
      setError("Please fill in all fields.")
      return
    }

    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc("create_league", {
        p_name: name.trim(),
        p_course_name: course.trim(),
        p_max_players: players,
      })

      if (rpcError) {
        throw rpcError
      }

      const result = data as
        | { success: boolean; league_id?: string | number; invite_code?: string; error?: string }
        | null

      if (!result || !result.success || !result.league_id || !result.invite_code) {
        setError(result?.error || "Unable to create league. Please try again.")
        return
      }

      setLeagueId(result.league_id)
      setInviteCode(result.invite_code)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const weekCount = Math.max(players - 1, 1)

  const handleCopy = async () => {
    if (!inviteCode) return
    if (typeof navigator === "undefined" || !navigator.clipboard) return

    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard errors
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
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        <header>
          <h1 className="text-2xl font-bold text-primary">Create a League</h1>
          <p className="mt-2 text-sm text-primary/70">
            Get your crew organized. You&apos;ll get an invite code to share once the league is set up.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-primary">
              League name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Saturday Skins"
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="course" className="mb-1 block text-sm font-medium text-primary">
              Golf course
            </label>
            <input
              id="course"
              type="text"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Pebble Beach Golf Links"
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="players" className="mb-1 block text-sm font-medium text-primary">
              Number of players
            </label>
            <div className="flex items-center gap-3">
              <input
                id="players"
                type="number"
                min={4}
                max={10}
                step={1}
                value={players}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10)
                  if (Number.isNaN(value)) return
                  setPlayers(Math.min(10, Math.max(4, value)))
                }}
                className="w-24 rounded-lg border border-primary/20 bg-cream px-3 py-2.5 text-center text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                disabled={submitting}
              />
              <p className="text-xs text-primary/70">
                4–10 players. Ideal for weekly round-robin formats.
              </p>
            </div>
          </div>

          <p className="rounded-lg bg-cream px-4 py-3 text-sm text-primary">
            This league will run for{" "}
            <span className="font-semibold">{weekCount}</span> week{weekCount === 1 ? "" : "s"} with
            1 match per player per week.
          </p>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Creating league…" : "Create League"}
          </button>
        </form>

        {inviteCode && leagueId && (
          <section className="space-y-4 rounded-xl border border-primary/20 bg-primary px-5 py-6 text-cream shadow-sm">
            <h2 className="text-lg font-semibold">Invite your players</h2>
            <p className="text-sm text-cream/80">
              Share this invite code with your friends so they can join your league.
            </p>
            <div className="flex flex-col items-center gap-4 rounded-lg bg-cream/10 p-4">
              <div className="text-3xl font-mono tracking-[0.4em]">
                {inviteCode}
              </div>
              <div className="flex w-full flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={async () => {
                    if (!inviteCode) return
                    const message = `Join my golf league "${name}" on Mulligan League! Code: ${inviteCode}`
                    if (typeof navigator !== "undefined" && navigator.share) {
                      try {
                        await navigator.share({ text: message })
                      } catch {
                        // user cancelled
                      }
                    } else {
                      handleCopy()
                    }
                  }}
                  className="flex-1 rounded-lg bg-cream px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-cream/90 active:scale-[0.98]"
                >
                  Share Invite
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex-1 rounded-lg border border-cream/50 px-4 py-2.5 text-sm font-medium text-cream transition-all hover:bg-cream/10 active:scale-[0.98]"
                >
                  {copied ? "Copied!" : "Copy Code"}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/leagues/${leagueId}`)}
                  className="flex-1 rounded-lg border border-cream/70 px-4 py-2.5 text-sm font-medium text-cream transition-all hover:bg-cream/10 active:scale-[0.98]"
                >
                  Go to League
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

