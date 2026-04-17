export function DraftGuide() {
  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-emerald-800">Getting started</h2>
      <ol className="mt-3 space-y-2 text-sm text-emerald-700">
        <li className="flex items-start gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">1</span>
          <span>Invite players — share the invite code with your group.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">2</span>
          <span>Start the league — this generates weekly match periods.</span>
        </li>
        <li className="flex items-start gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-200 text-xs font-semibold text-emerald-800">3</span>
          <span>Create matches and submit scores to build the leaderboard.</span>
        </li>
      </ol>
    </section>
  )
}
