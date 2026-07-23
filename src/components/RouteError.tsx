"use client"

import { useEffect } from "react"

/**
 * Shared body for every route-group `error.tsx`. App Router renders the
 * nearest error boundary when a route segment throws during render, so a
 * page-level crash shows this card instead of a blank white app (AUD/T0.5).
 * `reset()` re-attempts the segment without a full reload.
 */
export function RouteError({
  error,
  reset,
  label = "this page",
}: {
  error: Error & { digest?: string }
  reset: () => void
  label?: string
}) {
  useEffect(() => {
    console.error("[RouteError]", error)
  }, [error])

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <h2 className="text-base font-semibold text-primary">
          Something went wrong loading {label}
        </h2>
        <p className="mt-2 text-sm text-primary/60">
          It’s not you — try again in a moment.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
