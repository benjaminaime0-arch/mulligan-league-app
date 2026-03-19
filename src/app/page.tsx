"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

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
        <h1 className="text-4xl font-bold text-primary">Mulligan League</h1>
        <p className="mt-3 text-lg text-primary/70">
          Track your golf rounds. Compete with friends.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/signup"
            className="rounded-lg bg-primary px-6 py-3 text-sm font-medium text-cream hover:bg-primary/90"
          >
            Create Account
          </Link>
          <Link
            href="/login"
            className="rounded-lg border border-primary/20 bg-white px-6 py-3 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Log In
          </Link>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-primary">League Play</p>
            <p className="mt-1 text-xs text-primary/60">Organize round-robin tournaments with your group.</p>
          </div>
          <div className="rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-primary">Score Tracking</p>
            <p className="mt-1 text-xs text-primary/60">Log rounds and track your progress over time.</p>
          </div>
          <div className="rounded-xl border border-primary/10 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-primary">Leaderboards</p>
            <p className="mt-1 text-xs text-primary/60">See where you stack up against your friends.</p>
          </div>
        </div>
      </div>
    </main>
  )
}
