import { useState } from "react"

interface ScoreSubmitFormProps {
  onSubmit: (score: number, holes: 9 | 18) => Promise<void>
}

export function ScoreSubmitForm({ onSubmit }: ScoreSubmitFormProps) {
  const [showForm, setShowForm] = useState(false)
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
      await onSubmit(numericScore, holes)
      setShowForm(false)
      setScoreValue("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit score. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-primary">Submit your score</h2>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-cream hover:bg-primary/90"
          >
            Submit Score
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="score" className="mb-1 block text-sm font-medium text-primary">
              Score
            </label>
            <input
              id="score"
              type="number"
              min={1}
              value={scoreValue}
              onChange={(e) => setScoreValue(e.target.value)}
              className="w-full rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-center text-2xl font-semibold text-primary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="72"
              disabled={submitting}
            />
          </div>

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

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit Score"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!submitting) {
                  setShowForm(false)
                  setError(null)
                }
              }}
              className="rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!showForm && (
        <p className="mt-1 text-xs text-primary/60">
          How&apos;d you play? Submit your score below.
        </p>
      )}
    </section>
  )
}
