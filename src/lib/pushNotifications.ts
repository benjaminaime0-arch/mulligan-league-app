import { supabase } from "@/lib/supabase"

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

export function getPushPermission(): NotificationPermission | "unsupported" {
  return isPushSupported() ? Notification.permission : "unsupported"
}

/** iOS exposes PushManager only inside an installed Home Screen web app. */
export function needsPushInstallation(): boolean {
  if (typeof window === "undefined") return false
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  return ios && !window.matchMedia("(display-mode: standalone)").matches && !(navigator as Navigator & { standalone?: boolean }).standalone
}

async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js")
  // A broken worker must not leave the settings switch spinning forever.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Push worker unavailable")), 10_000) }),
    ])
  } finally { clearTimeout(timer) }
}

export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  let created: PushSubscription | null = null
  try {
    // Keep this before any other await: Safari requires a direct user gesture.
    const permission = await Notification.requestPermission()
    if (permission !== "granted") return false
    const { data: { session } } = await supabase.auth.getSession()
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
    if (!session || !vapidKey) return false
    const registration = await activeRegistration()
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource })
      created = subscription
    }
    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error("Invalid subscription")
    const { error } = await supabase.from("push_subscriptions").upsert({
      user_id: session.user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
    }, { onConflict: "user_id,endpoint" })
    if (error) throw new Error("Subscription save failed")
    return true
  } catch {
    // Never claim activation when the server cannot deliver to this device.
    if (created) await created.unsubscribe().catch(() => false)
    return false
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const registration = await navigator.serviceWorker.getRegistration("/")
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return true
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return false
    // Delete first: if the DB is unavailable the UI can retry, and stays enabled.
    const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", session.user.id).eq("endpoint", subscription.endpoint)
    if (error) return false
    return await subscription.unsubscribe()
  } catch { return false }
}

/** Stop notifications for the previous account on a shared phone, without an auth RPC. */
export async function detachBrowserPush(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const registration = await navigator.serviceWorker.getRegistration("/")
    const subscription = await registration?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  } catch { /* next activation checks the server again */ }
}

export async function isSubscribedToPush(): Promise<boolean> {
  if (!isPushSupported() || Notification.permission !== "granted") return false
  try {
    const registration = await navigator.serviceWorker.getRegistration("/")
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) return false
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return false
    const { data, error } = await supabase.from("push_subscriptions").select("id").eq("user_id", session.user.id).eq("endpoint", subscription.endpoint).maybeSingle()
    return !error && !!data
  } catch { return false }
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64 + "=".repeat((4 - base64.length % 4) % 4))
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0))
  if (bytes.length !== 65 || bytes[0] !== 4) throw new Error("Invalid VAPID public key")
  return bytes
}
