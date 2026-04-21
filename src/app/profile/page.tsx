"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { fetchMatchPlayers, fetchMatchPlayersWithScores, type MatchPlayerInfo, type MatchPlayerWithScore } from "@/lib/matchPlayers"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { Avatar } from "@/components/Avatar"
import AvatarCropModal from "@/components/AvatarCropModal"
import { PushNotificationToggle } from "@/components/PushNotificationToggle"
import { NotificationPreferences } from "@/components/NotificationPreferences"
import { ConfirmModal } from "@/components/ConfirmModal"
import { RecordsCard, type RecordsData } from "@/components/profile/RecordsCard"
import { WeekCalendarCard, type WeekStatsData } from "@/components/profile/WeekCalendarCard"
import { CoursesCard, type CoursePlay } from "@/components/profile/CoursesCard"

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
}

type LeagueMemberProfile = {
  user_id: string
  profiles?: {
    id: string
    first_name?: string | null
    last_name?: string | null
    username?: string | null
    avatar_url?: string | null
  } | null
}

type PeriodData = {
  id: string | number
  league_id: string | number
  name?: string | null
  start_date?: string | null
  end_date?: string | null
  status?: string | null
}

type EnrichedLeague = LeagueData & {
  members: LeagueMemberProfile[]
  memberCount: number
  activePeriod?: PeriodData | null
}

type ScheduledMatch = {
  id: string
  match_date: string | null
  match_time: string | null
  course_name: string | null
  match_type: string
  league_id: string | null
  leagues?: { name: string } | null
}

type PastMatch = {
  round_date: string
  course_name: string | null
  score: number
  holes: number
  match_type: string | null
  league_name: string | null
  match_id: string
  score_status: string | null
}

type ActivityEvent = {
  id: string
  event_type: string
  league_id: string | null
  actor_id: string
  match_id: string | null
  metadata: Record<string, string | number | null>
  created_at: string
  actor_name: string
  actor_avatar_url: string | null
}

