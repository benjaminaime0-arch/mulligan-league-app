import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { timingSafeEqual } from "crypto"

// web-push ships CJS and has no bundled types. Keep the require but pin a
// precise local type so callers get real inference.
type PushSubscription = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}
type WebPush = {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void
  sendNotification: (sub: PushSubscription, payload: string) => Promise<unknown>
}
const webpush = require("web-push") as WebPush

/** Constant-time string comparison — a plain === leaks length/prefix timing. */
function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * POST /api/push
 *
 * Sends web-push notifications for a given notification record.
 * Invoked by the send_push_on_notification DB trigger on notifications
 * INSERT. Can also be called manually for smoke-tests — with the secret.
 *
 * FAIL-CLOSED CONTRACT (T0.4, AUD#4):
 *   - PUSH_WEBHOOK_SECRET unset  → 500 on every request. The endpoint
 *     never operates unauthenticated.
 *   - Bearer mismatch            → 401, uniform body, constant-time compare.
 *   - Push content is NEVER taken from the request body. The body only
 *     names a notification id; title/body/type/data/user_id are re-read
 *     from the notifications table, so even a caller holding the secret
 *     cannot push content that does not exist in the database.
 *
 * Expected body (either shape):
 *   { "record": { "id": "<notification uuid>", ... } }
 *   { "id": "<notification uuid>", ... }
 *
 * Required env vars:
 *   PUSH_WEBHOOK_SECRET          — bearer secret; REQUIRED (fail closed)
 *   SUPABASE_SERVICE_ROLE_KEY    — read notifications + push_subscriptions
 *   VAPID_PRIVATE_KEY            — web-push signing
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — web-push signing
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.PUSH_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error("PUSH_WEBHOOK_SECRET is not set — /api/push refuses to serve")
    return NextResponse.json(
      { error: "Push endpoint not configured" },
      { status: 500 },
    )
  }

  const authHeader = request.headers.get("authorization") ?? ""
  if (!secureEquals(authHeader, `Bearer ${webhookSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const notificationId: unknown = (body.record || body)?.id

    if (typeof notificationId !== "string" || notificationId.length === 0) {
      return NextResponse.json({ error: "Missing notification id" }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server not configured for push" },
        { status: 500 },
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

    // The database is the only source of push content — every other field
    // in the request body is ignored.
    const { data: record, error: recordError } = await supabaseAdmin
      .from("notifications")
      .select("id, user_id, type, title, body, data, created_at")
      .eq("id", notificationId)
      .maybeSingle()

    if (recordError) {
      console.error("Push API: notification lookup failed:", recordError)
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 })
    }
    if (!record) {
      return NextResponse.json({ error: "Unknown notification" }, { status: 404 })
    }

    // ── Rapid-fire throttle ─────────────────────────────────────
    // If the user already received 3+ notifications in the last 60
    // seconds (not counting this one), skip the OS push to avoid
    // buzzing them to death. The in-app notification still exists
    // in the database and will appear in the bell when they check.
    const throttleWindowMs = 60_000
    const throttleThreshold = 3
    const sinceIso = new Date(Date.now() - throttleWindowMs).toISOString()
    const { count: recentCount } = await supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", record.user_id)
      .gte("created_at", sinceIso)
      .neq("id", record.id)

    if (recentCount != null && recentCount >= throttleThreshold) {
      return NextResponse.json({
        sent: 0,
        reason: "Throttled (rapid-fire)",
        recentCount,
      })
    }

    // ── Per-type preference check ───────────────────────────────
    // User may have muted this notification type. Defaults to true
    // if no preference row exists.
    if (record.type) {
      const { data: pushAllowed } = await supabaseAdmin.rpc("should_send_push", {
        p_user_id: record.user_id,
        p_type: record.type,
      })
      if (pushAllowed === false) {
        return NextResponse.json({
          sent: 0,
          reason: "User muted this notification type",
        })
      }
    }

    const { data: subscriptions, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", record.user_id)

    if (error || !subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0, reason: "No subscriptions" })
    }

    const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY
    if (!vapidPublic || !vapidPrivate) {
      return NextResponse.json(
        { error: "VAPID keys not configured" },
        { status: 500 },
      )
    }

    webpush.setVapidDetails(
      "mailto:hello@mulliganclub.co",
      vapidPublic,
      vapidPrivate,
    )

    // Bundle the notification_id into the payload so the SW can use it for
    // OS-level tag dedupe (and future deep-link read-tracking).
    const payload = JSON.stringify({
      title: record.title,
      body: record.body || "",
      tag: record.type || "notification",
      data: {
        ...(record.data || {}),
        notification_id: record.id,
        type: record.type,
      },
    })

    let sent = 0
    const failures: string[] = []

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
        )
        sent++
      } catch (err: unknown) {
        const pushErr = err as { statusCode?: number }
        // Remove expired subscriptions (410 Gone or 404)
        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
          await supabaseAdmin
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint)
        }
        failures.push(sub.endpoint.slice(0, 40) + "...")
      }
    }

    return NextResponse.json({ sent, failures: failures.length })
  } catch (err) {
    console.error("Push API error:", err)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    )
  }
}
