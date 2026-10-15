"use client"
import { useEffect, useRef, useState } from "react"
import { draftHoles, type CardDraft, type DraftState } from "@/lib/cardDraft"
import { cardDraftEngine, automaticDraftStatuses } from "@/lib/cardDraftManager"
import type { PersonalCard, PersonalHole } from "@/lib/personalRounds"
export function useCardDraft(card: PersonalCard, enabled: boolean) {
  const engine = useRef<CardDraft | null>(null)
  const [online, setOnline] = useState(true)
  const [state, setState] = useState<DraftState>(() => ({ holes: draftHoles(card), version: card.round.draft_version, status: "saved", dirty: false, conflict: null }))
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine)
    connection()
    window.addEventListener("online", connection); window.addEventListener("offline", connection)
    if (!enabled) return () => { window.removeEventListener("online", connection); window.removeEventListener("offline", connection) }
    const current = cardDraftEngine(card)
    engine.current = current
    setState(current.snapshot())
    const unsubscribe = current.subscribe(() => setState(current.snapshot()))
    const storage = () => current.observeStorage()
    window.addEventListener("storage", storage)
    return () => { unsubscribe(); engine.current = null; window.removeEventListener("storage", storage); window.removeEventListener("online", connection); window.removeEventListener("offline", connection) }
  }, [card, enabled])
  useEffect(() => {
    if (!enabled || !state.dirty || !online || !automaticDraftStatuses.includes(state.status)) return
    const timer = setTimeout(() => { void engine.current?.flush().catch(() => {}) }, state.status === "offline" ? 15000 : 700)
    return () => clearTimeout(timer)
  }, [enabled, state, online])
  return { state, online, ready: !enabled || !!engine.current, change: (n: number, patch: Partial<PersonalHole>) => { const current = engine.current; if (current) current.update(current.snapshot().holes.map(h => h.hole_number === n ? { ...h, ...patch } : h)) }, update: (holes: PersonalHole[]) => engine.current?.update(holes),
    flush: async () => { if (!engine.current) throw new Error("session"); return engine.current.flush() },
    choose: (keepMine: boolean) => engine.current?.choose(keepMine) }
}
