"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

type LeagueMemberWithLeague = {
  id: string | number
  league_id: string | number
  leagues: {
    id: string | number
    name: string
    course_name?: string | null
    max_players?: number | null
    status?: string | null
  } | null
}

export default function LeaguesPage() {
  const router = useRouter()
  const isMountedRef = useRef(true)

  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [memberships, setMemberships] = useState<LeagueMemberWithLeague[]>([])

  useEffect(() => {
    isMountedRef.current = true

    const loadLeagues = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) throw sessionError

        if (!session) {
          router.replace("/login")
          return
        }

        if (isMountedRef.current) {
          setUser(session.user)
          setError(null)
        }

        const { data, error: membershipsError } = await supabase
          .from("league_members")
          .select("*, leagues(*)")
          .eq("user_id", session.user.id)

        if (membershipsError) throw membershipsError

        if (isMountedRef.current) {
          setMemberships((data || []) as LeagueMemberWithLeague[])
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load your leagues.")
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false)
        }
      }
    }

    void loadLeagues()

    return () => {
      isMountedRef.current = false
    }
  }, [router])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading your leagues…</p>
      </main>
    )
  }

  if (!user) return null

  return (
    <main className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary/60">Leagues</p>
            <h1 className="mt-1 text-2xl font-bold text-primary">Your active competitions</h1>
            <p className="mt-1 text-sm text-primary/70">Open a league, check the table, and keep the season moving.</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/leagues/create"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream hover:bg-primary/90"
            >
              Create League
            </Link>
            <Link
              href="/leagues/join"
              className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Join League
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2">
          {memberships.length === 0 ? (
            <div className="md:col-span-2 rounded-2xl border border-dashed border-primary/20 bg-white p-8 text-center shadow-sm">
              <h2 className="text-lg font-semibold text-primary">No leagues yet</h2>
              <p className="mt-2 text-sm text-primary/70">Create one or join with an invite code to start the competition.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Link href="/leagues/create" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream hover:bg-primary/90">
                  Create League
                </Link>
                <Link href="/leagues/join" className="rounded-lg border border-primary/20 bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                  Join League
                </Link>
              </div>
            </div>
          ) : (
            memberships.map((membership) => {
              const league = membership.leagues
              if (!league) return null

              return (
                <Link
                  key={membership.id}
                  href={`/leagues/${league.id}`}
                  className="block rounded-2xl border border-primary/15 bg-white p-5 shadow-sm transition-transform hover:-translate-y-0.5 hover:bg-primary/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-primary">{league.name}</h2>
                      <p className="mt-1 text-sm text-primary/70">{league.course_name || "Course TBA"}</p>
                    </div>
                    <span className="rounded-full bg-cream px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-primary/60">
                      {league.status || "active"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 text-sm text-primary/70">
                    <span>{typeof league.max_players === "number" ? `Up to ${league.max_players} players` : "Open competition"}</span>
                    <span className="font-medium text-primary">Open League</span>
                  </div>
                </Link>
              )
            })
          )}
        </section>
      </div>
    </main>
  )
}