export default function ProfilePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<LeagueMember[]>([])
  const [enrichedLeagues, setEnrichedLeagues] = useState<EnrichedLeague[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<ScheduledMatch[]>([])
  const [pastMatches, setPastMatches] = useState<PastMatch[]>([])
  const [matchPlayersMap, setMatchPlayersMap] = useState<Map<string | number, MatchPlayerInfo[]>>(new Map())
  const [pastMatchPlayersMap, setPastMatchPlayersMap] = useState<Map<string | number, MatchPlayerWithScore[]>>(new Map())
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([])
  const [matchesPlayed, setMatchesPlayed] = useState(0)
  const [records, setRecords] = useState<RecordsData | null>(null)
  const [weekStats, setWeekStats] = useState<WeekStatsData | null>(null)
  const [courses, setCourses] = useState<CoursePlay[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoutLoading, setLogoutLoading] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

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
        const todayIso = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

        // Pull memberships, scheduled matches, and count of played matches in parallel
        const [profileRes, membershipsRes, playerMatchesRes, scoresCountRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase
            .from("league_members")
            .select("id, league_id, leagues(*)")
            .eq("user_id", userId),
          // match_players joined with matches, filtered to future scheduled matches
          supabase
            .from("match_players")
            .select(
              "match_id, matches!inner(id, match_date, match_time, course_name, match_type, league_id, status, leagues(name))",
            )
            .eq("user_id", userId)
            .gte("matches.match_date", todayIso)
            .neq("matches.status", "completed"),
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

        // Build enriched leagues for the carousel
        const leagueMap = new Map<string, LeagueData>()
        for (const m of membershipData) {
          const l = m.leagues as LeagueData | null
          if (l && !leagueMap.has(String(l.id))) {
            leagueMap.set(String(l.id), l)
          }
        }
        const leagueList = Array.from(leagueMap.values())

        if (leagueList.length > 0) {
          const leagueIds = leagueList.map((l) => l.id)
          const [leagueMembersRes, periodsRes] = await Promise.all([
            supabase
              .from("league_members")
              .select("league_id, user_id, profiles(id, first_name, last_name, username, avatar_url)")
              .in("league_id", leagueIds),
            supabase
              .from("league_periods")
              .select("*")
              .in("league_id", leagueIds)
              .order("start_date", { ascending: true }),
          ])

          const membersByLeague: Record<string, LeagueMemberProfile[]> = {}
          for (const m of leagueMembersRes.data || []) {
            const key = String(m.league_id)
            if (!membersByLeague[key]) membersByLeague[key] = []
            membersByLeague[key].push(m as unknown as LeagueMemberProfile)
          }

          const periodByLeague: Record<string, PeriodData> = {}
          for (const p of (periodsRes.data || []) as PeriodData[]) {
            const key = String(p.league_id)
            if (!periodByLeague[key] || p.status === "active") {
              periodByLeague[key] = p
            }
          }

          const enriched: EnrichedLeague[] = leagueList.map((l) => {
            const key = String(l.id)
            const members = membersByLeague[key] || []
            return {
              ...l,
              members,
              memberCount: members.length,
              activePeriod: periodByLeague[key] || null,
            }
          })
          setEnrichedLeagues(enriched)
        }

        if (playerMatchesRes.error) throw playerMatchesRes.error
        type PlayerMatchRow = {
          match_id: string
          matches:
            | {
                id: string
                match_date: string | null
                match_time: string | null
                course_name: string | null
                match_type: string
                league_id: string | null
                status: string | null
                leagues: { name: string } | null
              }
            | null
        }
        const rows = (playerMatchesRes.data as unknown as PlayerMatchRow[]) || []
        const upcoming: ScheduledMatch[] = rows
          .filter((r) => r.matches != null)
          .map((r) => ({
            id: r.matches!.id,
            match_date: r.matches!.match_date,
            match_time: r.matches!.match_time,
            course_name: r.matches!.course_name,
            match_type: r.matches!.match_type,
            league_id: r.matches!.league_id,
            leagues: r.matches!.leagues,
          }))
          .sort((a, b) => (a.match_date || "").localeCompare(b.match_date || ""))
        setScheduledMatches(upcoming)

        // Fetch player info (names + avatars) for scheduled matches
        if (upcoming.length > 0) {
          const matchIds = upcoming.map((m) => m.id)
          const players = await fetchMatchPlayers(supabase, matchIds)
          setMatchPlayersMap(players)
        }

        // Fetch past matches (completed rounds)
        const { data: pastData } = await supabase.rpc("get_player_round_history", {
          p_user_id: userId,
        })
        if (pastData) {
          const approved = (pastData as PastMatch[]).filter((r) => r.score_status === "approved")
          setPastMatches(approved)

          // Fetch player info + scores for past matches
          if (approved.length > 0) {
            const pastIds = approved.map((r) => r.match_id)
            const pastPlayers = await fetchMatchPlayersWithScores(supabase, pastIds)
            setPastMatchPlayersMap(pastPlayers)
          }
        }

        // Fetch activity feed. Pull 30 so that after filtering out the
        // viewer's own actions we still have a healthy carousel. (On your
        // own profile we only show what OTHERS are doing in your leagues.)
        const { data: activityData } = await supabase.rpc("get_activity_feed", {
          p_user_id: userId,
          p_limit: 30,
        })
        if (activityData) {
          // Map out_ prefixed columns from RPC to clean names, and hide
          // activity events authored by the current user.
          const mapped = (activityData as Array<Record<string, unknown>>)
            .map((r) => ({
              id: r.out_id as string,
              event_type: r.out_event_type as string,
              league_id: (r.out_league_id as string) || null,
              actor_id: r.out_actor_id as string,
              match_id: (r.out_match_id as string) || null,
              metadata: (r.out_metadata as Record<string, string | number | null>) || {},
              created_at: r.out_created_at as string,
              actor_name: r.out_actor_name as string,
              actor_avatar_url: (r.out_actor_avatar_url as string) || null,
            }))
            .filter((ev) => ev.actor_id !== userId)
            .slice(0, 20)
          setActivityFeed(mapped)
        }

        // Fetch dashboard stats in parallel: records, week, courses
        const [recordsRes, weekRes, coursesRes] = await Promise.all([
          supabase.rpc("get_profile_records", { p_user_id: userId }),
          supabase.rpc("get_profile_week", { p_user_id: userId }),
          supabase.rpc("get_profile_courses", { p_user_id: userId }),
        ])
        if (!recordsRes.error && recordsRes.data) {
          setRecords(recordsRes.data as RecordsData)
        }
        if (!weekRes.error && weekRes.data) {
          setWeekStats(weekRes.data as WeekStatsData)
        }
        if (!coursesRes.error && coursesRes.data) {
          setCourses(coursesRes.data as CoursePlay[])
        }

        if (scoresCountRes.error) throw scoresCountRes.error
        setMatchesPlayed(scoresCountRes.count || 0)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile.")
      } finally {
        setLoading(false)
      }
    }

    init()
  }, [authLoading, user])

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
    <main className="min-h-screen bg-cream px-4 pb-6 pt-4">
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
              <div className="flex items-center gap-4">
                <label className="group relative cursor-pointer" htmlFor="avatar-upload">
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
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h1 className="text-2xl font-bold text-primary">{displayName}</h1>
                      {profile?.username && profile?.first_name && (
                        <p className="text-sm text-primary/60">{[profile.first_name, profile.last_name].filter(Boolean).join(" ")}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={startEditing}
                      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-primary/10 pt-4 sm:grid-cols-4">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-primary/50">Town</dt>
                  <dd className="mt-1 truncate text-sm font-semibold text-primary">
                    {profile?.town || "\u2013"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-primary/50">Handicap</dt>
                  <dd className="mt-1 text-sm font-semibold text-primary">
                    {profile?.handicap != null ? profile.handicap : "\u2013"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-primary/50">Matches Played</dt>
                  <dd className="mt-1 text-sm font-semibold text-primary">{matchesPlayed}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-primary/50">Leagues</dt>
                  <dd className="mt-1 text-sm font-semibold text-primary">{memberships.length}</dd>
                </div>
              </dl>
            </>
          )}
        </section>

        {/* 2. This week — streak + 7-day calendar + next match CTA */}
        <WeekCalendarCard week={weekStats} />

        {/* 3. Records — best round, top rival, longest streak */}
        <RecordsCard records={records} />

        {/* 4. Activity Feed — Carousel */}
        <ActivityFeedCarousel events={activityFeed} />

        {/* 5. Scheduled Matches — Carousel */}
        <MatchCarousel
          matches={scheduledMatches}
          matchPlayersMap={matchPlayersMap}
        />

        {/* 6. Past Matches — Carousel */}
        <PastMatchCarousel
          matches={pastMatches}
          matchPlayersMap={pastMatchPlayersMap}
        />

        {/* 7. Courses played — collection */}
        <CoursesCard courses={courses} />

        {/* 8. My Leagues — Carousel */}
        <LeagueCarousel leagues={enrichedLeagues} />

        {/* 6. Notifications — master toggle + per-type preferences (collapsed) */}
        <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-primary">Notifications</h2>
          <PushNotificationToggle />
          <details className="group mt-4 border-t border-primary/10 pt-4">
            <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs font-medium uppercase tracking-wide text-primary/50 hover:text-primary/80">
              <span>Per-type preferences</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform duration-200 group-open:rotate-180"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>
            <div className="mt-2">
              <NotificationPreferences />
            </div>
          </details>
        </section>

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

/* ── Activity Feed Carousel ─────────────────────────────────── */

function activityIcon(eventType: string) {
  switch (eventType) {
    case "player_joined_league":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" />
          </svg>
        </div>
      )
    case "match_created":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
      )
    case "score_approved":
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )
    default:
      return (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/5">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </div>
      )
  }
}

