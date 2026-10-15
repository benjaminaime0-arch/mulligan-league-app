"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { LeagueCard } from "@/components/home/LeagueCard"
import { AppIcon } from "@/components/ui/AppIcon"
import { leagueSection, type HubGame } from "@/lib/leaguePresentation"
import { useI18n } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { personalResult, type PersonalLeagueSummary } from "@/lib/personalRounds"
import {
  loadUserGames,
  loadMyStandings,
  loadPendingReviewRequests,
  type HubSection,
  type PendingInvite,
} from "@/lib/userGames"

const SECTION_KEY: Record<HubSection, string> = {
  active: "games.section.active",
  upcoming: "games.section.upcoming",
  completed: "games.section.completed",
}

export default function GamesHubPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { t } = useI18n()

  const [games, setGames] = useState<HubGame[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false

    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        const enriched = await loadUserGames(user.id)
        if (cancelled) return

        const ids = enriched.map((g) => g.id)
        const [standings, pending, personal] = await Promise.all([
          loadMyStandings(ids, user.id),
          loadPendingReviewRequests(user.id),
          supabase.rpc("get_personal_leagues").then(r => personalResult<PersonalLeagueSummary[]>(r)),
        ])
        if (cancelled) return

        setGames(
          enriched.map((g): HubGame => {
            const details = personal.find(p => p.id === g.id)
            const section = leagueSection(g, details)
            return {
              ...g,
              standing: standings.get(String(g.id)) ?? { position: null, roundsCounted: null },
              section,
              personal: details,
            }
          }),
        )
        setInvites(pending)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to load games.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    init()
    return () => {
      cancelled = true
    }
  }, [authLoading, user])

  const grouped = useMemo(() => {
    const by: Record<HubSection, HubGame[]> = {
      active: [],
      upcoming: [],
      completed: [],
    }
    for (const g of games) by[g.section].push(g)
    return by
  }, [games])

  if (authLoading || (loading && games.length === 0)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-primary/70">{t("games.loading")}</p>
      </main>
    )
  }

  if (!user) return null

  const hasAnyGame = games.length > 0

  return (
    <main className="app-page">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-1 text-sm text-primary/70">{t("app.yourLeagues")}</p><h1 className="text-3xl font-bold text-primary">{t("games.title")}</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/games/join"
            className="inline-flex min-h-[48px] items-center rounded-xl border border-primary/30 bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
          >
            <AppIcon name="join" className="mr-2 h-4 w-4" />{t("games.join")}
          </Link>
          <Link
            href="/games/create"
            className="inline-flex min-h-[48px] items-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-cream hover:bg-primary/90"
          >
            <AppIcon name="plus" className="mr-2 h-4 w-4" />{t("games.create")}
          </Link>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Invitations / requests to review */}
      {invites.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary/50">
            {t("games.requests")}
          </h2>
          <ul className="divide-y divide-primary/5 overflow-hidden rounded-xl border border-primary/10 bg-white">
            {invites.map((inv) => (
              <li key={inv.id}>
                <button
                  type="button"
                  onClick={() => router.push("/notifications")}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-cream"
                >
                  <span className="text-sm text-primary">
                    <span className="font-medium">{inv.requesterName}</span>
                    {inv.target_type === "match"
                      ? t("games.requests.match")
                      : t("games.requests.game")}
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                    {t("games.requests.review")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hasAnyGame ? (
        <section className="rounded-xl border border-dashed border-primary/20 bg-white p-6 text-center shadow-sm">
          <h2 className="text-base font-semibold text-primary">{t("games.empty.title")}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-primary/70">
            {t("games.empty.body")}
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link
              href="/games/create"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream hover:bg-primary/90"
            >
              {t("games.create.full")}
            </Link>
            <Link
              href="/games/join"
              className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              {t("games.join.full")}
            </Link>
          </div>
        </section>
      ) : (
        <div className="flex flex-col gap-8">
          {(["active", "upcoming"] as HubSection[]).map((section) =>
            grouped[section].length > 0 ? (
              <GameSection
                key={section}
                section={section}
                games={grouped[section]}
                t={t}
              />
            ) : null,
          )}

          {/* Completed collapses to keep the hub focused on live games */}
          {grouped.completed.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                aria-expanded={showCompleted}
                aria-controls="completed-leagues"
                className="mb-2 flex min-h-[44px] w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-primary/70"
              >
                <span>
                  {t("games.section.completed")} ({grouped.completed.length})
                </span>
                <span className="text-primary/40">
                  {showCompleted ? t("games.hide") : t("games.show")}
                </span>
              </button>
              {showCompleted && (
                <div id="completed-leagues" className="grid gap-3 sm:grid-cols-2">
                  {grouped.completed.map((g) => (
                    <LeagueCard key={g.id} game={g} />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

    </main>
  )
}

function GameSection({
  section,
  games,
  t,
}: {
  section: HubSection
  games: HubGame[]
  t: (k: string, v?: Record<string, string | number>) => string
}) {
  return (
    <section>
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-primary/50">
          {t(SECTION_KEY[section])} ({games.length})
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{games.map(g => <LeagueCard key={g.id} game={g} />)}</div>
    </section>
  )
}
