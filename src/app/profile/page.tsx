"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/hooks/useAuth"
import { fetchMatchPlayers, type MatchPlayerInfo } from "@/lib/matchPlayers"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import { Avatar } from "@/components/Avatar"
import AvatarCropModal from "@/components/AvatarCropModal"
import { PushNotificationToggle } from "@/components/PushNotificationToggle"

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

export default function ProfilePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<LeagueMember[]>([])
  const [enrichedLeagues, setEnrichedLeagues] = useState<EnrichedLeague[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<ScheduledMatch[]>([])
  const [matchPlayersMap, setMatchPlayersMap] = useState<Map<string | number, MatchPlayerInfo[]>>(new Map())
  const [matchesPlayed, setMatchesPlayed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoutLoading, setLogoutLoading] = useState(false)

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
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/60">Profile</p>
                      <h1 className="mt-1 text-2xl font-bold text-primary">{displayName}</h1>
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

        {/* 2. Scheduled Matches — Carousel */}
        <MatchCarousel
          matches={scheduledMatches}
          matchPlayersMap={matchPlayersMap}
        />

        {/* 3. My Leagues — Carousel */}
        <LeagueCarousel leagues={enrichedLeagues} />

        {/* Settings */}
        <section className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary/60">Settings</h2>
          <PushNotificationToggle />
        </section>

        {/* Log Out */}
        <section>
          <button
            type="button"
            onClick={handleLogout}
            disabled={logoutLoading}
            className="w-full rounded-lg border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {logoutLoading ? "Logging out\u2026" : "Log Out"}
          </button>
        </section>
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

/* ── Match Carousel ──────────────────────────────────────────── */

function MatchCarousel({
  matches,
  matchPlayersMap,
}: {
  matches: ScheduledMatch[]
  matchPlayersMap: Map<string | number, MatchPlayerInfo[]>
}) {
  const [idx, setIdx] = useState(0)

  if (matches.length === 0) {
    return (
      <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary">Scheduled Matches</h2>
          <Link href="/matches/create" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-cream hover:bg-primary/90">Create Match</Link>
        </div>
        <p className="text-center text-sm text-primary/70">No matches scheduled yet. Create one to get the week rolling.</p>
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
    <section className="rounded-xl border border-primary/15 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">Scheduled Matches</h2>
        <Link href="/matches/create" className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-cream hover:bg-primary/90">Create Match</Link>
      </div>

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
        <Link href={`/matches/${m.id}`} className="block min-w-0 flex-1 rounded-lg bg-cream px-4 py-4 text-center text-primary hover:bg-primary/5">
          <div className="flex flex-wrap items-center justify-center gap-x-2.5">
            {players && players.length > 0 ? (
              players.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  {i > 0 && <span className="text-xs font-normal text-primary/40">&amp;</span>}
                  <Avatar src={p.avatar_url} size={32} fallback={p.name} />
                  <span className="text-base font-semibold">{p.name}</span>
                </span>
              ))
            ) : (
              <span className="text-base font-semibold">
                {m.course_name || "Course TBA"}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-xs text-primary/60">
            {dateLabel}
            {m.match_time ? ` · ${m.match_time.slice(0, 5)}` : ""}
            {m.course_name ? ` · ${m.course_name}` : ""}
          </p>
        </Link>

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

  const router = useRouter()

  return (
    <section
      className="cursor-pointer rounded-2xl border border-primary/15 bg-white shadow-sm transition-colors hover:bg-cream/30"
      onClick={() => router.push(`/leagues/${league.id}`)}
    >
      {/* League switcher header */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
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
      <div className="mt-3 px-5">
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
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 px-5">
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
              {league.activePeriod
                ? `${formatDateShort(league.activePeriod.start_date)} – ${formatDateShort(league.activePeriod.end_date)}`
                : "No season set"}
            </p>
          </div>
        </div>
      </div>

      {/* Players preview */}
      <div className="flex flex-col items-center gap-2 px-5 py-4">
        <div className="flex -space-x-2">
          {league.members.slice(0, 5).map((m, i) => (
            <div
              key={m.user_id}
              className="relative rounded-full ring-2 ring-white"
              style={{ zIndex: 5 - i }}
            >
              <Avatar
                src={m.profiles?.avatar_url}
                size={28}
                fallback={m.profiles?.username || m.profiles?.first_name || "P"}
              />
            </div>
          ))}
          {league.memberCount > 5 && (
            <div
              className="relative flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary/60 ring-2 ring-white"
              style={{ zIndex: 0 }}
            >
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