function activityMessage(event: ActivityEvent): { primary: string; secondary: string } {
  const meta = event.metadata || {}
  const name = event.actor_name || "Someone"

  switch (event.event_type) {
    case "player_joined_league":
      return {
        primary: `${name} joined`,
        secondary: String(meta.league_name || "a league"),
      }
    case "match_created":
      return {
        primary: `${name} created a match`,
        secondary: [meta.league_name, meta.course_name, meta.match_date ? formatDateShort(String(meta.match_date)) : null]
          .filter(Boolean)
          .join(" · "),
      }
    case "score_approved":
      return {
        primary: `${name} scored ${meta.score ?? "—"}`,
        secondary: [meta.league_name, meta.course_name]
          .filter(Boolean)
          .join(" · "),
      }
    default:
      return { primary: name, secondary: event.event_type }
  }
}

function timeAgo(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diffSec = Math.floor((now - then) / 1000)
  if (diffSec < 60) return "just now"
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function ActivityFeedCarousel({ events }: { events: ActivityEvent[] }) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()

  if (events.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-center text-sm font-semibold text-primary">Activity</h2>
        <p className="text-center text-sm text-primary/70">No recent activity in your leagues.</p>
      </section>
    )
  }

  const event = events[idx]
  const msg = activityMessage(event)
  const hasPrev = idx > 0
  const hasNext = idx < events.length - 1

  const handleCardClick = () => {
    if (event.event_type === "match_created" || event.event_type === "score_approved") {
      if (event.match_id) router.push(`/matches/${event.match_id}`)
    } else if (event.event_type === "player_joined_league") {
      if (event.actor_id) router.push(`/players/${event.actor_id}`)
    }
  }

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-center text-sm font-semibold text-primary">Activity</h2>

      <div className="flex items-center gap-2">
        {/* Left arrow */}
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={!hasPrev}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasPrev ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        {/* Card */}
        <div
          onClick={handleCardClick}
          className="min-w-0 flex-1 cursor-pointer rounded-lg bg-white px-4 py-4 text-center text-primary"
        >
          <div className="flex items-center justify-center gap-3">
            {activityIcon(event.event_type)}
            <Avatar src={event.actor_avatar_url} size={32} fallback={event.actor_name} />
          </div>
          <p className="mt-2 text-base font-semibold">{msg.primary}</p>
          {msg.secondary && (
            <p className="mt-0.5 text-xs text-primary/60">{msg.secondary}</p>
          )}
          <p className="mt-1 text-[10px] text-primary/40">{timeAgo(event.created_at)}</p>
        </div>

        {/* Right arrow */}
        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={!hasNext}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasNext ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </section>
  )
}

