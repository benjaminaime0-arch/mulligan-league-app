"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import type { NotificationType } from "@/lib/notificationDisplay"

export type Notification = {
  id: string
  user_id: string
  /** One of NotificationType, but kept wider so forward-compat DB additions don't break. */
  type: NotificationType | string
  title: string
  body: string | null
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

const DEFAULT_PAGE_SIZE = 50

export interface UseNotificationsOptions {
  /** How many to fetch per page. Default 50. */
  pageSize?: number
  /** If true, exposes loadMore/hasMore. Default false (bell doesn't need it). */
  paginated?: boolean
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { pageSize = DEFAULT_PAGE_SIZE, paginated = false } = options
  const { user, loading: authLoading } = useAuth()

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  /** Initial + refresh fetch: first page, newest first. */
  const fetchNotifications = useCallback(async () => {
    if (!user) return

    const [notifRes, countRes] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(pageSize + 1), // +1 to detect hasMore without a count
      supabase.rpc("get_unread_notification_count"),
    ])

    if (!notifRes.error && notifRes.data) {
      const rows = notifRes.data as Notification[]
      if (rows.length > pageSize) {
        setHasMore(true)
        setNotifications(rows.slice(0, pageSize))
      } else {
        setHasMore(false)
        setNotifications(rows)
      }
    }
    if (!countRes.error && countRes.data != null) {
      setUnreadCount(countRes.data as number)
    }
    setLoading(false)
  }, [user, pageSize])

  /** Load the next page of older notifications (opt-in via `paginated: true`). */
  const loadMore = useCallback(async () => {
    if (!user || !paginated || loadingMore || !hasMore) return
    const oldest = notifications[notifications.length - 1]
    if (!oldest) return

    setLoadingMore(true)
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .lt("created_at", oldest.created_at)
      .order("created_at", { ascending: false })
      .limit(pageSize + 1)

    if (!error && data) {
      const rows = data as Notification[]
      if (rows.length > pageSize) {
        setHasMore(true)
        setNotifications((prev) => [...prev, ...rows.slice(0, pageSize)])
      } else {
        setHasMore(false)
        setNotifications((prev) => [...prev, ...rows])
      }
    }
    setLoadingMore(false)
  }, [user, paginated, loadingMore, hasMore, notifications, pageSize])

  // Initial fetch + realtime subscription (INSERT + UPDATE)
  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false)
      return
    }

    fetchNotifications()

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
          setNotifications((prev) => {
            // Guard against duplicate inserts
            if (prev.some((n) => n.id === newNotif.id)) return prev
            return [newNotif, ...prev].slice(0, pageSize)
          })
          if (!newNotif.read_at) {
            setUnreadCount((prev) => prev + 1)
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const updated = payload.new as Notification
          const prevRow = payload.old as Notification | null

          setNotifications((prev) =>
            prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)),
          )

          // Sync unread count on read_at transitions (cross-tab / cross-device)
          const wasUnread = !prevRow?.read_at
          const nowRead = !!updated.read_at
          if (wasUnread && nowRead) {
            setUnreadCount((prev) => Math.max(0, prev - 1))
          } else if (!wasUnread && !nowRead) {
            setUnreadCount((prev) => prev + 1)
          }
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
  }, [authLoading, user, fetchNotifications, pageSize])

  /**
   * Mark single notification as read. Optimistic update with rollback on error.
   */
  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!user) return

      // Snapshot for rollback
      const prev = notifications.find((n) => n.id === notificationId)
      if (!prev || prev.read_at) return // already read, no-op

      // Optimistic
      const nowIso = new Date().toISOString()
      setNotifications((prevList) =>
        prevList.map((n) =>
          n.id === notificationId ? { ...n, read_at: nowIso } : n,
        ),
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))

      const { error } = await supabase.rpc("mark_notifications_read", {
        p_notification_ids: [notificationId],
      })

      if (error) {
        // Rollback
        setNotifications((prevList) =>
          prevList.map((n) =>
            n.id === notificationId ? { ...n, read_at: null } : n,
          ),
        )
        setUnreadCount((prev) => prev + 1)
      }
    },
    [user, notifications],
  )

  /** Mark every unread notification as read. Optimistic + rollback. */
  const markAllAsRead = useCallback(async () => {
    if (!user) return

    const snapshot = notifications
    const unreadIds = snapshot.filter((n) => !n.read_at).map((n) => n.id)
    if (unreadIds.length === 0) return

    const nowIso = new Date().toISOString()
    setNotifications((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: nowIso })),
    )
    const previousUnread = unreadCount
    setUnreadCount(0)

    const { error } = await supabase.rpc("mark_all_notifications_read")

    if (error) {
      // Rollback
      setNotifications(snapshot)
      setUnreadCount(previousUnread)
    }
  }, [user, notifications, unreadCount])

  return {
    notifications,
    unreadCount,
    loading,
    hasMore,
    loadingMore,
    loadMore,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  }
}

/**
 * Lightweight hook that only tracks the unread count (for the navbar badge).
 * Listens to both INSERT and UPDATE so the badge stays in sync across tabs.
 */
export function useUnreadCount() {
  const { user, loading: authLoading } = useAuth()
  const [count, setCount] = useState(0)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    if (authLoading || !user) return

    const fetchCount = async () => {
      const { data } = await supabase.rpc("get_unread_notification_count")
      if (data != null) setCount(data as number)
    }
    fetchCount()

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
        (payload) => {
          const n = payload.new as Notification
          if (!n.read_at) setCount((prev) => prev + 1)
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const prevRow = payload.old as Notification | null
          const updated = payload.new as Notification
          const wasUnread = !prevRow?.read_at
          const nowRead = !!updated.read_at
          if (wasUnread && nowRead) setCount((prev) => Math.max(0, prev - 1))
          else if (!wasUnread && !nowRead) setCount((prev) => prev + 1)
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
