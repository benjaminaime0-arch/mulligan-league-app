"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/useAuth"
import { todayLocalIso } from "@/lib/date"
import { loadHomeData, type HomeData, type HomeMatch } from "@/lib/home"
import { useI18n } from "@/lib/i18n"
import { track } from "@/lib/analytics"
import { MulliganRankingCard } from "@/components/home/MulliganRankingCard"

function formatMatchDate(iso: string | null, locale = "fr"): string {
  if (!iso) return "—"
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

export default function HomePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { t, locale } = useI18n()

  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    const today = todayLocalIso()

    const run = async () => {
      try {
        setLoading(true)
        setError(null)
        const d = await loadHomeData(user.id, today)
        if (!cancelled) setData(d)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load your home.")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [authLoading, user])

  const greeting = useMemo(() => {
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
    const name =
      (meta.username as string) || (meta.first_name as string) || ""
    return name ? t("home.greeting", { name }) : t("home.greeting.anon")
  }, [user, t])

  if (authLoading || (loading && !data)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-primary/70">{t("home.loading")}</p>
      </main>
    )
  }
  if (!user) return null

  const hasActions =
    !!data && (data.needApproval.length > 0 || data.needScore.length > 0)

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-10 pt-6 md:pt-8">
      <header className="mb-5">
        <h1 className="text-xl font-bold text-primary">{greeting}</h1>
        <p className="text-sm text-primary/60">{t("home.subtitle")}</p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* ── Action strip — the core-loop surface ─────────────────── */}
      {hasActions ? (
        <section className="mb-6 flex flex-col gap-2">
          {data!.needApproval.map((m) => (
            <ActionCard
              key={`appr-${m.id}`}
              tone="primary"
              title={t("home.action.approve")}
              subtitle={`${m.game_name ?? ""} · ${formatMatchDate(m.match_date, locale)}`}
              cta={t("home.action.approve.cta")}
              onClick={() => {
                track("home_cta_clicked", { kind: "approve" })
                router.push(`/games/${m.game_id}?match=${m.id}`)
              }}
            />
          ))}
          {data!.needScore.map((m) => (
            <ActionCard
              key={`score-${m.id}`}
              tone="amber"
              title={t("home.action.enter")}
              subtitle={`${m.game_name ?? ""} · ${formatMatchDate(m.match_date, locale)}`}
              cta={t("home.action.enter.cta")}
              onClick={() => {
                track("home_cta_clicked", { kind: "enter_score" })
                router.push(`/games/${m.game_id}?match=${m.id}&edit=1`)
              }}
            />
          ))}
        </section>
      ) : (
        <section className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-4">
          <p className="text-sm font-medium text-emerald-800">{t("home.caughtup")}</p>
          <p className="mt-0.5 text-xs text-emerald-700/70">
            {t("home.caughtup.sub")}
          </p>
        </section>
      )}

      {/* ── Next match ───────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary/50">
          {t("home.next")}
        </h2>
        {data?.nextMatch ? (
          <NextMatchCard match={data.nextMatch} locale={locale} onOpen={(m) => router.push(`/games/${m.game_id}?match=${m.id}`)} />
        ) : (
          <div className="flex items-center justify-between rounded-xl border border-dashed border-primary/20 bg-white px-4 py-4">
            <p className="text-sm text-primary/60">{t("home.next.none")}</p>
            <Link
              href="/matches/create"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-cream hover:bg-primary/90"
            >
              {t("home.next.cta")}
            </Link>
          </div>
        )}
      </section>

      {/* ── Practice shortcut ────────────────────────────────────── */}
      {/* Routes through /courses: pick a course there, then its
          practice CTA creates the solo match and opens the card. */}
      <section className="mb-6">
        <Link
          href="/courses"
          onClick={() => track("home_cta_clicked", { kind: "practice" })}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 transition-colors hover:bg-emerald-50"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-emerald-900">
              {t("home.practice")}
            </span>
            <span className="mt-0.5 block truncate text-xs text-emerald-800/70">
              {t("home.practice.sub")}
            </span>
          </span>
          <span className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white">
            {t("home.practice.cta")}
          </span>
        </Link>
      </section>

      {/* ── Classement Mulligan (Phase G) ─────────────────────────── */}
      {user && <MulliganRankingCard viewerId={user.id} />}

      {/* ── My standings ─────────────────────────────────────────── */}
      {data && data.positions.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary/50">
            {t("home.standings")}
          </h2>
          <ul className="divide-y divide-primary/5 overflow-hidden rounded-xl border border-primary/10 bg-white">
            {data.positions.map((p) => (
              <li key={p.gameId}>
                <Link
                  href={`/games/${p.gameId}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-cream"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-primary">
                    {p.gameName}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-primary/60">
                    {p.totalCards != null && p.standing.roundsCounted != null && (
                      <span>
                        {t("home.cards", { counted: p.standing.roundsCounted, total: p.totalCards })}
                      </span>
                    )}
                    <span className="rounded-lg bg-primary/5 px-2 py-1 text-sm font-bold text-primary">
                      {p.standing.position != null ? `P${p.standing.position}` : "—"}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function ActionCard({
  tone,
  title,
  subtitle,
  cta,
  onClick,
}: {
  tone: "primary" | "amber"
  title: string
  subtitle: string
  cta: string
  onClick: () => void
}) {
  const toneClasses =
    tone === "amber"
      ? "border-amber-200 bg-amber-50"
      : "border-primary/15 bg-primary/[0.04]"
  const ctaClasses =
    tone === "amber"
      ? "bg-amber-500 text-white hover:bg-amber-600"
      : "bg-primary text-cream hover:bg-primary/90"
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${toneClasses}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-primary">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-primary/55">{subtitle}</span>
      </span>
      <span className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${ctaClasses}`}>
        {cta}
      </span>
    </button>
  )
}

function NextMatchCard({
  match,
  locale,
  onOpen,
}: {
  match: HomeMatch
  locale: string
  onOpen: (m: HomeMatch) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(match)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-primary/10 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-primary/25 hover:bg-cream/40"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-primary">
          {match.game_name ?? ""}
        </span>
        <span className="mt-0.5 block truncate text-xs text-primary/55">
          {match.course_name || ""}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold text-primary">
          {formatMatchDate(match.match_date, locale)}
        </span>
        {match.match_time && (
          <span className="block text-xs text-primary/50">
            {match.match_time.slice(0, 5)}
          </span>
        )}
      </span>
    </button>
  )
}