/* ── Match Carousel ──────────────────────────────────────────── */

function MatchCarousel({
  matches,
  matchPlayersMap,
}: {
  matches: ScheduledMatch[]
  matchPlayersMap: Map<string | number, MatchPlayerInfo[]>
}) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()

  if (matches.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
        <h2 className="mb-2 text-center text-sm font-semibold text-primary">Scheduled Matches</h2>
        <p className="text-center text-xs text-primary/70">No matches scheduled yet.</p>
      </section>
    )
  }

  const m = matches[idx]
  const players = matchPlayersMap.get(m.id)
  const hasPrev = idx > 0
  const hasNext = idx < matches.length - 1

  const dateLabel = m.match_date
    ? new Date(m.match_date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "Date TBA"

  return (
    <section className="rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
      <h2 className="mb-2 text-center text-sm font-semibold text-primary">Scheduled Matches</h2>

      <div className="flex items-center gap-1">
        {/* Left arrow */}
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={!hasPrev}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasPrev ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        {/* Card */}
        <div
          onClick={() => router.push(`/matches/${m.id}`)}
          className="min-w-0 flex-1 cursor-pointer rounded-lg bg-white px-3 py-2 text-center text-primary"
        >
          {players && players.length > 0 ? (
            <div className="flex items-center justify-center gap-3">
              {players.map((p, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-0.5"
                  onClick={(e) => {
                    if (p.user_id) {
                      e.stopPropagation()
                      router.push(`/players/${p.user_id}`)
                    }
                  }}
                >
                  <Avatar src={p.avatar_url} size={28} fallback={p.name} />
                  <span className={`text-[11px] font-semibold ${p.user_id ? "cursor-pointer hover:underline" : ""}`}>{p.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-semibold">
              {m.course_name || "Course TBA"}
            </p>
          )}
          <p className="mt-1 text-[11px] text-primary/60">
            {m.leagues?.name || "Match"}
            {m.course_name ? ` · ${m.course_name}` : ""}
            {` · ${dateLabel}`}
            {m.match_time ? ` · ${m.match_time.slice(0, 5)}` : ""}
          </p>
        </div>

        {/* Right arrow */}
        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={!hasNext}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasNext ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </section>
  )
}

/* ── Past Match Carousel ────────────────────────────────────── */

function PastMatchCarousel({
  matches,
  matchPlayersMap,
}: {
  matches: PastMatch[]
  matchPlayersMap: Map<string | number, MatchPlayerWithScore[]>
}) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()

  if (matches.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
        <h2 className="mb-2 text-center text-sm font-semibold text-primary">Past Matches</h2>
        <p className="text-center text-xs text-primary/70">No completed matches yet.</p>
      </section>
    )
  }

  const m = matches[idx]
  const players = matchPlayersMap.get(m.match_id)
  const hasPrev = idx > 0
  const hasNext = idx < matches.length - 1

  const dateLabel = m.round_date
    ? new Date(m.round_date + "T00:00:00").toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : ""

  // Sort players by score (lowest first, nulls last)
  const sorted = players
    ? [...players].sort((a, b) => {
        if (a.score == null && b.score == null) return 0
        if (a.score == null) return 1
        if (b.score == null) return -1
        return a.score - b.score
      })
    : []

  const bestScore = sorted.length > 0 && sorted[0].score != null ? sorted[0].score : null

  return (
    <section className="rounded-xl border border-primary/15 bg-white px-4 py-3 shadow-sm">
      <h2 className="mb-2 text-center text-sm font-semibold text-primary">Past Matches</h2>

      <div className="flex items-center gap-1">
        {/* Left arrow */}
        <button
          type="button"
          onClick={() => setIdx((i) => i - 1)}
          disabled={!hasPrev}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasPrev ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>

        {/* Card */}
        <div
          onClick={() => router.push(`/matches/${m.match_id}`)}
          className="min-w-0 flex-1 cursor-pointer rounded-lg bg-white px-3 py-2 text-primary"
        >
          {/* Players with individual scores */}
          {sorted.length > 0 ? (
            <div className="flex items-center justify-center gap-3">
              {sorted.map((p, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-0.5"
                  onClick={(e) => {
                    if (p.user_id) {
                      e.stopPropagation()
                      router.push(`/players/${p.user_id}`)
                    }
                  }}
                >
                  <Avatar src={p.avatar_url} size={28} fallback={p.name} />
                  <span className={`text-[11px] font-semibold ${p.user_id ? "cursor-pointer hover:underline" : ""}`}>{p.name}</span>
                  {p.score != null && (
                    <span
                      className={`text-xs font-bold ${
                        p.score === bestScore
                          ? "text-emerald-600"
                          : "text-primary/70"
                      }`}
                    >
                      {p.score}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm font-bold">{m.score}</p>
          )}
          {/* Details */}
          <p className="mt-1 text-center text-[11px] text-primary/60">
            {m.league_name || "Casual"}
            {m.course_name ? ` · ${m.course_name}` : ""}
            {dateLabel ? ` · ${dateLabel}` : ""}
          </p>
        </div>

        {/* Right arrow */}
        <button
          type="button"
          onClick={() => setIdx((i) => i + 1)}
          disabled={!hasNext}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-white text-primary transition-opacity ${
            hasNext ? "hover:bg-primary/5" : "opacity-0 pointer-events-none"
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>
    </section>
  )
}

/* ── League Carousel ─────────────────────────────────────────── */

function formatLeagueType(type?: string | null): string {
  if (!type) return "Standard"
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDateShort(iso?: string | null): string {
  if (!iso) return "TBD"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function LeagueCarousel({ leagues }: { leagues: EnrichedLeague[] }) {
  const [idx, setIdx] = useState(0)
  const router = useRouter()

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

  const league = leagues[idx]

  return (
    <section
      className="cursor-pointer rounded-xl border border-primary/15 bg-white p-5 shadow-sm"
      onClick={() => router.push(`/leagues/${league.id}`)}
    >
      {/* League switcher header */}
      <div className="flex items-center justify-between gap-2">
        {leagues.length > 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + leagues.length) % leagues.length) }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
            aria-label="Previous league">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}
        <div className="min-w-0 flex-1 text-center">
          <h2 className="text-lg font-bold text-primary">{league.name}</h2>
          <p className="text-xs uppercase tracking-[0.2em] text-primary/50">
            {league.course_name || "Course TBA"}
          </p>
        </div>
        {leagues.length > 1 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % leagues.length) }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary/40 transition-colors hover:bg-primary/5 hover:text-primary active:scale-95"
            aria-label="Next league">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        )}
      </div>

      {/* Dot indicators */}
      {leagues.length > 1 && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          {leagues.map((l, i) => (
            <button key={l.id} type="button" onClick={(e) => { e.stopPropagation(); setIdx(i) }}
              className={`h-1.5 rounded-full transition-all ${i === idx ? "w-5 bg-primary" : "w-1.5 bg-primary/20 hover:bg-primary/40"}`}
              aria-label={`View ${l.name}`} />
          ))}
        </div>
      )}

      {/* Status badge */}
      <div className="mt-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          (league.status || "draft") === "active"
            ? "bg-emerald-50 text-emerald-700"
            : (league.status || "draft") === "completed"
            ? "bg-primary/10 text-primary"
            : "bg-amber-50 text-amber-700"
        }`}>
          {league.status || "draft"}
        </span>
      </div>

      {/* Info grid */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {/* Format */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/5">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-primary/40">Format</p>
            <p className="text-xs font-semibold text-primary">{formatLeagueType(league.league_type)}</p>
          </div>
        </div>

        {/* Cards counted */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/5">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-primary/40">Cards</p>
            <p className="text-xs font-semibold text-primary">
              {league.scoring_cards_count != null
                ? `Best ${league.scoring_cards_count}${league.total_cards_count ? ` of ${league.total_cards_count}` : ""}`
                : "All count"}
            </p>
          </div>
        </div>

        {/* Duration */}
        <div className="col-span-2 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/5">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-primary/40">Duration</p>
            <p className="text-xs font-semibold text-primary">
              {league.start_date
                ? `${formatDateShort(league.start_date)} – ${formatDateShort(league.end_date)}`
                : "No season set"}
            </p>
          </div>
        </div>
      </div>

      {/* Players preview */}
      <div className="mt-4 flex flex-col items-center gap-2">
        <div className="flex gap-2">
          {league.members.slice(0, 5).map((m) => (
            <Avatar
              key={m.user_id}
              src={m.profiles?.avatar_url}
              size={28}
              fallback={m.profiles?.username || m.profiles?.first_name || "P"}
            />
          ))}
          {league.memberCount > 5 && (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary/60">
              +{league.memberCount - 5}
            </div>
          )}
        </div>
        <span className="text-xs text-primary/60">
          {league.max_players != null
            ? `${league.memberCount}/${league.max_players} players`
            : `${league.memberCount} player${league.memberCount !== 1 ? "s" : ""}`}
        </span>
      </div>
    </section>
  )
}
