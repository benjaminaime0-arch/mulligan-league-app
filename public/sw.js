// Mulligan League — Push Notification Service Worker

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
    tag: payload.tag || "mulligan-notification",
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
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Focus existing tab if found
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) {
        return clients.openWindow(url)
      }
    }),
  )
})
