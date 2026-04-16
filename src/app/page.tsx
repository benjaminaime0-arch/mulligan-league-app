"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { Logo } from "@/components/Logo"

export default function Home() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/dashboard")
      } else {
        setChecking(false)
      }
    })
  }, [router])

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
      </main>
    )
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-cream px-4">
      <div className="mx-auto w-full max-w-md text-center">
        <div className="mx-auto mb-2 flex justify-center">
          <Logo size={200} priority />
        </div>
        <h1 className="sr-only">Mulligan League</h1>
        <p className="mt-3 text-lg text-primary/70">
          Your weekend golf crew, organized.
        </p>
        <p className="mt-1 text-sm text-primary/50">
          Leagues, scores, bragging rights — all in one place.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/signup"
            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            Get Started Free
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-primary/20 bg-white px-6 py-3 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
          >
            Log In
          </Link>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-primary">League Play</p>
            <p className="mt-1 text-xs text-primary/60">Set up a league for your crew. Weekly matchups, generated for you.</p>
          </div>
          <div className="rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-primary">Score Tracking</p>
            <p className="mt-1 text-xs text-primary/60">Post your scores and watch your game evolve round by round.</p>
          </div>
          <div className="rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-primary">Leaderboards</p>
            <p className="mt-1 text-xs text-primary/60">Know exactly who owes who a round of drinks.</p>
          </div>
        </div>
      </div>
    </main>
  )
}
