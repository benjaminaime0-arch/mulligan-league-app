"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { Avatar } from "@/components/Avatar"
import { todayLocalIso } from "@/lib/date"
import { useI18n } from "@/lib/i18n"
import {
  loadUserGames,
  loadMyStandings,
  loadNextMatches,
  loadPendingReviewRequests,
  sectionForStatus,
  type EnrichedGame,
  type HubSection,
  type LeaderboardStanding,
  type PendingInvite,
} from "@/lib/userGames"

type HubGame = EnrichedGame & {
  standing: LeaderboardStanding
  nextMatchDate: string | null
  section: HubSection
}

function formatGameType(type: string | null | undefined): string {
  if (!type) return "Standard"
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDateShort(iso: string | null | undefined, locale = "fr"): string {
  if (!iso) return "—"
  // Parse as a local date to avoid a UTC day shift.
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  })
}

const SECTION_KEY: Record<HubSection, string> = {
  active: "games.section.active",
  upcoming: "games.section.upcoming",
  completed: "games.section.completed",
}

export default function GamesHubPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { t, locale } = useI18n()

  const [games, setGames] = useState<HubGame[]>([])
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    const today = todayLocalIso()

    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        const enriched = await loadUserGames(user.id)
        if (cancelled) return

        const ids = enriched.map((g) => g.id)
        const [standings, nextMatches, pending] = await Promise.all([
          loadMyStandings(ids, user.id),
          loadNextMatches(ids, user.id, today),
          loadPendingReviewRequests(user.id),
        ])
        if (cancelled) return

        setGames(
          enriched.map((g) => ({
            ...g,
            standing:
              standings.get(String(g.id)) ?? { position: null, roundsCounted: null },
            nextMatchDate: nextMatches.get(String(g.id)) ?? null,
            section: sectionForStatus(g.status),
          })),
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
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-10 pt-6 md:pt-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary">{t("games.title")}</h1>
          <p className="text-sm text-primary/60">{t("games.subtitle")}</p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Link
            href="/games/join"
            className="rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/5"
          >
            {t("games.join")}
          </Link>
          <Link
            href="/games/create"
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-cream hover:bg-primary/90"
          >
            {t("games.create")}
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
                locale={locale}
                onOpen={(id) => router.push(`/games/${id}`)}
              />
            ) : null,
          )}

          {/* Completed collapses to keep the hub focused on live games */}
          {grouped.completed.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-primary/50"
              >
                <span>
                  {t("games.section.completed")} ({grouped.completed.length})
                </span>
                <span className="text-primary/40">
                  {showCompleted ? t("games.hide") : t("games.show")}
                </span>
              </button>
              {showCompleted && (
                <div className="flex flex-col gap-3">
                  {grouped.completed.map((g) => (
                    <GameCard
                      key={g.id}
                      game={g}
                      t={t}
                      locale={locale}
                      onOpen={() => router.push(`/games/${g.id}`)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* Mobile create/join */}
      <div className="mt-8 flex gap-2 sm:hidden">
        <Link
          href="/games/create"
          className="flex flex-1 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream"
        >
          {t("games.create.full")}
        </Link>
        <Link
          href="/games/join"
          className="flex flex-1 items-center justify-center rounded-lg border border-primary/30 bg-cream px-4 py-2.5 text-sm font-medium text-primary"
        >
          {t("games.join.full")}
        </Link>
      </div>
    </main>
  )
}

function GameSection({
  section,
  games,
  onOpen,
  t,
  locale,
}: {
  section: HubSection
  games: HubGame[]
  onOpen: (id: string) => void
  t: (k: string, v?: Record<string, string | number>) => string
  locale: string
}) {
  return (
    <section>
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-primary/50">
          {t(SECTION_KEY[section])} ({games.length})
        </h2>
      </div>
      <div className="flex flex-col gap-3">
        {games.map((g) => (
          <GameCard key={g.id} game={g} t={t} locale={locale} onOpen={() => onOpen(String(g.id))} />
        ))}
      </div>
    </section>
  )
}

function StatusChip({ section, t }: { section: HubSection; t: (k: string) => string }) {
  const styles: Record<HubSection, string> = {
    active: "bg-emerald-50 text-emerald-700",
    upcoming: "bg-amber-50 text-amber-700",
    completed: "bg-primary/10 text-primary",
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[section]}`}
    >
      {t(SECTION_KEY[section])}
    </span>
  )
}

function GameCard({
  game,
  onOpen,
  t,
  locale,
}: {
  game: HubGame
  onOpen: () => void
  t: (k: string, v?: Record<string, string | number>) => string
  locale: string
}) {
  const isCompleted = game.section === "completed"
  const cap = game.total_cards_count
  const counted = game.standing.roundsCounted
  const cardsProgress =
    cap != null && counted != null ? t("home.cards", { counted, total: cap }) : null
  const position = game.standing.position != null ? `P${game.standing.position}` : null

  const visibleMembers = game.members.slice(0, 5)
  const overflow = game.memberCount - visibleMembers.length

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border border-primary/10 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary/25 hover:bg-cream/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-primary">
              {game.name}
            </h3>
            <StatusChip section={game.section} t={t} />
          </div>
          <p className="mt-0.5 truncate text-xs text-primary/50">
            {game.course_name || t("games.card.nocourse")} · {formatGameType(game.game_type)}
          </p>
        </div>
        {position && (
          <span className="shrink-0 rounded-lg bg-primary/5 px-2 py-1 text-sm font-bold text-primary">
            {position}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        {/* member avatars */}
        <div className="flex items-center">
          {visibleMembers.map((m, i) => (
            <span
              key={m.user_id}
              className={i > 0 ? "-ml-2" : ""}
              style={{ zIndex: visibleMembers.length - i }}
            >
              <Avatar
                src={m.profiles?.avatar_url ?? null}
                alt={m.profiles?.username || "Player"}
                size={24}
                fallback={m.profiles?.username || m.profiles?.first_name || "P"}
              />
            </span>
          ))}
          {overflow > 0 && (
            <span className="-ml-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              +{overflow}
            </span>
          )}
        </div>

        {/* progress + next match */}
        <div className="flex items-center gap-3 text-xs text-primary/60">
          {cardsProgress && <span>{cardsProgress}</span>}
          {!isCompleted && game.nextMatchDate ? (
            <span className="rounded-md bg-primary/5 px-2 py-1 font-medium text-primary">
              {t("games.card.next", { date: formatDateShort(game.nextMatchDate, locale) })}
            </span>
          ) : isCompleted ? (
            <span className="text-primary/40">{t("games.card.final")}</span>
          ) : (
            <span className="text-primary/40">{t("games.card.nomatch")}</span>
          )}
        </div>
      </div>
    </button>
  )
}
