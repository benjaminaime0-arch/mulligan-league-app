import { supabase } from "@/lib/supabase"

/**
 * Check if the browser supports push notifications
 */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

/**
 * Get the current push permission state
 */
export function getPushPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported"
  return Notification.permission
}

/**
 * Register the service worker and subscribe to push notifications
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false

  try {
    // Request notification permission
    const permission = await Notification.requestPermission()
    if (permission !== "granted") return false

    // Register service worker
    const registration = await navigator.serviceWorker.register("/sw.js")
    await navigator.serviceWorker.ready

    // Get VAPID public key from env
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) {
      console.warn("VAPID public key not configured — push disabled")
      return false
    }

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    })

    // Store subscription in Supabase
    const subJson = subscription.toJSON()
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session) return false

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: sessionData.session.user.id,
        endpoint: subJson.endpoint!,
        p256dh: subJson.keys!.p256dh!,
        auth: subJson.keys!.auth!,
      },
      { onConflict: "user_id,endpoint" },
    )

    if (error) {
      console.error("Failed to save push subscription:", error)
      return false
    }

    return true
  } catch (err) {
    console.error("Push subscription failed:", err)
    return false
  }
}

/**
 * Unsubscribe from push notifications
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()

    if (subscription) {
      const endpoint = subscription.endpoint

      // Unsubscribe from browser
      await subscription.unsubscribe()

      // Remove from Supabase
      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData.session) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", sessionData.session.user.id)
          .eq("endpoint", endpoint)
      }
    }

    return true
  } catch (err) {
    console.error("Push unsubscribe failed:", err)
    return false
  }
}

/**
 * Check if the user is currently subscribed to push
 */
export async function isSubscribedToPush(): Promise<boolean> {
  if (!isPushSupported()) return false

  try {
    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    return subscription !== null
  } catch {
    return false
  }
}

/**
 * Convert a VAPID base64 string to a Uint8Array for applicationServerKey
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
