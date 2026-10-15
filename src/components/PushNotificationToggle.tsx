"use client"

import { useEffect, useState } from "react"
import {
  isPushSupported,
  getPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  isSubscribedToPush,
} from "@/lib/pushNotifications"
import { useT } from "@/lib/i18n"

export function PushNotificationToggle() {
  const t = useT()
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    const check = async () => {
      const sup = isPushSupported()
      setSupported(sup)
      if (sup) {
        const sub = await isSubscribedToPush()
        setSubscribed(sub)
      }
      setLoading(false)
    }
    check()
  }, [])

  if (!supported || loading) return null

  const permission = getPushPermission()
  const denied = permission === "denied"

  const handleToggle = async () => {
    setToggling(true)
    try {
      if (subscribed) {
        const success = await unsubscribeFromPush()
        if (success) setSubscribed(false)
      } else {
        const success = await subscribeToPush()
        if (success) setSubscribed(true)
      }
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/10 bg-cream px-4 py-3">
      <div>
        <p className="text-sm font-medium text-primary">{t("notif.push.title")}</p>
        <p className="text-xs text-primary/50">
          {denied
            ? t("notif.push.blocked")
            : subscribed
            ? t("notif.push.on")
            : t("notif.push.off")}
        </p>
      </div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling || denied}
        className="flex h-11 w-12 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
        role="switch"
        aria-checked={subscribed}
        aria-label={subscribed ? t("notif.push.disable") : t("notif.push.enable")}
      >
        <span className={`relative block h-6 w-10 rounded-full ${subscribed ? "bg-primary" : "bg-primary/20"}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${subscribed ? "translate-x-4" : ""}`} /></span>
      </button>
    </div>
  )
}
