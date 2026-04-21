// Mulligan League — Push Notification Service Worker

// Take control ASAP on install/activate so users don't run stale SW versions.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("push", (event) => {
  if (!event.data) return

  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: "Mulligan League", body: event.data.text() }
  }

  const title = payload.title || "Mulligan League"
  const options = {
    body: payload.body || "",
    icon: "/logo-mark.png",
    badge: "/logo-mark.png",
    // Use the notification id as the tag when available so the OS can collapse duplicates
    tag: payload.tag || payload.data?.notification_id || "mulligan-notification",
    data: payload.data || {},
    vibrate: [100, 50, 100],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const data = event.notification.data || {}
  let url = "/notifications"

  if (data.match_id) {
    url = `/matches/${data.match_id}`
  } else if (data.league_id) {
    url = `/leagues/${data.league_id}`
  } else if (data.new_member_id) {
    url = `/players/${data.new_member_id}`
  }

  // Append notification_id so the client can mark it read on arrival.
  if (data.notification_id) {
    const sep = url.includes("?") ? "&" : "?"
    url = `${url}${sep}n=${encodeURIComponent(data.notification_id)}`
  }

  event.waitUntil(
    (async () => {
      const windowClients = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })

      // Prefer a visible tab already on our origin.
      const visible = windowClients.find(
        (c) =>
          c.url.startsWith(self.location.origin) &&
          c.visibilityState === "visible",
      )

      // Otherwise, any tab that already has the target URL open.
      const alreadyOnTarget = windowClients.find(
        (c) => c.url.startsWith(self.location.origin) && c.url.endsWith(url),
      )

      const target = alreadyOnTarget || visible

      if (target && "focus" in target) {
        try {
          // Only navigate when not already at the URL (avoids reloading into same route).
          if (!target.url.endsWith(url) && "navigate" in target) {
            await target.navigate(url)
          }
          return target.focus()
        } catch {
          // fall through to openWindow below
        }
      }

      // No suitable existing tab → open a new one.
      if (clients.openWindow) {
        return clients.openWindow(url)
      }
    })(),
  )
})
