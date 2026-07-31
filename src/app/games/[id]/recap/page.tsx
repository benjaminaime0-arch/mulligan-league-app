"use client"

/**
 * /games/[id]/recap — season recap, story-style (Phase G).
 *
 * One full-viewport panel per stat, vertical scroll snap: podium, best
 * round, biggest win, most improved, attendance, streak, head-to-head grid,
 * then the share CTA pointing at the public /share/season page. Only renders
 * for completed games (the RPC refuses otherwise) — the banner on the game
 * page is the entry point.
 */

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { Avatar } from "@/components/Avatar"
import { LoadingSpinner } from "@/components/LoadingSpinner"

type RecapPlayer = { user_id: string; name: string }
type Recap = {
  success: boolean
  error?: string
  game?: { id: string; name: string; start_date: string | null; end_date: string | null; course_name: string | null }
  podium?: { position: number; user_id: string; name: string; avatar_url: string | null; total: number }[] | null
  best_round?: { name: string; score: number; vs_par: number | null; date: string | null } | null
  biggest_win?: { name: string; margin: number; date: string | null } | null
  most_improved?: { name: string; delta: number } | null
  attendance?: { name: string; rounds: number } | null
  longest_streak?: { name: string; len: number } | null
  head_to_head?: { a: string; b: string; a_wins: number }[]
  players?: RecapPlayer[] | null
}

export default function RecapPage() {
  const params = useParams<{ id: string }>()
  const gameId = String(params?.id ?? "")
  const { user, loading: authLoading } = useAuth()
  const t = useT()
  const [recap, setRecap] = useState<Recap | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (authLoading || !user || !gameId) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.rpc("get_game_recap", { p_game_id: gameId })
      if (!cancelled) setRecap((data as Recap | null) ?? { success: false })
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, user, gameId])

  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/share/season/${gameId}`
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ url })
        return
      } catch {
        /* fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }, [gameId])

  if (authLoading || (!recap && user)) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <LoadingSpinner />
      </main>
    )
  }
  if (!user) return null
  if (!recap?.success) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-primary/70">{t("recap.unavailable")}</p>
        <Link href={`/games/${gameId}`} className="text-sm font-medium text-primary underline">
          {t("recap.backtogame")}
        </Link>
      </main>
    )
  }

  const playersById = new Map((recap.players ?? []).map((p) => [p.user_id, p.name]))
  const h2hPlayers = (recap.players ?? []).slice(0, 6)

  return (
    <main className="snap-y snap-mandatory overflow-y-auto">
      {/* Panel 1 — title + podium */}
      <Panel accent>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
          {t("recap.eyebrow")}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold">{recap.game?.name}</h1>
        {recap.game?.course_name && (
          <p className="mt-1 text-sm opacity-70">{recap.game.course_name}</p>
        )}
        <div className="mt-8 flex items-end justify-center gap-4">
          {[2, 1, 3].map((pos) => {
            const row = (recap.podium ?? []).find((p) => Number(p.position) === pos)
            if (!row) return <div key={pos} className="w-20" />
            return (
              <div key={pos} className="flex w-20 flex-col items-center">
                <Avatar src={row.avatar_url} size={pos === 1 ? 64 : 48} fallback={row.name} />
                <p className="mt-2 w-full truncate text-center text-sm font-semibold">{row.name}</p>
                <div
                  className={`mt-2 flex w-full items-start justify-center rounded-t-lg bg-cream/20 font-extrabold ${
                    pos === 1 ? "h-24 text-2xl" : pos === 2 ? "h-16 text-xl" : "h-10 text-lg"
                  }`}
                >
                  {pos}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      {recap.best_round && (
        <Panel>
          <StatPanel
            eyebrow={t("recap.bestround")}
            headline={`${recap.best_round.score}${
              recap.best_round.vs_par != null
                ? ` (${recap.best_round.vs_par > 0 ? "+" : ""}${recap.best_round.vs_par})`
                : ""
            }`}
            name={recap.best_round.name}
          />
        </Panel>
      )}
      {recap.biggest_win && (
        <Panel accent>
          <StatPanel
            eyebrow={t("recap.biggestwin")}
            headline={t("recap.margin", { n: recap.biggest_win.margin })}
            name={recap.biggest_win.name}
          />
        </Panel>
      )}
      {recap.most_improved && (
        <Panel>
          <StatPanel
            eyebrow={t("recap.mostimproved")}
            headline={`−${recap.most_improved.delta}`}
            name={recap.most_improved.name}
          />
        </Panel>
      )}
      {recap.attendance && (
        <Panel accent>
          <StatPanel
            eyebrow={t("recap.attendance")}
            headline={t("recap.rounds", { n: recap.attendance.rounds })}
            name={recap.attendance.name}
          />
        </Panel>
      )}
      {recap.longest_streak && Number(recap.longest_streak.len) > 1 && (
        <Panel>
          <StatPanel
            eyebrow={t("recap.streak")}
            headline={t("recap.streaklen", { n: recap.longest_streak.len })}
            name={recap.longest_streak.name}
          />
        </Panel>
      )}

      {/* Head-to-head grid */}
      {h2hPlayers.length >= 2 && (
        <Panel accent>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
            {t("recap.h2h")}
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="mx-auto text-sm tabular-nums">
              <thead>
                <tr>
                  <th className="p-2" />
                  {h2hPlayers.map((p) => (
                    <th key={p.user_id} className="max-w-16 truncate p-2 text-xs font-semibold">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h2hPlayers.map((row) => (
                  <tr key={row.user_id}>
                    <th className="max-w-20 truncate p-2 text-left text-xs font-semibold">
                      {row.name}
                    </th>
                    {h2hPlayers.map((col) => {
                      if (col.user_id === row.user_id)
                        return <td key={col.user_id} className="p-2 text-center opacity-30">—</td>
                      const cell = (recap.head_to_head ?? []).find(
                        (h) => h.a === row.user_id && h.b === col.user_id,
                      )
                      return (
                        <td key={col.user_id} className="p-2 text-center font-bold">
                          {cell?.a_wins ?? 0}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs opacity-60">{t("recap.h2h.hint")}</p>
          <p className="mt-1 text-[11px] opacity-40">
            {playersById.size > 6 ? t("recap.h2h.truncated") : ""}
          </p>
        </Panel>
      )}

      {/* Share */}
      <Panel>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
          {t("recap.share.eyebrow")}
        </p>
        <button
          type="button"
          onClick={handleShare}
          className="mt-4 rounded-xl bg-primary px-6 py-3 font-semibold text-cream"
        >
          {copied ? t("games.match.linkcopied") : t("recap.share.cta")}
        </button>
        <Link
          href={`/games/${gameId}`}
          className="mt-6 text-sm text-primary/60 underline-offset-2 hover:underline"
        >
          {t("recap.backtogame")}
        </Link>
      </Panel>
    </main>
  )
}

function Panel({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <section
      className={`flex min-h-screen snap-start flex-col items-center justify-center px-6 text-center ${
        accent ? "bg-primary text-cream" : "bg-white text-primary"
      }`}
    >
      {children}
    </section>
  )
}

function StatPanel({ eyebrow, headline, name }: { eyebrow: string; headline: string; name: string }) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">{eyebrow}</p>
      <p className="mt-3 text-6xl font-extrabold tabular-nums">{headline}</p>
      <p className="mt-2 text-lg font-semibold">{name}</p>
    </>
  )
}
