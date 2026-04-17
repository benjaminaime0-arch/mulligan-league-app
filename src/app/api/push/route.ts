import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
const webpush = require("web-push") as {
  setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void
  sendNotification: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string) => Promise<unknown>
}

/**
 * POST /api/push
 *
 * Sends web push notifications for a given notification record.
 * Called by a Supabase webhook on notifications INSERT, or can be
 * called manually.
 *
 * Expected body:
 * {
 *   "type": "INSERT",
 *   "record": { "id", "user_id", "type", "title", "body", "data" }
 * }
 *
 * Requires env vars:
 *   SUPABASE_SERVICE_ROLE_KEY — to read push_subscriptions
 *   VAPID_PRIVATE_KEY — for web-push signing
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — for web-push signing
 */

export async function POST(request: NextRequest) {
  // Verify webhook secret
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

    // Get user's push subscriptions
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

    const payload = JSON.stringify({
      title: record.title,
      body: record.body || "",
      tag: record.type || "notification",
      data: record.data || {},
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
