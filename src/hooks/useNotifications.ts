"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"

export type Notification = {
  id: string
  user_id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

export function useNotifications() {
  const { user, loading: authLoading } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    if (!user) return

    const [notifRes, countRes] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.rpc("get_unread_notification_count"),
    ])

    if (!notifRes.error && notifRes.data) {
      setNotifications(notifRes.data as Notification[])
    }
    if (!countRes.error && countRes.data != null) {
      setUnreadCount(countRes.data as number)
    }
    setLoading(false)
  }, [user])

  // Initial fetch + real-time subscription
  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false)
      return
    }

    fetchNotifications()

    // Subscribe to real-time inserts on notifications for this user
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification
          setNotifications((prev) => [newNotif, ...prev].slice(0, 50))
          setUnreadCount((prev) => prev + 1)
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [authLoading, user, fetchNotifications])

  // Mark single notification as read
  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!user) return

      await supabase.rpc("mark_notifications_read", {
        p_notification_ids: [notificationId],
      })

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    },
    [user],
  )

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    if (!user) return

    await supabase.rpc("mark_all_notifications_read")

    setNotifications((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    )
    setUnreadCount(0)
  }, [user])

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  }
}

/**
 * Lightweight hook that only tracks the unread count (for the navbar badge).
 * Avoids fetching the full notification list on every page.
 */
export function useUnreadCount() {
  const { user, loading: authLoading } = useAuth()
  const [count, setCount] = useState(0)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    if (authLoading || !user) return

    // Fetch initial count
    const fetchCount = async () => {
      const { data } = await supabase.rpc("get_unread_notification_count")
      if (data != null) setCount(data as number)
    }
    fetchCount()

    // Real-time: increment on new notification
    const channel = supabase
      .channel(`unread-count:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          setCount((prev) => prev + 1)
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [authLoading, user])

  const reset = useCallback(() => setCount(0), [])

  return { count, reset }
}
