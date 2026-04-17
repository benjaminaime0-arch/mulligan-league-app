import { useState } from "react"
import type { Score } from "../types"

interface ScoreEditSectionProps {
  currentUserScore: Score
  onUpdate: (score: number, holes: 9 | 18) => Promise<void>
}

export function ScoreEditSection({ currentUserScore, onUpdate }: ScoreEditSectionProps) {
  const [editing, setEditing] = useState(false)
  const [scoreValue, setScoreValue] = useState("")
  const [holes, setHoles] = useState<9 | 18>(18)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmed = scoreValue.trim()
    const numericScore = Number(trimmed)
    if (!trimmed || Number.isNaN(numericScore) || numericScore <= 0) {
      setError("Enter a valid score.")
      return
    }

    setSubmitting(true)
    try {
      await onUpdate(numericScore, holes)
      setEditing(false)
      setScoreValue("")
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update score. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const startEditing = () => {
    if (currentUserScore.status === "approved") {
      if (!window.confirm("This score is already approved. Editing will reset approval and another player will need to re-approve. Continue?")) return
    }
    setScoreValue(String(currentUserScore.score))
    setHoles(currentUserScore.holes as 9 | 18)
    setEditing(true)
  }

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
      {editing ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <h2 className="text-sm font-semibold text-primary">Edit your score</h2>
          <p className="text-xs text-primary/60">Editing will reset approval — another player will need to re-approve.</p>
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="edit-score" className="mb-1 block text-sm font-medium text-primary">Score</label>
            <input
              id="edit-score" type="number" min={1} value={scoreValue}
              onChange={(e) => setScoreValue(e.target.value)}
              className="w-full rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-center text-2xl font-semibold text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              disabled={submitting}
            />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-primary">Holes</p>
            <div className="inline-flex rounded-full bg-cream p-1">
              {[9, 18].map((value) => (
                <button key={value} type="button" onClick={() => setHoles(value as 9 | 18)}
                  className={`min-w-[3rem] rounded-full px-3 py-1.5 text-xs font-medium ${holes === value ? "bg-primary text-cream" : "text-primary hover:bg-primary/10"}`}
                  disabled={submitting}>{value}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={submitting}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60">
              {submitting ? "Saving…" : "Save Changes"}
            </button>
            <button type="button" onClick={() => { if (!submitting) { setEditing(false); setError(null) } }}
              className="rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Your Score</p>
            <p className="mt-1 text-lg font-bold text-primary">
              {currentUserScore.score} <span className="text-sm font-normal text-primary/60">({currentUserScore.holes} holes)</span>
            </p>
            <p className="mt-0.5 text-xs text-primary/50">
              {currentUserScore.status === "approved" ? "Approved" : "Pending approval from another player"}
            </p>
          </div>
          <button type="button" onClick={startEditing}
            className="rounded-lg border border-primary/20 bg-white px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">
            Edit Score
          </button>
        </div>
      )}
    </section>
  )
}
