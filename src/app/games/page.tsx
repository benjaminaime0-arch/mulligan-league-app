"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

export default function GamesRedirect() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [noGames, setNoGames] = useState(false)

  useEffect(() => {
    if (authLoading || !user) return

    const redirect = async () => {
      const { data, error } = await supabase
        .from("game_members")
        .select("game_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle()

      if (error || !data) {
        setNoGames(true)
        return
      }

      router.replace(`/games/${data.game_id}`)
    }

    redirect()
  }, [authLoading, user, router])

  if (authLoading || (!noGames)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-primary/70">Loading games…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 pt-16">
        <section className="w-full rounded-xl border border-dashed border-primary/20 bg-white p-6 text-center shadow-sm">
          <h2 className="text-base font-semibold text-primary">No games yet</h2>
          <p className="mt-2 text-sm text-primary/70">
            Start a game for your crew, or ask a buddy for their invite code.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              href="/games/create"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
            >
              Create Game
            </Link>
            <Link
              href="/games/join"
              className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Join Game
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}
