"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

const FORMATS = [
  { value: "stroke_play", label: "Stroke Play" },
  { value: "stableford", label: "Stableford" },
  { value: "match_play", label: "Match Play" },
  { value: "ryder_cup", label: "Ryder Cup" },
  { value: "foursome", label: "Foursome" },
  { value: "greensome", label: "Greensome" },
  { value: "fourball", label: "Four-Ball" },
]

export default function CreateLeaguePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [name, setName] = useState("")
  const [course, setCourse] = useState("")
  const [players, setPlayers] = useState(4)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [scoringCards, setScoringCards] = useState(1)
  const [totalCards, setTotalCards] = useState(1)
  const [format, setFormat] = useState("stroke_play")

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [leagueId, setLeagueId] = useState<string | number | null>(null)
  const [copied, setCopied] = useState(false)

  // Keep scoringCards <= totalCards
  useEffect(() => {
    if (scoringCards > totalCards) {
      setScoringCards(totalCards)
    }
  }, [totalCards, scoringCards])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setCopied(false)

    if (!name.trim() || !course.trim()) {
      setError("Please fill in league name and golf course.")
      return
    }
    if (!startDate || !endDate) {
      setError("Please select both start and end dates.")
      return
    }
    if (new Date(endDate) <= new Date(startDate)) {
      setError("End date must be after start date.")
      return
    }

    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc("create_league", {
        p_name: name.trim(),
        p_course_name: course.trim(),
        p_max_players: players,
        p_start_date: startDate,
        p_end_date: endDate,
        p_scoring_cards: scoringCards,
        p_total_cards: totalCards,
        p_league_type: format,
      })

      if (rpcError) throw rpcError

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

  if (!user) return null

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

          {/* League Name */}
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

          {/* Golf Course */}
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

          {/* Number of Players */}
          <div>
            <label htmlFor="players" className="mb-1 block text-sm font-medium text-primary">
              Number of players
            </label>
            <select
              id="players"
              value={players}
              onChange={(e) => setPlayers(parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n} players
                </option>
              ))}
            </select>
          </div>

          {/* League Duration */}
          <div>
            <p className="mb-1 text-sm font-medium text-primary">League duration</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="startDate" className="mb-1 block text-xs text-primary/60">
                  Start date
                </label>
                <input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="endDate" className="mb-1 block text-xs text-primary/60">
                  End date
                </label>
                <input
                  id="endDate"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={submitting}
                />
                {startDate && endDate && new Date(endDate) <= new Date(startDate) && (
                  <p className="mt-1 text-xs text-red-600">End date must be after start date.</p>
                )}
              </div>
            </div>
          </div>

          {/* Total cards possible */}
          <div>
            <label htmlFor="totalCards" className="mb-1 block text-sm font-medium text-primary">
              Total cards possible
            </label>
            <select
              id="totalCards"
              value={totalCards}
              onChange={(e) => setTotalCards(parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-primary/50">
              Total matches a player can play during the league
            </p>
          </div>

          {/* Scoring cards counted */}
          <div>
            <label htmlFor="scoringCards" className="mb-1 block text-sm font-medium text-primary">
              Total cards counted
            </label>
            <select
              id="scoringCards"
              value={scoringCards}
              onChange={(e) => setScoringCards(parseInt(e.target.value, 10))}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              {Array.from({ length: 10 }, (_, i) => i + 1)
                .filter((n) => n <= totalCards)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-primary/50">
              Best scores counted in the leaderboard
            </p>
          </div>

          {/* Game format */}
          <div>
            <label htmlFor="format" className="mb-1 block text-sm font-medium text-primary">
              Game format
            </label>
            <select
              id="format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            >
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

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
