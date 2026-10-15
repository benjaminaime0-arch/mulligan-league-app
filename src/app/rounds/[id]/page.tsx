"use client"
import { useEffect, useRef, useState } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/lib/i18n"
import { loadPersonalCard, type PersonalCard } from "@/lib/personalRounds"
import { cachePersonalCard, cachedPersonalCard, downloadLocalScores, hasLocalChanges, isCardNetworkError, isCardShellReady } from "@/lib/cardOffline"
import { PersonalRoundEditor } from "@/components/personal/PersonalRoundEditor"
export default function PersonalRoundPage({ params }: { params: { id: string } }) {
  const { user, loading } = useAuth()
  const t = useT()
  const [data, setData] = useState<PersonalCard | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const [prepared, setPrepared] = useState(false)
  const [localBackup, setLocalBackup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  useEffect(() => {
    if (!user) return
    let active = true
    const invalidateRequests = () => { requestId.current++ }
    const accept = (card: PersonalCard, offline: boolean) => {
      if (!active) return
      setData(card); setLoadedFor(user.id); setCached(offline); setError(null)
      setLocalBackup(card.is_owner && card.round.status !== "draft" && hasLocalChanges(user.id, card.round.id, card.tee.hole_count))
      if (!offline) {
        const stored = cachePersonalCard(card)
        setPrepared(stored && isCardShellReady(`/rounds/${params.id}`))
        navigator.serviceWorker?.controller?.postMessage({ type: "WARM_CARD_SHELL", path: `/rounds/${params.id}` })
      }
    }
    const load = async () => {
      const request = ++requestId.current
      try {
        if (!navigator.onLine) throw new Error("offline")
        const fresh = await loadPersonalCard(params.id)
        if (request === requestId.current) accept(fresh, false)
      } catch (e) {
        if (request !== requestId.current) return
        const fallback = isCardNetworkError(e) ? cachedPersonalCard(user.id, params.id) : null
        if (fallback) accept(fallback, true)
        else if (active) setError(isCardNetworkError(e) ? t("personal.offline.openFirst") : e instanceof Error ? e.message : t("personal.loadError"))
      }
    }
    setPrepared(false); setError(null)
    void load()
    const ready = (event: Event) => { if ((event as CustomEvent).detail?.path === `/rounds/${params.id}` && cachedPersonalCard(user.id, params.id)) setPrepared(true) }
    const synced = (event: Event) => { if ((event as CustomEvent).detail?.id === params.id) void load() }
    window.addEventListener("online", load); window.addEventListener("mulligan:offline-ready", ready)
    window.addEventListener("mulligan:card-synced", synced)
    return () => { active = false; invalidateRequests(); window.removeEventListener("online", load); window.removeEventListener("mulligan:offline-ready", ready); window.removeEventListener("mulligan:card-synced", synced) }
  }, [user, params.id, t])
  if (error) return <main role="alert" className="p-6 text-red-700">{error}</main>
  if (loading || !user || !data || loadedFor !== user.id) return <main className="p-6">{t("common.loading")}</main>
  return <>
    {(cached || prepared) && data.is_owner && <p role="status" className="mx-auto max-w-2xl px-4 pt-4 text-xs text-primary/70">{t(cached ? "personal.offline.cached" : "personal.offline.prepared")}</p>}
    {localBackup && <aside className="mx-auto max-w-2xl px-4 pt-4 text-sm text-amber-800"><p>{t("personal.offline.lockedBackup")}</p><button className="min-h-[44px] underline" onClick={() => downloadLocalScores(user.id, data.round.id)}>{t("personal.offline.download")}</button></aside>}
    <PersonalRoundEditor key={params.id} data={data} onReload={async () => { const request = ++requestId.current; const fresh = await loadPersonalCard(params.id); if (request !== requestId.current) return; cachePersonalCard(fresh); setCached(false); setData(fresh) }} />
  </>
}
