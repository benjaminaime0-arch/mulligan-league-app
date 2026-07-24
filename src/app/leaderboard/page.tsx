"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/**
 * The global Leaderboard route is retired (T1.5). Standings live inside each
 * game's workspace; Home summarizes your position across games. This route
 * forwards to Home so any old links / bookmarks keep working.
 */
export default function LeaderboardRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/home")
  }, [router])
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-primary/70">Standings now live inside each game…</p>
    </main>
  )
}
