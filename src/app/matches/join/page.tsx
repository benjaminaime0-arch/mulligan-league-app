"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { LoadingSpinner } from "@/components/LoadingSpinner"

export default function JoinMatchPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [code, setCode] = useState("")
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    const trimmed = code.trim().toUpperCase()
    if (!trimmed || trimmed.length !== 6) {
      setError("Enter a valid 6-character invite code.")
      return
    }

    setError(null)
    setSuccess(null)
    setJoining(true)

    try {
      // Look up match by invite code
      const { data: match, error: matchError } = await supabase
        .from("matches")
        .select("id, course_name, match_date, match_type")
        .eq("invite_code", trimmed)
        .single()

      if (matchError || !match) {
        setError("No match found with this code. Check and try again.")
        return
      }

      // Check if already a player
      const { data: existing } = await supabase
        .from("match_players")
        .select("id")
        .eq("match_id", match.id)
        .eq("user_id", user.id)
        .maybeSingle()

      if (existing) {
        setSuccess("You are already in this match.")
        setTimeout(() => router.push(`/matches/${match.id}`), 1000)
        return
      }

      // Add user as a player
      const { error: joinError } = await supabase
        .from("match_players")
        .insert({ match_id: match.id, user_id: user.id })

      if (joinError) throw joinError

      setSuccess(`Joined match at ${match.course_name || "the course"}!`)
      setTimeout(() => router.push(`/matches/${match.id}`), 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join match.")
    } finally {
      setJoining(false)
    }
  }

  if (authLoading) return <LoadingSpinner message="Checking your session…" />
  if (!user) return null

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold text-primary">Join a Match</h1>
          <p className="mt-1 text-sm text-primary/70">
            Enter the 6-character code shared by the match creator.
          </p>
        </header>

        <form
          onSubmit={handleJoin}
          className="space-y-5 rounded-xl border border-primary/15 bg-white p-5 shadow-sm"
        >
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {success}
            </div>
          )}

          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium text-primary">
              Invite Code
            </label>
            <input
              id="code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              maxLength={6}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-3 text-center font-mono text-xl tracking-[0.2em] text-primary placeholder:text-primary/30 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={joining}
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={joining || code.trim().length !== 6}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-medium text-cream transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {joining ? "Joining…" : "Join Match"}
          </button>
        </form>
      </div>
    </main>
  )
}
