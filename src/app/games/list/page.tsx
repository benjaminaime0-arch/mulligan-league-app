"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * `/games/list` was a second, orphaned games hub (nothing linked to it —
 * the nav always pointed at `/games`). `/games` is now the canonical hub
 * (T0.6), so this route just forwards there and the duplicated
 * games+members+periods loading block it carried is gone (AUD#23).
 */
export default function GamesListRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/games")
  }, [router])
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-primary/70">Loading games…</p>
    </main>
  )
}
