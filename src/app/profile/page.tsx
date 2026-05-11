"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
// fetchMatchPlayers + MatchPlayer types used to feed the old
// MatchCarousel/PastMatchCarousel components — those were replaced by
// MatchCalendarSection (fetches full rosters inline) and removed.
import { LoadingSpinner } from "@/components/LoadingSpinner"
import AvatarCropModal from "@/components/AvatarCropModal"
import { ConfirmModal } from "@/components/ConfirmModal"
import { RecordsCard, type RecordsData } from "@/components/profile/RecordsCard"
import {
  MyHonorsCard,
  type UserHonorRow,
} from "@/components/profile/MyHonorsCard"
import { MatchCalendarSection } from "@/components/match/MatchCalendarSection"
import type { League as SharedLeague, Match as SharedMatch, MatchPlayer as SharedMatchPlayer } from "@/components/match/types"
import { ScoreTrendCard } from "@/components/profile/ScoreTrendCard"
import { LeaderboardTable } from "@/app/leagues/[id]/components/LeaderboardTable"
import type { LeaderboardRow } from "@/app/leagues/[id]/types"
import { resolveFormat } from "@/lib/leagueFormat"

type Profile = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  town?: string | null
  handicap?: number | null
  avatar_url?: string | null
  username?: string | null
}

type LeagueMember = {
  id: string
  league_id: string
  leagues?: LeagueData | null
}

type LeagueData = {
  id: string
  name: string
  course_name?: string | null
  max_players?: number | null
  status?: string | null
  league_type?: string | null
  scoring_cards_count?: number | null
  total_cards_count?: number | null
  start_date?: string | null
  end_date?: string | null
  format?: string | null
}

// ScheduledMatch/PastMatch types removed with the retired carousels.
// The /profile/matches page has its own copies for its full-list UI.

// ActivityEvent / feed removed — the profile no longer shows a
// cross-league activity feed. Each league page now carries its own
// scoped feed via `LeagueActivityCard` + `get_league_activity_feed`.

