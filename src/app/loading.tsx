/**
 * Root loading UI. App Router shows this during a route segment's
 * navigation transition, so switching routes shows a branded spinner
 * rather than a blank frame or the previous route's content (T0.5).
 * Client pages still run their own in-component loading gates for their
 * Supabase fetches once mounted.
 */
export default function Loading() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
    </main>
  )
}
