"use client"

/**
 * ScorecardEditor — full-screen hole-by-hole score entry (Phase B).
 *
 * Built for the on-course reality: one person holds the phone and keeps the
 * card for everyone, in sunlight, with patchy signal. Hence:
 *
 *   * One hole per screen, one big stepper row per player (batch entry —
 *     the same model as the aggregate ScoreEditor, extended per hole).
 *   * Steppers default to the hole's par: most taps are ±1 from there.
 *   * Every change applies locally FIRST (optimistic) and is queued for
 *     upsert_score_hole. The queue dedupes by (player, hole), keeps the
 *     latest value, survives failures and retries on a timer + when the
 *     network/visibility comes back. Closing with a non-empty queue warns.
 *
 * Data comes from get_match_scorecard (one round-trip: course holes + all
 * players' strokes). Totals shown here are computed locally but the DB owns
 * the canonical sum (sync_score_from_holes trigger) — on refresh the two
 * agree because both are Σstrokes.
 *
 * Courses without hole data still work: no par/HCP/distance header, steppers
 * default to 4, vs-par strip hidden. The declared round length (9/18) or the
 * course card decides how many holes are shown.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"
import { track } from "@/lib/analytics"
import { vsPar } from "@/lib/gameFormat"

type CourseHole = { n: number; par: number; hcp: number | null; dist: number | null; tee: string | null }
type ScorecardPlayer = {
  user_id: string
  display_name: string
  avatar_url: string | null
  score_status: string | null
  total: number | null
  declared_holes: number | null
  thru: number
  holes: { n: number; strokes: number }[]
}
type Scorecard = {
  success: boolean
  error?: string
  match_id: string
  match_status: string | null
  course_name: string | null
  course: {
    id: string
    name: string
    city: string | null
    par: number | null
    holes_count: number
    holes: CourseHole[]
  } | null
  players: ScorecardPlayer[]
  editable: boolean
}

type PendingWrite = { userId: string; hole: number; strokes: number | null }

type MatchPlayState = {
  available: boolean
  team_mode?: boolean
  side_a?: string[]
  side_b?: string[]
  a_won?: number
  b_won?: number
  halved?: number
  thru?: number
  remaining?: number
  leader?: number
  decided?: boolean
  final?: boolean
  state?: string | null
}

const RETRY_MS = 4000

export function ScorecardEditor({
  matchId,
  onClose,
}: {
  matchId: string
  /** Called on close; parent should refresh (scores changed server-side). */
  onClose: () => void
}) {
  const t = useT()
  const [card, setCard] = useState<Scorecard | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // strokes[userId][holeNumber] = strokes; local optimistic truth
  const [strokes, setStrokes] = useState<Record<string, Record<number, number>>>({})
  const [hole, setHole] = useState(1)
  const [showJump, setShowJump] = useState(false)
  const [queueSize, setQueueSize] = useState(0)
  const [flushFailing, setFlushFailing] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  // Match-play running state (Phase D): fetched alongside the card and
  // refreshed lazily after writes settle. Null = not a match-play round.
  const [mpState, setMpState] = useState<MatchPlayState | null>(null)

  // Write queue lives in refs: it must survive re-renders untouched and be
  // visible from timer/online callbacks without stale closures.
  const queueRef = useRef<Map<string, PendingWrite>>(new Map())
  const flushingRef = useRef(false)
  const closedRef = useRef(false)

  // ---- match play ---------------------------------------------------------
  const refreshMatchPlay = useCallback(async () => {
    const { data } = await supabase.rpc("match_play_state", { p_match_id: matchId })
    const st = data as MatchPlayState | null
    setMpState(st && st.available ? st : null)
  }, [matchId])

  // ---- load ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.rpc("get_match_scorecard", {
        p_match_id: matchId,
      })
      if (cancelled) return
      const payload = data as Scorecard | null
      if (error || !payload || !payload.success) {
        setLoadError(payload?.error || error?.message || "load")
        return
      }
      setCard(payload)
      const init: Record<string, Record<number, number>> = {}
      for (const p of payload.players) {
        init[p.user_id] = {}
        for (const h of p.holes) init[p.user_id][h.n] = h.strokes
      }
      setStrokes(init)
      // Resume where the card left off: first hole any player is missing.
      const total = holesCountOf(payload)
      let first = 1
      while (first < total && payload.players.every((p) => p.holes.some((h) => h.n === first)))
        first++
      setHole(first)
      track("scorecard_opened", { match_id: matchId, holes: total })
      void refreshMatchPlay()
    })()
    return () => {
      cancelled = true
    }
  }, [matchId, refreshMatchPlay])

  // ---- queue --------------------------------------------------------------
  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    try {
      while (queueRef.current.size > 0) {
        const [key, w] = queueRef.current.entries().next().value as [string, PendingWrite]
        const { data, error } = await supabase.rpc("upsert_score_hole", {
          p_match_id: matchId,
          p_user_id: w.userId,
          p_hole_number: w.hole,
          p_strokes: w.strokes,
        })
        const res = data as { success?: boolean; error?: string } | null
        if (error || !res?.success) {
          // Server said no (closed match, kicked player…) vs network error:
          // an explicit refusal is not retryable — drop the write, surface
          // the failure state so the user re-opens a fresh card.
          if (!error && res?.error) {
            queueRef.current.delete(key)
            setFlushFailing(true)
            continue
          }
          setFlushFailing(true)
          break
        }
        // Only delete if unchanged while in flight (a newer tap wins).
        const now = queueRef.current.get(key)
        if (now && now.strokes === w.strokes) queueRef.current.delete(key)
        setFlushFailing(false)
      }
    } finally {
      flushingRef.current = false
      setQueueSize(queueRef.current.size)
      if (queueRef.current.size === 0) void refreshMatchPlay()
    }
  }, [matchId, refreshMatchPlay])

  useEffect(() => {
    const timer = setInterval(() => {
      if (queueRef.current.size > 0) void flush()
    }, RETRY_MS)
    const onWake = () => {
      if (queueRef.current.size > 0) void flush()
    }
    window.addEventListener("online", onWake)
    document.addEventListener("visibilitychange", onWake)
    return () => {
      clearInterval(timer)
      window.removeEventListener("online", onWake)
      document.removeEventListener("visibilitychange", onWake)
    }
  }, [flush])

  const enqueue = useCallback(
    (userId: string, holeN: number, value: number | null) => {
      queueRef.current.set(`${userId}:${holeN}`, { userId, hole: holeN, strokes: value })
      setQueueSize(queueRef.current.size)
      void flush()
    },
    [flush],
  )

  // ---- derived ------------------------------------------------------------
  const holesCount = card ? holesCountOf(card) : 18
  const courseHoles = useMemo(() => {
    const map = new Map<number, CourseHole>()
    for (const h of card?.course?.holes ?? []) map.set(h.n, h)
    return map
  }, [card])
  const currentCourseHole = courseHoles.get(hole) ?? null
  const defaultStrokes = currentCourseHole?.par ?? 4

  const totals = useMemo(() => {
    const out: Record<string, { total: number; thru: number; rel: string | null }> = {}
    for (const p of card?.players ?? []) {
      const mine = strokes[p.user_id] ?? {}
      const entered = Object.entries(mine)
      const total = entered.reduce((s, [, v]) => s + v, 0)
      // vs par over the holes actually entered — the honest live number.
      let parSum = 0
      let parKnown = courseHoles.size > 0
      for (const [n] of entered) {
        const ch = courseHoles.get(Number(n))
        if (!ch) {
          parKnown = false
          break
        }
        parSum += ch.par
      }
      out[p.user_id] = {
        total,
        thru: entered.length,
        rel: parKnown && entered.length > 0 ? vsPar(total, parSum) : null,
      }
    }
    return out
  }, [card, strokes, courseHoles])

  const setPlayerStrokes = (userId: string, value: number | null) => {
    setStrokes((prev) => {
      const mine = { ...(prev[userId] ?? {}) }
      if (value == null) delete mine[hole]
      else mine[hole] = value
      return { ...prev, [userId]: mine }
    })
    enqueue(userId, hole, value)
  }

  const requestClose = () => {
    if (queueRef.current.size > 0) {
      void flush()
      setConfirmLeave(true)
      return
    }
    closedRef.current = true
    onClose()
  }

  // ---- render -------------------------------------------------------------
  if (loadError) {
    return (
      <Overlay onClose={onClose}>
        <p className="py-10 text-center text-sm text-primary/60">{t("scorecard.error")}</p>
      </Overlay>
    )
  }
  if (!card) {
    return (
      <Overlay onClose={onClose}>
        <p className="py-10 text-center text-sm text-primary/60">{t("scorecard.loading")}</p>
      </Overlay>
    )
  }

  const editable = card.editable
  const courseName = card.course?.name ?? card.course_name

  return (
    <Overlay onClose={requestClose} title={courseName ?? t("scorecard.title")}>
      {/* Hole header + navigation */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setHole((h) => Math.max(1, h - 1))}
          disabled={hole <= 1}
          aria-label={t("scorecard.prev")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 text-primary disabled:opacity-30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <button
          type="button"
          onClick={() => setShowJump((v) => !v)}
          className="flex-1 rounded-xl border border-primary/10 bg-cream px-3 py-1.5 text-center"
        >
          <span className="block text-lg font-bold text-primary">
            {t("scorecard.hole", { n: hole })}
          </span>
          <span className="block text-xs text-primary/60">
            {currentCourseHole
              ? [
                  t("scorecard.par", { n: currentCourseHole.par }),
                  currentCourseHole.hcp != null ? t("scorecard.hcp", { n: currentCourseHole.hcp }) : null,
                  currentCourseHole.dist != null ? `${currentCourseHole.dist} m` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("scorecard.nocoursedata")}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setHole((h) => Math.min(holesCount, h + 1))}
          disabled={hole >= holesCount}
          aria-label={t("scorecard.next")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/15 text-primary disabled:opacity-30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      {/* Jump grid — 1..N chips, OUT/IN split for 18-hole cards */}
      {showJump && (
        <div className="mt-3 rounded-xl border border-primary/10 bg-cream p-3">
          {(holesCount === 18 ? [[1, 9], [10, 18]] : [[1, holesCount]]).map(([from, to], i) => (
            <div key={from} className={i > 0 ? "mt-2" : ""}>
              {holesCount === 18 && (
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary/50">
                  {from === 1 ? t("scorecard.out") : t("scorecard.in")}
                </p>
              )}
              <div className="grid grid-cols-9 gap-1">
                {Array.from({ length: to - from + 1 }, (_, k) => from + k).map((n) => {
                  const complete = card.players.every((p) => strokes[p.user_id]?.[n] != null)
                  const partial = !complete && card.players.some((p) => strokes[p.user_id]?.[n] != null)
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setHole(n)
                        setShowJump(false)
                      }}
                      className={`h-9 rounded-lg text-xs font-semibold ${
                        n === hole
                          ? "bg-primary text-cream"
                          : complete
                            ? "bg-primary/15 text-primary"
                            : partial
                              ? "bg-primary/5 text-primary/80"
                              : "bg-white text-primary/50"
                      }`}
                    >
                      {n}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* One stepper row per player */}
      <div className="mt-3 flex flex-col gap-2">
        {card.players.map((p) => {
          const value = strokes[p.user_id]?.[hole] ?? null
          const shown = value ?? defaultStrokes
          const rel = currentCourseHole && value != null ? value - currentCourseHole.par : null
          return (
            <div
              key={p.user_id}
              className={`flex items-center gap-2 rounded-xl border p-2 ${
                value != null ? "border-primary/20 bg-white" : "border-primary/10 bg-cream"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-primary">{p.display_name}</p>
                <p className="text-xs text-primary/50">
                  {totals[p.user_id]?.thru
                    ? `${totals[p.user_id].total}${totals[p.user_id].rel ? ` (${totals[p.user_id].rel})` : ""} · ${t("scorecard.thru", { n: totals[p.user_id].thru })}`
                    : t("scorecard.nothru")}
                </p>
              </div>
              {value != null && (
                <button
                  type="button"
                  onClick={() => editable && setPlayerStrokes(p.user_id, null)}
                  aria-label={t("scorecard.clear")}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary/40 hover:bg-primary/5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={!editable || shown <= 1}
                  onClick={() => setPlayerStrokes(p.user_id, Math.max(1, (value ?? defaultStrokes) - 1))}
                  aria-label={t("scorecard.minus", { name: p.display_name })}
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/15 text-xl font-bold text-primary active:bg-primary/10 disabled:opacity-30"
                >
                  −
                </button>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() => value == null && setPlayerStrokes(p.user_id, defaultStrokes)}
                  className={`flex h-12 w-14 items-center justify-center rounded-xl text-xl font-bold ${
                    value != null ? "bg-primary text-cream" : "border border-dashed border-primary/25 text-primary/40"
                  }`}
                >
                  {shown}
                </button>
                <button
                  type="button"
                  disabled={!editable || shown >= 15}
                  onClick={() => setPlayerStrokes(p.user_id, Math.min(15, value == null ? defaultStrokes : shown + 1))}
                  aria-label={t("scorecard.plus", { name: p.display_name })}
                  className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/15 text-xl font-bold text-primary active:bg-primary/10 disabled:opacity-30"
                >
                  +
                </button>
              </div>
              {rel != null && (
                <span
                  className={`w-8 shrink-0 text-center text-xs font-semibold ${
                    rel < 0 ? "text-red-600" : rel === 0 ? "text-primary/60" : "text-primary"
                  }`}
                >
                  {rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Match-play running state (Phase D) */}
      {mpState && (
        <div className="mt-3 rounded-xl border border-primary/15 bg-cream px-3 py-2 text-center">
          <p className="text-sm font-bold text-primary">
            {mpState.state == null || mpState.leader === 0
              ? t("scorecard.matchplay.level")
              : t("scorecard.matchplay.leads", {
                  name: sideName(mpState.leader === 1 ? mpState.side_a : mpState.side_b, card),
                  state: mpState.state,
                })}
          </p>
          <p className="text-xs text-primary/50">
            {mpState.final
              ? t("scorecard.matchplay.final")
              : t("scorecard.matchplay.thru", { n: mpState.thru ?? 0 })}
          </p>
        </div>
      )}

      {/* Sync status */}
      <div className="mt-3 min-h-[1.25rem] text-center text-xs">
        {flushFailing && queueSize > 0 ? (
          <span className="text-red-600">{t("scorecard.offline", { n: queueSize })}</span>
        ) : queueSize > 0 ? (
          <span className="text-primary/50">{t("scorecard.pending")}</span>
        ) : null}
      </div>

      {confirmLeave && (
        <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-sm text-red-700">{t("scorecard.unsaved", { n: queueSize })}</p>
          <div className="mt-2 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmLeave(false)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream"
            >
              {t("scorecard.keeptrying")}
            </button>
            <button
              type="button"
              onClick={() => {
                closedRef.current = true
                onClose()
              }}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700"
            >
              {t("scorecard.forceclose")}
            </button>
          </div>
        </div>
      )}
    </Overlay>
  )
}

function holesCountOf(card: Scorecard): number {
  if (card.course && card.course.holes_count > 0) return card.course.holes_count
  const declared = card.players.map((p) => p.declared_holes).find((h) => h === 9 || h === 18)
  return declared ?? 18
}

function Overlay({
  title,
  onClose,
  children,
}: {
  title?: string
  onClose: () => void
  children: React.ReactNode
}) {
  const t = useT()
  // Body scroll lock while the full-screen editor is up.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-primary/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="min-w-0 truncate text-sm font-semibold text-primary">
          {title ?? t("scorecard.title")}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("scorecard.close")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary/60 hover:bg-primary/5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </div>
  )
}

/** First display name of a side (singles: the player; Ryder: "Nom +1"). */
function sideName(ids: string[] | undefined, card: Scorecard | null): string {
  if (!ids || ids.length === 0 || !card) return "?"
  const first = card.players.find((p) => p.user_id === ids[0])?.display_name ?? "?"
  return ids.length > 1 ? `${first} +${ids.length - 1}` : first
}
