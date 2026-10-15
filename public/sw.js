// Mulligan League — Push Notification Service Worker

// Only generic client-rendered card shells and immutable assets are cached.
// Supabase, API routes, POSTs, leagues and server data never enter Cache Storage.
const CARD_CACHE = "mulligan-card-shell-v1"
const cardPath = path => path === "/rounds" || /^\/rounds\/[0-9a-f-]{36}$/.test(path)
const assetPath = path => path.startsWith("/_next/static/") || ["/logo-mark.png", "/logo-mark-white.png", "/offline.html"].includes(path)
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CARD_CACHE)
    await cache.addAll(["/offline.html", "/logo-mark.png"])
    // Updates wait for the user or the last open tab to close. Never reload an editor.
    if (!self.registration.active) await self.skipWaiting()
  })())
})
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()) })
async function warmShell(path) {
  const cache = await caches.open(CARD_CACHE)
  for (const route of new Set(["/rounds", path])) {
    if (!cardPath(route)) continue
    const response = await fetch(route, { cache: "no-cache" })
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) throw new Error("Shell unavailable")
    await cache.put(route, response.clone())
    const html = await response.text()
    const urls = [...html.matchAll(/(?:src|href)="([^" ]+)"/g)].map(match => new URL(match[1].replace(/&amp;/g, "&"), self.location.origin)).filter(url => url.origin === self.location.origin && assetPath(url.pathname))
    await Promise.all(urls.map(async url => { if (await cache.match(url.href)) return; const asset = await fetch(url.href); if (asset.ok) await cache.put(url.href, asset) }))
  }
}
self.addEventListener("message", event => {
  if (event.data?.type === "ACTIVATE_UPDATE") { event.waitUntil(self.skipWaiting()); return }
  if (event.data?.type === "WARM_CARD_SHELL" && cardPath(event.data.path)) {
    event.waitUntil(warmShell(event.data.path).then(() => event.source?.postMessage({ type: "CARD_SHELL_READY", path: event.data.path })).catch(() => {}))
  }
})
self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return
  if (assetPath(url.pathname)) {
    event.respondWith((async () => { const cache = await caches.open(CARD_CACHE); const cached = await cache.match(request); if (cached) return cached; const response = await fetch(request); if (response.ok) await cache.put(request, response.clone()); return response })())
  } else if (request.mode === "navigate" && cardPath(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CARD_CACHE)
      try { const response = await fetch(request); if (response.ok) { await cache.put(url.pathname, response.clone()); return response } } catch { /* network unavailable */ }
      return (await cache.match(url.pathname)) || (await cache.match("/offline.html"))
    })())
  }
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

  if (data.round_id) {
    url = `/rounds/${data.round_id}`
  } else if (data.match_id) {
    url = `/matches/${data.match_id}`
  } else if (data.game_id) {
    url = `/games/${data.game_id}`
  } else if (data.league_id) {
    // Pre-rename payloads: league ids ARE game ids (the table was renamed
    // in place), and /leagues/* was never a route in this app.
    url = `/games/${data.league_id}`
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
