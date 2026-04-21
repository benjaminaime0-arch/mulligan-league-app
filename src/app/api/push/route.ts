import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

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

/**
 * POST /api/push
 *
 * Sends web-push notifications for a given notification record.
 * Invoked by a Supabase Database Webhook on notifications INSERT
 * (configured in the Supabase Dashboard, not here). Can also be
 * called manually for smoke-tests.
 *
 * Expected body (either shape):
 *   { "record": { ...notifications row } }
 *   { ...notifications row }
 *
 * Required env vars:
 *   SUPABASE_SERVICE_ROLE_KEY    — read push_subscriptions
 *   VAPID_PRIVATE_KEY            — web-push signing
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — web-push signing
 *   PUSH_WEBHOOK_SECRET          — optional; if set, the webhook must
 *                                  send Authorization: Bearer <secret>
 */
export async function POST(request: NextRequest) {
  // Verify webhook secret (optional but recommended)
  const webhookSecret = process.env.PUSH_WEBHOOK_SECRET
  if (webhookSecret) {
    const authHeader = request.headers.get("authorization")
    if (authHeader !== `Bearer ${webhookSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const body = await request.json()
    const record = body.record || body

    if (!record.user_id || !record.title) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Use service role to read push subscriptions
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server not configured for push" },
        { status: 500 },
      )
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

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
      "mailto:hello@mulliganleague.com",
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
