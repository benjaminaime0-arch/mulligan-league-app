import { useRouter } from "next/navigation"

interface CelebrationCardProps {
  score: number
  holes: 9 | 18
  userAverage: number | null
  leagueId: string | number | null | undefined
  onDismiss: () => void
}

export function CelebrationCard({
  score,
  holes,
  userAverage,
  leagueId,
  onDismiss,
}: CelebrationCardProps) {
  const router = useRouter()

  return (
    <section className="rounded-2xl border border-emerald-200 bg-white p-6 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
        <svg className="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-primary">Score Posted!</h2>
      <p className="mt-1 text-sm text-primary/60">Waiting for another player to approve your score.</p>
      <div className="mt-4 rounded-xl bg-cream p-5">
        <p className="text-4xl font-bold text-primary">{score}</p>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-primary/60">
          {holes} holes
        </p>
      </div>
      {userAverage != null && (
        <p className="mt-3 text-sm text-primary/70">
          {score < userAverage
            ? `${(userAverage - score).toFixed(1)} strokes better than your average!`
            : score > userAverage
            ? `Your average is ${userAverage.toFixed(1)} — keep grinding.`
            : `Right on your average of ${userAverage.toFixed(1)}.`}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        {leagueId && (
          <button
            type="button"
            onClick={() => router.push(`/leagues/${leagueId}`)}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
          >
            View Leaderboard
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-primary/20 bg-white px-5 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
        >
          Done
        </button>
      </div>
    </section>
  )
}
