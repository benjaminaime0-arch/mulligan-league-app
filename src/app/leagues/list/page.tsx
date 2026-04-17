"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

type League = {
  id: string | number
  name: string
  course_name?: string | null
  max_players?: number | null
  status?: string | null
}

type MemberWithLeague = {
  id: string | number
  league_id: string | number
  leagues?: League | null
}

export default function LeagueListPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [leagues, setLeagues] = useState<League[]>([])
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading || !user) return

    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        const { data: memberRows, error: memberError } = await supabase
          .from("league_members")
          .select("*, leagues(*)")
          .eq("user_id", user.id)

        if (memberError) {
          throw memberError
        }

        const typedMembers = (memberRows || []) as MemberWithLeague[]
        const leagueMap = new Map<string | number, League>()
        for (const m of typedMembers) {
          if (m.leagues && !leagueMap.has(m.leagues.id)) {
            leagueMap.set(m.leagues.id, m.leagues)
          }
        }

        const leagueList = Array.from(leagueMap.values())
        setLeagues(leagueList)

        // Fetch member counts per league
        if (leagueList.length > 0) {
          const leagueIds = leagueList.map((l) => l.id)
          const { data: allMembers } = await supabase
            .from("league_members")
            .select("league_id")
            .in("league_id", leagueIds)

          if (allMembers) {
            const counts: Record<string, number> = {}
            for (const m of allMembers) {
              const key = String(m.league_id)
              counts[key] = (counts[key] || 0) + 1
            }
            setMemberCounts(counts)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load leagues.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [authLoading, user])

  if (authLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Checking your session…</p>
      </main>
    )
  }

  if (!user) {
    return null
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-primary/70">Loading leagues…</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-cream px-4 pb-24 pt-4 md:pb-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary">Your Leagues</h1>
            <p className="mt-1 text-sm text-primary/70">
              All your active leagues in one place.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/leagues/create"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-cream hover:bg-primary/90"
            >
              Create League
            </Link>
            <Link
              href="/leagues/join"
              className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-white px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Join League
            </Link>
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {leagues.length === 0 && !error ? (
          <section className="mt-4 rounded-xl border border-dashed border-primary/20 bg-white p-6 text-center shadow-sm">
            <h2 className="text-base font-semibold text-primary">No leagues yet</h2>
            <p className="mt-2 text-sm text-primary/70">
              Start a league for your crew, or ask a buddy for their invite code.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Link
                href="/leagues/create"
                className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
              >
                Create League
              </Link>
              <Link
                href="/leagues/join"
                className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
              >
                Join League
              </Link>
            </div>
          </section>
        ) : null}

        {leagues.length > 0 && (
          <section className="grid gap-4 md:grid-cols-2">
            {leagues.map((league) => {
              const count = memberCounts[String(league.id)] || 0
              const playerCountLabel =
                league.max_players != null
                  ? `${count}/${league.max_players} players`
                  : `${count} player${count !== 1 ? "s" : ""}`

              const statusLabel = (league.status || "draft").toString()

              return (
                <Link
                  key={league.id}
                  href={`/leagues/${league.id}`}
                  className="group flex flex-col rounded-xl border border-primary/15 bg-white p-4 text-primary shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold text-primary group-hover:text-primary/90">
                        {league.name}
                      </h2>
                      <p className="mt-1 text-xs uppercase tracking-[0.2em] text-primary/60">
                        {league.course_name || "Course TBA"}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        statusLabel === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : statusLabel === "completed"
                          ? "bg-primary/10 text-primary"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-primary/70">
                    <span>{playerCountLabel}</span>
                    <span className="text-primary/60">View league →</span>
                  </div>
                </Link>
              )
            })}
          </section>
        )}
      </div>
    </main>
  )
}

