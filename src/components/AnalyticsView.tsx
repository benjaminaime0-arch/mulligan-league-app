"use client"
import { useEffect } from "react"
import { ANALYTICS_READY, CONSENT_CHANGED, trackOnce, type AnalyticsEvent } from "@/lib/analytics"

export function AnalyticsView({ event, viewKey, params = {} }: {
  event: AnalyticsEvent; viewKey: string; params?: Record<string, string | number | boolean>
}) {
  const serialized = JSON.stringify(params)
  useEffect(() => {
    const record = () => trackOnce(event, viewKey, JSON.parse(serialized))
    record()
    window.addEventListener(CONSENT_CHANGED, record)
    window.addEventListener(ANALYTICS_READY, record)
    return () => { window.removeEventListener(CONSENT_CHANGED, record); window.removeEventListener(ANALYTICS_READY, record) }
  }, [event, viewKey, serialized])
  return null
}
