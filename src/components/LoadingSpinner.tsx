export function LoadingSpinner({ message = "Loading…" }: { message?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
        <p className="text-sm text-primary/70">{message}</p>
      </div>
    </main>
  )
}
