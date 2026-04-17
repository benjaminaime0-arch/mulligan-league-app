"use client"

import { useEffect, useState } from "react"
import {
  isPushSupported,
  getPushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  isSubscribedToPush,
} from "@/lib/pushNotifications"

export function PushNotificationToggle() {
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
        <p className="text-sm font-medium text-primary">Push notifications</p>
        <p className="text-xs text-primary/50">
          {denied
            ? "Notifications blocked in browser settings"
            : subscribed
            ? "You\u2019ll get alerts for scores, approvals & more"
            : "Get notified when scores are submitted"}
        </p>
      </div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling || denied}
        className={`relative h-7 w-12 rounded-full transition-colors ${
          subscribed ? "bg-emerald-500" : "bg-primary/20"
        } ${denied ? "cursor-not-allowed opacity-40" : ""}`}
        aria-label={subscribed ? "Disable push notifications" : "Enable push notifications"}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            subscribed ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  )
}