export default function ProfilePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<LeagueMember[]>([])
  // Leagues the viewer belongs to, deduped, used to drive the
  // per-league leaderboard carousel at the bottom of /profile.
  const [myLeagues, setMyLeagues] = useState<LeagueData[]>([])
  // Leaderboard rows keyed by league id. Populated in parallel after
  // memberships resolve — each league's leaderboard is a separate
  // `get_leaderboard` RPC call (they're small and member-gated).
  const [leaderboardsByLeague, setLeaderboardsByLeague] = useState<
    Map<string, LeaderboardRow[]>
  >(new Map())
  // Scheduled + past matches moved to /profile/matches page.
  // Activity feed moved to per-league (LeagueActivityCard).
  const [matchesPlayed, setMatchesPlayed] = useState(0)
  const [records, setRecords] = useState<RecordsData | null>(null)
  // Cross-league honors — badges the viewer currently holds. Null
  // while loading, empty array once loaded with nothing earned yet.
  const [honors, setHonors] = useState<UserHonorRow[] | null>(null)
  // Viewer's matches within the calendar window (±30 days around
  // today) + lookups the MatchCalendarSection needs to render per-
  // match detail cards: `calendarMatches` is the raw list,
  // `calendarPlayersMap` keys rosters by match id,
  // `calendarLeaguesById` lets the section resolve each match to its
  // league (matches span multiple leagues on profile, unlike league
  // page where every card shares the same league).
  const [calendarMatches, setCalendarMatches] = useState<SharedMatch[]>([])
  const [calendarPlayersMap, setCalendarPlayersMap] = useState<
    Map<string | number, SharedMatchPlayer[]>
  >(new Map())
  const [calendarLeaguesById, setCalendarLeaguesById] = useState<
    Map<string, SharedLeague>
  >(new Map())
  // ScoreTrendCard now owns its own trend state (fetched per range selection)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  /**
   * Pulls the viewer's matches in a ±30 day window around today and
   * builds the three maps MatchCalendarSection consumes: the matches
   * themselves, per-match rosters (with scores + approved_at), and a
   * leagues-by-id map used as the `resolveLeague` backing for the
   * detail card.
   *
   * Three queries in parallel:
   *   1. match_players (mine, in window) → matches & leagues
   *   2. match_players (all, for those matches) → rosters
   *   3. scores (for those matches) → per-player score + status
   *
   * Exposed as onRefresh to the section so inline mutations
   * (edit scores, approve, leave, delete) re-pull on success.
   */
  const loadLeaderboards = useCallback(
    async (leagueIds: string[]): Promise<Map<string, LeaderboardRow[]>> => {
      if (leagueIds.length === 0) return new Map()
      const results = await Promise.all(
        leagueIds.map((id) =>
          supabase
            .rpc("get_leaderboard", { p_league_id: id })
            .then((res) => ({
              id,
              rows: res.error ? [] : ((res.data || []) as LeaderboardRow[]),
            })),
        ),
      )
      const map = new Map<string, LeaderboardRow[]>()
      for (const r of results) map.set(r.id, r.rows)
      return map
    },
    [],
  )
  const loadCalendar = useCallback(async (userId: string) => {
    const now = new Date()
    const start = new Date(now)
    start.setDate(now.getDate() - 30)
    const end = new Date(now)
    end.setDate(now.getDate() + 30)
    const startIso = start.toISOString().slice(0, 10)
    const endIso = end.toISOString().slice(0, 10)

    type LeagueEmbed = {
      id: string
      name: string
      course_name?: string | null
      status?: string | null
      max_players?: number | null
      scoring_cards_count?: number | null
      total_cards_count?: number | null
      invite_code?: string | null
      admin_id?: string | null
      start_date?: string | null
      end_date?: string | null
    }
    type MineRow = {
      match_id: string
      matches:
        | {
            id: string
            course_name: string | null
            match_date: string | null
            match_time: string | null
            status: string | null
            league_id: string | null
            created_by: string | null
            leagues: LeagueEmbed | null
          }
        | null
    }

    // Step 1
    const mineRes = await supabase
      .from("match_players")
      .select(
        "match_id, matches!inner(id, course_name, match_date, match_time, status, league_id, created_by, leagues(id, name, course_name, status, max_players, scoring_cards_count, total_cards_count, invite_code, admin_id, start_date, end_date))",
      )
      .eq("user_id", userId)
      .gte("matches.match_date", startIso)
      .lte("matches.match_date", endIso)

    const mineRows = ((mineRes.data as unknown) as MineRow[]) || []
    const uniqueMatches: SharedMatch[] = []
    const leaguesById = new Map<string, SharedLeague>()
    const seen = new Set<string>()

    for (const row of mineRows) {
      const m = row.matches
      if (!m || seen.has(m.id)) continue
      seen.add(m.id)
      uniqueMatches.push({
        id: m.id,
        league_id: m.league_id ?? "",
        course_name: m.course_name,
        match_date: m.match_date,
        match_time: m.match_time,
        status: m.status,
        created_by: m.created_by,
      })
      if (m.leagues && !leaguesById.has(String(m.leagues.id))) {
        leaguesById.set(String(m.leagues.id), m.leagues as SharedLeague)
      }
    }

    setCalendarMatches(uniqueMatches)
    setCalendarLeaguesById(leaguesById)

    if (uniqueMatches.length === 0) {
      setCalendarPlayersMap(new Map())
      return
    }

    const matchIds = uniqueMatches.map((m) => m.id)

    // Steps 2 + 3
    const [rostersRes, scoresRes] = await Promise.all([
      supabase
        .from("match_players")
        .select(
          "match_id, user_id, approved_at, profiles(username, first_name, avatar_url)",
        )
        .in("match_id", matchIds),
      supabase
        .from("scores")
        .select("match_id, user_id, score, holes, status")
        .in("match_id", matchIds),
    ])

    type ScoreRow = {
      match_id: string
      user_id: string
      score: number
      holes: number | null
      status: string
    }
    type RosterRow = {
      match_id: string
      user_id: string
      approved_at: string | null
      profiles: {
        username?: string | null
        first_name?: string | null
        avatar_url?: string | null
      } | null
    }

    const scoreLookup = new Map<
      string,
      { score: number; holes: number | null; status: string }
    >()
    for (const s of (scoresRes.data || []) as ScoreRow[]) {
      scoreLookup.set(`${s.match_id}:${s.user_id}`, {
        score: s.score,
        holes: s.holes,
        status: s.status,
      })
    }

    const map = new Map<string | number, SharedMatchPlayer[]>()
    for (const r of (rostersRes.data || []) as RosterRow[]) {
      const key = `${r.match_id}:${r.user_id}`
      const entry = scoreLookup.get(key)
      const arr = map.get(r.match_id) || []
      arr.push({
        name:
          r.profiles?.username ||
          r.profiles?.first_name ||
          "Player",
        avatar_url: r.profiles?.avatar_url ?? null,
        user_id: r.user_id,
        score: entry?.score ?? null,
        holes: entry?.holes ?? null,
        status: entry?.status ?? null,
        approved_at: r.approved_at,
      })
      map.set(r.match_id, arr)
    }
    setCalendarPlayersMap(map)
  }, [])

  // Profile editing
  const [editing, setEditing] = useState(false)
  const [editUsername, setEditUsername] = useState("")
  const [editFirstName, setEditFirstName] = useState("")
  const [editLastName, setEditLastName] = useState("")
  const [editTown, setEditTown] = useState("")
  const [editHandicap, setEditHandicap] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)

  useEffect(() => {
    if (authLoading || !user) return

    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        const userId = user.id

        // Pull profile, memberships, and count of played matches in parallel
        const [profileRes, membershipsRes, scoresCountRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase
            .from("league_members")
            .select("id, league_id, leagues(*)")
            .eq("user_id", userId),
          supabase
            .from("scores")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId),
        ])

        if (profileRes.error) throw profileRes.error
        setProfile((profileRes.data || null) as Profile | null)

        if (membershipsRes.error) throw membershipsRes.error
        const membershipData = (membershipsRes.data as unknown as LeagueMember[]) || []
        setMemberships(membershipData)

        // Dedupe memberships into the leagues-I-belong-to list. The
        // bottom of /profile renders a switcher + LeaderboardTable per
        // league — we only need the core league row here (name,
        // course, format, scoring config). Member rosters + period
        // info come from the leaderboard RPC directly.
        const leagueMap = new Map<string, LeagueData>()
        for (const m of membershipData) {
          const l = m.leagues as LeagueData | null
          if (l && !leagueMap.has(String(l.id))) {
            leagueMap.set(String(l.id), l)
          }
        }
        // Sort active leagues first (draft/active ahead of completed)
        // so the carousel lands on a live league by default. Within
        // each bucket, most-recently-started first — the user is most
        // likely thinking about their newest league. Completed leagues
        // stay reachable via the switcher; we don't filter them out
        // because final standings are still useful history.
        const statusRank: Record<string, number> = {
          active: 0,
          draft: 1,
          completed: 2,
        }
        const leagueList = Array.from(leagueMap.values()).sort((a, b) => {
          const ra = statusRank[a.status ?? "draft"] ?? 1
          const rb = statusRank[b.status ?? "draft"] ?? 1
          if (ra !== rb) return ra - rb
          return (b.start_date || "").localeCompare(a.start_date || "")
        })
        setMyLeagues(leagueList)

        // Scheduled + past match lists moved to /profile/matches —
        // reachable via the "My calendar →" link in MatchCalendarSection's
        // header. We no longer fetch or render those here on /profile.

        // Activity feed retired at the profile level — each league
        // page owns its own scoped feed now. No fetch needed here.

        // Dashboard RPCs in parallel: records + honors + per-league
        // leaderboards. Courses card was retired from /profile; the
        // "courses played" roll-up still exists on /players/[id].
        const [[recordsRes, honorsRes], lbMap] = await Promise.all([
          Promise.all([
            supabase.rpc("get_profile_records", { p_user_id: userId }),
            supabase.rpc("get_user_honors", { p_user_id: userId }),
          ]),
          loadLeaderboards(leagueList.map((l) => String(l.id))),
        ])
        if (!recordsRes.error && recordsRes.data) {
          setRecords(recordsRes.data as RecordsData)
        }
        // Honors are non-critical — if the RPC isn't deployed yet or
        // hits a transient issue, we fall back to an empty list so
        // the rest of the profile still renders.
        if (honorsRes.error) {
          console.warn("get_user_honors failed", honorsRes.error)
          setHonors([])
        } else {
          setHonors((honorsRes.data || []) as UserHonorRow[])
        }
        setLeaderboardsByLeague(lbMap)

        // Calendar data — the viewer's matches in a ±30 day window
        // around today, with rosters + scores + embedded league
        // info so the inline MatchDetailCard has what it needs.
        await loadCalendar(userId)

        if (scoresCountRes.error) throw scoresCountRes.error
        setMatchesPlayed(scoresCountRes.count || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [authLoading, user, loadCalendar, loadLeaderboards])

  /**
   * Composite refresh for the calendar section. Inline MatchDetailCard
   * mutations (edit, approve, leave, delete) ripple into leaderboard
   * standings — so refreshing the calendar alone would leave the
   * per-league leaderboards stale until the next mount. We re-pull
   * both here and keep them in sync.
   */
  const handleMatchRefresh = useCallback(async () => {
    if (!user) return
    const leagueIds = myLeagues.map((l) => String(l.id))
    const [, lbMap] = await Promise.all([
      loadCalendar(user.id),
      loadLeaderboards(leagueIds),
    ])
    setLeaderboardsByLeague(lbMap)
  }, [user, myLeagues, loadCalendar, loadLeaderboards])

  // Realtime: mirror the league page so approvals / score edits /
  // new matches arriving from another device (or teammate) refresh
  // the calendar + leaderboards without a manual reload. We watch
  // `scores` and `matches` — match_players is less useful here since
  // the calendar already re-pulls rosters through its own fetch.
  // Debounced through a 400ms timer so a burst of changes collapses
  // into a single refetch.
  useEffect(() => {
    if (!user) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        handleMatchRefresh()
      }, 400)
    }

    const channel = supabase
      .channel(`profile-${user.id}-live`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scores" },
        (payload) => {
          // Only bump if the score belongs to a match we know about.
          // Otherwise cross-league noise would churn the dashboard
          // for players the viewer has no relationship with.
          const matchId =
            (payload.new as { match_id?: string })?.match_id ??
            (payload.old as { match_id?: string })?.match_id
          if (!matchId) return bump()
          if (calendarPlayersMap.has(matchId)) bump()
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches" },
        (payload) => {
          // Only bump for matches in leagues the viewer belongs to.
          // The scoped filter (`league_id=in.(…)`) isn't supported on
          // postgres_changes server-side, so we gate in JS against
          // `calendarLeaguesById`.
          const leagueId =
            (payload.new as { league_id?: string })?.league_id ??
            (payload.old as { league_id?: string })?.league_id
          if (!leagueId) return
          if (calendarLeaguesById.has(String(leagueId))) bump()
        },
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
    // calendarPlayersMap + calendarLeaguesById are read in closures
    // for gating but intentionally omitted from deps — resubscribing
    // on every map change would churn the realtime connection. The
    // snapshot closure is good enough; newly-relevant matches will
    // be picked up on the next handleMatchRefresh cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, handleMatchRefresh])

  const handleLogout = async () => {
    setLogoutLoading(true)
    try {
      await supabase.auth.signOut()
      router.push("/login")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to log out.")
    } finally {
      setLogoutLoading(false)
    }
  }

  const startEditing = () => {
    setEditUsername(profile?.username || "")
    setEditFirstName(profile?.first_name || (user?.user_metadata?.first_name as string) || "")
    setEditLastName(profile?.last_name || (user?.user_metadata?.last_name as string) || "")
    setEditTown(profile?.town || "")
    setEditHandicap(profile?.handicap != null ? String(profile.handicap) : "")
    setEditing(true)
  }

  const handleSaveProfile = async () => {
    if (!user) return
    setSaving(true)
    setError(null)
    try {
      const username = editUsername.trim()
      const firstName = editFirstName.trim()
      const lastName = editLastName.trim()
      const town = editTown.trim()
      const handicapNum = editHandicap.trim() ? parseInt(editHandicap.trim(), 10) : null

      if (!username) {
        setError("Username is required.")
        setSaving(false)
        return
      }

      if (username.length < 3) {
        setError("Username must be at least 3 characters.")
        setSaving(false)
        return
      }

      if (!/^[a-zA-Z0-9]+$/.test(username)) {
        setError("Username can only contain letters and numbers.")
        setSaving(false)
        return
      }

      if (
        handicapNum != null &&
        (Number.isNaN(handicapNum) || handicapNum < 0 || handicapNum > 54)
      ) {
        setError("Handicap must be an integer between 0 and 54.")
        setSaving(false)
        return
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          username,
          first_name: firstName || null,
          last_name: lastName || null,
          town: town || null,
          handicap: handicapNum,
        })
        .eq("id", user.id)

      if (updateError) {
        if (updateError.message?.includes("profiles_username_unique") || updateError.code === "23505") {
          throw new Error("This username is already taken. Please choose another.")
        }
        throw new Error(updateError.message || "Database update failed.")
      }

      const { data: refreshed } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle()
      setProfile((refreshed || null) as Profile | null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile.")
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const file = e.target.files[0]

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.")
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10 MB.")
      return
    }

    setError(null)
    setCropFile(file)
    // Reset the input so the same file can be re-selected
    e.target.value = ""
  }

  const handleCroppedUpload = async (blob: Blob) => {
    setCropFile(null)
    if (!user) return

    setUploadingAvatar(true)
    setError(null)
    try {
      const filePath = `${user.id}/avatar.jpg`

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, blob, { upsert: true, contentType: "image/jpeg" })

      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath)

      const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("id", user.id)

      if (updateError) throw updateError

      setProfile((prev) => prev ? { ...prev, avatar_url: avatarUrl } : prev)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload avatar.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  if (authLoading) return <LoadingSpinner message="Checking your session..." />
  if (!user) return null
  if (loading) return <LoadingSpinner message="Loading profile..." />

  const displayName =
    profile?.username ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    (user.user_metadata?.full_name as string) ||
    [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" ") ||
    user.email ||
    "Player"

  return (
    <main className="min-h-screen px-4 pb-6 pt-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {error && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* 1. Profile */}
        <section className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          {editing ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Edit Profile</p>
              </div>
              <div>
                <label htmlFor="edit-username" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Username</label>
                <input id="edit-username" type="text" value={editUsername} onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9]/g, ""))} disabled={saving}
                  className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="e.g. BenGolf" maxLength={30} />
                <p className="mt-1 text-[10px] text-primary/40">Letters and numbers only</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="edit-first" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">First Name</label>
                  <input id="edit-first" type="text" value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} disabled={saving}
                    className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="First name" />
                </div>
                <div>
                  <label htmlFor="edit-last" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Last Name</label>
                  <input id="edit-last" type="text" value={editLastName} onChange={(e) => setEditLastName(e.target.value)} disabled={saving}
                    className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="Last name" />
                </div>
              </div>
              <div>
                <label htmlFor="edit-town" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Town</label>
                <input id="edit-town" type="text" value={editTown} onChange={(e) => setEditTown(e.target.value)} disabled={saving}
                  className="w-full rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="e.g. Paris" />
              </div>
              <div>
                <label htmlFor="edit-handicap" className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Handicap</label>
                <input id="edit-handicap" type="number" step="1" min="0" max="54" value={editHandicap} onChange={(e) => setEditHandicap(e.target.value)} disabled={saving}
                  className="w-32 rounded-lg border border-primary/20 bg-cream px-3 py-2 text-sm text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary" placeholder="e.g. 12" />
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleSaveProfile} disabled={saving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream hover:bg-primary/90 disabled:opacity-60">
                  {saving ? "Saving\u2026" : "Save"}
                </button>
                <button type="button" onClick={() => { setEditing(false); setError(null) }} disabled={saving}
                  className="rounded-lg border border-primary/20 bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Identity row: avatar + username (vertically centered) + Edit */}
              <div className="flex items-center gap-3">
                <label className="group relative cursor-pointer shrink-0" htmlFor="avatar-upload">
                  {profile?.avatar_url ? (
                    <Image
                      src={profile.avatar_url}
                      alt={displayName}
                      width={48}
                      height={48}
                      className="h-12 w-12 rounded-full object-cover"
                      unoptimized={!profile.avatar_url.includes("supabase.co")}
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-semibold text-cream">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                  {uploadingAvatar && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    </div>
                  )}
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarSelect}
                    disabled={uploadingAvatar}
                  />
                </label>
                <h1 className="min-w-0 flex-1 truncate text-2xl font-bold text-primary">
                  {displayName}
                </h1>
                <button
                  type="button"
                  onClick={startEditing}
                  className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  Edit
                </button>
              </div>

              {/* Stats row — full-width under the identity row */}
              <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-primary/60">
                <span className="inline-flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  {profile?.town || "No town"}
                </span>
                <span className="text-primary/30">·</span>
                <span>
                  HCP <strong className="text-primary/80 tabular-nums">{profile?.handicap != null ? profile.handicap : "\u2013"}</strong>
                </span>
                <span className="text-primary/30">·</span>
                <span className="tabular-nums">
                  {matchesPlayed}{" "}
                  {matchesPlayed === 1 ? "match" : "matches"}
                </span>
                <span className="text-primary/30">·</span>
                <span className="tabular-nums">
                  {memberships.length}{" "}
                  {memberships.length === 1 ? "league" : "leagues"}
                </span>
              </div>
            </>
          )}
        </section>

        {/* 2. Score trajectory — sparkline + trend arrow */}
        <ScoreTrendCard handicap={profile?.handicap ?? null} />

        {/* 3. My calendar — horizontal day strip + inline MatchDetailCard
            for the selected day. Shared with league page via
            `MatchCalendarSection`. Full list still one tap away via
            the "My calendar →" link in the section header. */}
        {user && (
          <MatchCalendarSection
            matches={calendarMatches}
            matchPlayersMap={calendarPlayersMap}
            currentUserId={user.id}
            resolveLeague={(m) =>
              calendarLeaguesById.get(String(m.league_id)) ?? null
            }
            onRefresh={handleMatchRefresh}
          />
        )}

        {/* 3. Records — best round, top rival, longest streak */}
        <RecordsCard records={records} />

        {/* 3b. Your honors — cross-league trophy shelf. Renders its
            own empty state, so we always include it; loading flag is
            driven by the null sentinel while the RPC is in flight. */}
        <MyHonorsCard honors={honors ?? []} loading={honors === null} />

        {/* Activity feed retired here — each league page now owns
            its own scoped feed (see LeagueActivityCard). */}

        {/* Courses played card retired from /profile — the roll-up
            still lives on /players/[id] for visiting other players. */}

        {/* My Leagues — per-league leaderboard with a switcher. Each
            league the viewer belongs to renders its live leaderboard
            (same component as the league page) so /profile is a
            single-screen snapshot of where they stand across every
            league they're in. */}
        <MyLeaguesLeaderboards
          leagues={myLeagues}
          leaderboards={leaderboardsByLeague}
          currentUserId={user.id}
        />

        {/* Notification prefs moved out of the profile — the bell icon
            and the /notifications page are the canonical surfaces now. */}

        {/* Log Out */}
        <div className="flex justify-center py-2">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            disabled={logoutLoading}
            className="text-xs text-red-400 underline-offset-4 hover:text-red-600 hover:underline disabled:opacity-60"
          >
            {logoutLoading ? "Logging out\u2026" : "Log Out"}
          </button>
        </div>

        <ConfirmModal
          open={showLogoutConfirm}
          title="Log out?"
          message="Are you sure you want to log out of your account?"
          confirmLabel="Log Out"
          loading={logoutLoading}
          destructive
          onConfirm={handleLogout}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      </div>

      {/* Avatar crop modal */}
      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCrop={handleCroppedUpload}
          onCancel={() => setCropFile(null)}
        />
      )}
    </main>
  )
}

