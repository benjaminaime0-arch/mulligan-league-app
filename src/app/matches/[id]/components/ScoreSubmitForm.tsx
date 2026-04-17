import { useState } from "react"
import { Avatar } from "@/components/Avatar"
import type { MatchPlayerWithProfile } from "../types"

interface ScoreSubmitFormProps {
  players: MatchPlayerWithProfile[]
  existingScores: Map<string, number> // user_id → score
  onSubmit: (scores: Array<{ user_id: string; score: number; holes: number }>) => Promise<void>
  memberDisplayName: (player: MatchPlayerWithProfile) => string
}

export function ScoreSubmitForm({
  players,
  existingScores,
  onSubmit,
  memberDisplayName,
}: ScoreSubmitFormProps) {
  const [showForm, setShowForm] = useState(false)
  const [holes, setHoles] = useState<9 | 18>(18)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One score input per player
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const p of players) {
      const existing = existingScores.get(p.user_id)
      initial[p.user_id] = existing != null ? String(existing) : ""
    }
    return initial
  })

  const updateScore = (userId: string, value: string) => {
    setScoreInputs((prev) => ({ ...prev, [userId]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate all scores
    const scores: Array<{ user_id: string; score: number; holes: number }> = []
    for (const player of players) {
      const raw = scoreInputs[player.user_id]?.trim()
      const num = Number(raw)
      if (!raw || Number.isNaN(num) || num <= 0) {
        const name = memberDisplayName(player)
        setError(`Enter a valid score for ${name}.`)
        return
      }
      scores.push({ user_id: player.user_id, score: num, holes })
    }

    setSubmitting(true)
    try {
      await onSubmit(scores)
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit scores.")
    } finally {
      setSubmitting(false)
    }
  }

  const hasExistingScores = existingScores.size > 0

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-primary">
          {hasExistingScores ? "Update scores" : "Submit scores"}
        </h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-cream hover:bg-primary/90"
          >
            {hasExistingScores ? "Edit Scores" : "Enter Scores"}
          </button>
        )}
      </div>

      {!showForm && (
        <p className="mt-1 text-xs text-primary/60">
          {hasExistingScores
            ? "You can update scores for all players. Editing resets approvals."
            : "Enter scores for all players in this match."}
        </p>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Holes selector */}
          <div>
            <p className="mb-1 text-sm font-medium text-primary">Holes</p>
            <div className="inline-flex rounded-full bg-cream p-1">
              {[9, 18].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setHoles(value as 9 | 18)}
                  className={`min-w-[3rem] rounded-full px-3 py-1.5 text-xs font-medium ${
                    holes === value
                      ? "bg-primary text-cream"
                      : "text-primary hover:bg-primary/10"
                  }`}
                  disabled={submitting}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          {/* Score inputs for each player */}
          <div className="space-y-3">
            {players.map((player) => {
              const name = memberDisplayName(player)
              return (
                <div key={player.user_id} className="flex items-center gap-3">
                  <Avatar
                    src={player.profiles?.avatar_url}
                    alt={name}
                    size={32}
                    fallback={name}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
                    {name}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={scoreInputs[player.user_id] || ""}
                    onChange={(e) => updateScore(player.user_id, e.target.value)}
                    className="w-20 rounded-lg border border-primary/30 bg-cream px-3 py-2 text-center text-lg font-semibold text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="—"
                    disabled={submitting}
                  />
                </div>
              )
            })}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting…" : hasExistingScores ? "Update Scores" : "Submit All Scores"}
            </button>
            <button
              type="button"
              onClick={() => { if (!submitting) { setShowForm(false); setError(null) } }}
              className="rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
