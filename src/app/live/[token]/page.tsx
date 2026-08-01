"use client"

/**
 * /live/[token] — public read-only live leaderboard for one match.
 *
 * Opened from a WhatsApp link by people who may have no account: the page is
 * in the auth guard's public prefix allowlist ("/live") and never mounts the
 * guard itself. French-first hardcoded copy (public page, same rule as
 * /courses).
 *
 * Data: get_live_match(token) — the app's single anon-executable RPC — on
 * load, then polled every 15 s while the tab is visible, plus a refetch on
 * visibilitychange. Deliberately NOT a realtime subscription: anon cannot
 * pass score_holes RLS and widening it for spectators would be wrong;
 * polling one cheap RPC is the honest cost.
 *
 * Unknown/revoked token renders a friendly "link inactive" state with the
 * signup CTA — HTTP 200, no information leak either way.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Avatar } from "@/components/Avatar"
import { vsPar } from "@/lib/gameFormat"

const POLL_MS = 15_000

type LivePlayer = {
  name: string
  avatar_url: string | null
  gross: number | null
  net: number | null
  points: number | null
  thru: number
  declared_holes: number | null
  holes: { n: number; strokes: number }[]
}
type LiveMatch = {
  found: boolean
  course_name?: string | null
  date?: string | null
  status?: string | null
  format?: string
  scoring_basis?: string
  course?: { name: string; city: string | null; par: number | null; holes_count: number; holes: { n: number; par: number }[] } | null
  players?: LivePlayer[]
  match_play?: { state: string | null; thru: number; final: boolean; leader_name: string | null } | null
  updated_at?: string | null
}

export default function LiveMatchPage() {
  const params = useParams<{ token: string }>()
  const token = String(params?.token ?? "")
  const [data, setData] = useState<LiveMatch | null>(null)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    const { data: payload, error } = await supabase.rpc("get_live_match", {
      p_token: token,
    })
    if (error) {
      // Malformed token (not a uuid) → same friendly dead-link state.
      setFailed(true)
      return
    }
    setData((payload as LiveMatch | null) ?? { found: false })
  }, [token])

  useEffect(() => {
    void load()
    timerRef.current = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === "visible") void load()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [load])

  if (!data && !failed) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream/30">
        <p className="text-primary/60">Chargement de la partie…</p>
      </main>
    )
  }

  if (failed || !data?.found) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream/30 px-6 text-center">
        <p className="text-lg font-semibold text-primary">Ce lien n&apos;est plus actif</p>
        <p className="text-sm text-primary/60">
          La partie n&apos;est plus partagée, ou le lien a expiré.
        </p>
        <Link
          href="/"
          className="rounded-xl bg-primary px-5 py-2.5 font-semibold text-cream"
        >
          Créez votre ligue sur Mulligan
        </Link>
      </main>
    )
  }

  const live = data.status !== "completed" && data.status !== "cancelled"
  const isStableford = data.scoring_basis === "stableford_net" || data.format === "stableford"
  const isNet = data.scoring_basis === "net"

  // Sort: points desc for stableford, else effective score asc; empty cards last.
  const players = [...(data.players ?? [])].sort((a, b) => {
    const av = isStableford ? a.points : isNet ? a.net : a.gross
    const bv = isStableford ? b.points : isNet ? b.net : b.gross
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return isStableford ? bv - av : av - bv
  })

  // vs-par over holes actually entered — the honest live number.
  const parByHole = new Map((data.course?.holes ?? []).map((h) => [h.n, h.par]))
  const relFor = (p: LivePlayer): string | null => {
    if (parByHole.size === 0 || p.holes.length === 0 || p.gross == null) return null
    let parSum = 0
    for (const h of p.holes) {
      const par = parByHole.get(h.n)
      if (par == null) return null
      parSum += par
    }
    const played = p.holes.reduce((s, h) => s + h.strokes, 0)
    return vsPar(played, parSum)
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg bg-cream/30 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/50">
            Partie en direct
          </p>
          <h1 className="mt-0.5 truncate text-xl font-bold text-primary">
            {data.course?.name ?? data.course_name ?? "Golf"}
          </h1>
          <p className="text-xs text-primary/50">
            {[data.course?.city, data.date].filter(Boolean).join(" · ")}
          </p>
        </div>
        {live ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-red-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            En direct
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
            Terminé
          </span>
        )}
      </header>

      {data.match_play?.state && (
        <div className="mt-4 rounded-xl border border-primary/15 bg-white px-4 py-3 text-center">
          <p className="text-lg font-bold text-primary">
            {data.match_play.leader_name
              ? `${data.match_play.leader_name} — ${data.match_play.state}`
              : "Égalité"}
          </p>
          <p className="text-xs text-primary/50">
            {data.match_play.final ? "Match terminé" : `après ${data.match_play.thru} trous`}
          </p>
        </div>
      )}

      <ol className="mt-4 flex flex-col gap-2">
        {players.map((p, i) => {
          const main = isStableford
            ? p.points != null
              ? `${p.points} pts`
              : "–"
            : isNet
              ? p.net != null
                ? String(p.net)
                : "–"
              : p.gross != null
                ? String(p.gross)
                : "–"
          const rel = !isStableford ? relFor(p) : null
          const total = data.course?.holes_count || p.declared_holes || 18
          return (
            <li
              key={p.name}
              className="flex items-center gap-3 rounded-xl border border-primary/10 bg-white px-3 py-2.5 transition-all duration-500"
            >
              <span className="w-5 text-center text-sm font-bold tabular-nums text-primary/40">
                {i + 1}
              </span>
              <Avatar src={p.avatar_url} size={32} fallback={p.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-primary">{p.name}</p>
                <p className="text-[11px] text-primary/50">
                  {p.thru > 0
                    ? p.thru >= total
                      ? "Carte complète"
                      : `après ${p.thru} trous`
                    : "Pas encore de score"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-lg font-extrabold tabular-nums text-primary">
                  {main}
                  {rel ? (
                    <span className="ml-1 text-xs font-semibold text-primary/50">({rel})</span>
                  ) : null}
                </p>
                {isNet && p.gross != null && (
                  <p className="text-[10px] tabular-nums text-primary/40">Brut {p.gross}</p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {data.updated_at && (
        <p className="mt-3 text-center text-[11px] text-primary/40">
          Mis à jour{" "}
          {new Date(data.updated_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}

      <footer className="mt-8 rounded-2xl bg-primary p-5 text-center text-cream">
        <p className="font-bold">Organisez vos parties comme celle-ci</p>
        <p className="mt-1 text-sm opacity-80">
          Cartes trou par trou, classement en direct, saison entre amis — gratuit.
        </p>
        <Link
          href="/"
          className="mt-3 inline-block rounded-lg bg-cream px-5 py-2.5 font-semibold text-primary"
        >
          Créez votre ligue sur Mulligan
        </Link>
      </footer>
    </main>
  )
}
