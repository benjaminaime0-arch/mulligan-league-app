"use client"
import { useEffect, useState } from "react"
import { useT } from "@/lib/i18n"
// Display only: the database worker owns the transition. Advance using elapsed
// time from the server response, rather than trusting the device's wall clock.
export function ValidationTimer({ due, serverNow }: { due: string; serverNow: string }) {
  const t = useT()
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((Date.parse(due) - Date.parse(serverNow)) / 1000)))
  useEffect(() => {
    const started = performance.now()
    const initial = Date.parse(due) - Date.parse(serverNow)
    const tick = () => setSeconds(Math.max(0, Math.ceil((initial - (performance.now() - started)) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [due, serverNow])
  if (seconds === 0) return <p className="mt-2 text-sm">{t("personal.lifecycle.timerDue")}</p>
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return <p className="mt-2 text-sm">{t("personal.lifecycle.remaining", { h: hours, m: minutes })}</p>
}