/* ── My Leagues leaderboards ──────────────────────────────────
 *
 * Replaces the old metadata carousel (format / cards / duration /
 * member row). The viewer already knows the meta for leagues they're
 * in — the useful snapshot on /profile is "where do I stand?", which
 * is exactly what LeaderboardTable shows on the league page itself.
 *
 * Layout: a small switcher header (league name + course + prev/next
 * + dots) above the shared LeaderboardTable card. Tapping the name
 * navigates to the full league page. We intentionally don't wrap
 * this whole section in another card so we're not stacking a card
 * inside a card — the table's own wrapper supplies the chrome.
 */

function MyLeaguesLeaderboards({
  leagues,
  leaderboards,
  currentUserId,
}: {
  leagues: LeagueData[]
  leaderboards: Map<string, LeaderboardRow[]>
  currentUserId: string
}) {
  const [idx, setIdx] = useState(0)

  if (leagues.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-primary">My Leagues</h2>
        <p className="mb-3 text-sm text-primary/70">No leagues joined yet.</p>
        <div className="flex gap-2">
          <Link href="/leagues/create" className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-cream hover:bg-primary/90">Create League</Link>
          <Link href="/leagues/join" className="rounded-lg border border-primary/20 bg-cream px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5">Join League</Link>
        </div>
      </section>
    )
  }

  // Clamp when membership count shrinks (e.g. after Leave) so the
  // carousel never points past the end.
  const safeIdx = Math.min(idx, leagues.length - 1)
  const league = leagues[safeIdx]
  const rows = leaderboards.get(String(league.id)) ?? []
  const format = resolveFormat({ format: league.format ?? null })

  return (
    <section className="flex flex-col gap-3">
      {/* Switcher header — league name + course, with prev/next
          controls and dot indicators when the viewer is in multiple
          leagues. Name + course is a Link so tap = jump to league. */}
      <div className="flex items-center justify-between gap-2">
        {leagues.length > 1 ? (
          <button
            type="button"
            onClick={() =>
              setIdx((i) => (i - 1 + leagues.length) % leagues.length)
            }
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
            aria-label="Previous league"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        ) : (
          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
        )}
        <Link
          href={`/leagues/${league.id}`}
          className="min-w-0 flex-1 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
        >
          <h2 className="truncate text-lg font-bold text-primary">{league.name}</h2>
          <p className="truncate text-xs uppercase tracking-[0.2em] text-primary/50">
            {league.course_name || "Course TBA"}
          </p>
        </Link>
        {leagues.length > 1 ? (
          <button
            type="button"
            onClick={() => setIdx((i) => (i + 1) % leagues.length)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
            aria-label="Next league"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        ) : (
          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
        )}
      </div>

      {leagues.length > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {leagues.map((l, i) => (
            <button
              key={l.id}
              type="button"
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${i === safeIdx ? "w-5 bg-primary" : "w-1.5 bg-primary/20 hover:bg-primary/40"}`}
              aria-label={`View ${l.name}`}
            />
          ))}
        </div>
      )}

      <LeaderboardTable
        leaderboard={rows}
        currentUserId={currentUserId}
        scoringCardsCount={league.scoring_cards_count ?? null}
        leagueFormat={format}
      />
    </section>
  )
}
