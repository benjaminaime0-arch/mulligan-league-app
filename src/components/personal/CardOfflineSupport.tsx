"use client"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { useAuthContext } from "@/components/AuthProvider"
import { useT } from "@/lib/i18n"
import { markCardShellReady, pendingCards } from "@/lib/cardOffline"
import { automaticDraftStatuses, cardDraftEngine } from "@/lib/cardDraftManager"

/** Register without asking for notifications. Push continues to use the same worker. */
export function CardOfflineSupport() {
  const { user } = useAuthContext()
  const pathname = usePathname()
  const t = useT()
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const [later, setLater] = useState(false)
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return
    let cancelled = false
    let approved = false
    let registration: ServiceWorkerRegistration | null = null
    const warm = () => {
      if (!pathname.startsWith("/rounds")) return
      registration?.active?.postMessage({ type: "WARM_CARD_SHELL", path: pathname })
    }
    const changed = () => { setWaiting(null); if (approved) window.location.reload(); else warm() }
    const ready = (event: MessageEvent) => {
      if (event.data?.type === "CARD_SHELL_READY") {
        markCardShellReady(event.data.path)
        window.dispatchEvent(new CustomEvent("mulligan:offline-ready", { detail: { path: event.data.path } }))
      }
    }
    navigator.serviceWorker.addEventListener("controllerchange", changed)
    navigator.serviceWorker.addEventListener("message", ready)
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then(async reg => {
      if (cancelled) return
      registration = reg
      setWaiting(reg.waiting)
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing
        worker?.addEventListener("statechange", () => { if (!cancelled && worker.state === "installed" && reg.waiting) setWaiting(reg.waiting) })
      })
      await navigator.serviceWorker.ready
      if (!cancelled) warm()
    }).catch(() => {})
    const activate = () => {
      if (user && pendingCards(user.id).length) return
      approved = true
      registration?.waiting?.postMessage({ type: "ACTIVATE_UPDATE" })
    }
    window.addEventListener("mulligan:activate-update", activate)
    return () => { cancelled = true; navigator.serviceWorker.removeEventListener("controllerchange", changed); navigator.serviceWorker.removeEventListener("message", ready); window.removeEventListener("mulligan:activate-update", activate) }
  }, [pathname, user])
  useEffect(() => {
    if (!user) return
    let disposed = false, pumping = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const pump = async () => {
      if (disposed || pumping || !navigator.onLine) return
      pumping = true
      try {
        for (const card of pendingCards(user.id)) {
          if (disposed) break
          const engine = cardDraftEngine(card)
          if (automaticDraftStatuses.includes(engine.snapshot().status)) await engine.flush().catch(() => {})
        }
      } finally { pumping = false }
    }
    const schedule = () => { if (pumping) return; if (timer) clearTimeout(timer); timer = setTimeout(() => void pump(), 700) }
    const wake = () => { if (document.visibilityState === "visible") void pump() }
    const interval = setInterval(() => void pump(), 15000)
    window.addEventListener("online", wake); window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake); window.addEventListener("mulligan:cards", schedule)
    schedule()
    return () => { disposed = true; if (timer) clearTimeout(timer); clearInterval(interval); window.removeEventListener("online", wake); window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake); window.removeEventListener("mulligan:cards", schedule) }
  }, [user])
  return waiting && !later ? <aside role="status" className="fixed bottom-24 left-4 right-4 z-50 mx-auto max-w-lg rounded-2xl border border-primary/20 bg-white p-4 shadow-lg md:bottom-6">
    <p className="text-sm">{t("personal.offline.update")}</p>
    <div className="mt-2 flex gap-4 text-sm font-bold"><button onClick={() => { if (user && pendingCards(user.id).length) { window.alert(t("personal.offline.syncBeforeUpdate")); return }; window.dispatchEvent(new Event("mulligan:activate-update")) }}>{t("personal.refresh")}</button><button onClick={() => setLater(true)}>{t("personal.offline.later")}</button></div>
  </aside> : null
}
