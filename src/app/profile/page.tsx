"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import type { User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"
import { fetchMatchPlayerNames } from "@/lib/matchPlayers"
import { LoadingSpinner } from "@/components/LoadingSpinner"
import AvatarCropModal from "@/components/AvatarCropModal"

type Profile = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  town?: string | null
  handicap?: number | null
  avatar_url?: string | null
}

type LeagueMember = {
  id: string
  league_id: string
  leagues?: {
    id: string
    name: string
    status?: string | null
  } | null
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

  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<LeagueMember[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<ScheduledMatch[]>([])
  const [matchPlayerNames, setMatchPlayerNames] = useState<Map<string | number, string[]>>(new Map())
  const [matchesPlayed, setMatchesPlayed] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoutLoading, setLogoutLoading] = useState(false)

  // Profile editing
  const [editing, setEditing] = useState(false)
  const [editFirstName, setEditFirstName] = useState("")
  const [editLastName, setEditLastName] = useState("")
  const [editTown, setEditTown] = useState("")
  const [editHandicap, setEditHandicap] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession()
      const session = data.session

      if (!session) {
        router.push("/login")
        return
      }

      setUser(session.user)
      setAuthLoading(false)

      try {
        setLoading(true)
        setError(null)

        const userId = session.user.id
        const todayIso = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

        // Pull memberships, scheduled matches, and count of played matches in parallel
        const [profileRes, membershipsRes, playerMatchesRes, scoresCountRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase
            .from("league_members")
            .select("id, league_id, leagues(id, name, status)")
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
        setMemberships((membershipsRes.data as unknown as LeagueMember[]) || [])

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

        // Fetch player names for scheduled matches
        if (upcoming.length > 0) {
          const matchIds = upcoming.map((m) => m.id)
          const playerNames = await fetchMatchPlayerNames(supabase, matchIds)
          setMatchPlayerNames(playerNames)
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
  }, [router])

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
      const firstName = editFirstName.trim()
      const lastName = editLastName.trim()
      const town = editTown.trim()
      const handicapNum = editHandicap.trim() ? parseInt(editHandicap.trim(), 10) : null

      if (!firstName) {
        setError("First name is required.")
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
          first_name: firstName,
          last_name: lastName || null,
          town: town || null,
          handicap: handicapNum,
        })
        .eq("id", user.id)

      if (updateError) throw new Error(updateError.message || "Database update failed.")

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
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    (user.user_metadata?.full_name as string) ||
    [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" ") ||
    user.email ||
    "Player"

  return (
    <main className="min-h-screen bg-cream px-4 pb-24 pt-4 md:pb-8">
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
                    <img
                      src={profile.avatar_url}
                      alt={displayName}
                      className="h-12 w-12 rounded-full object-cover"
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

        {/* 2. Scheduled Matches */}
        <section className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/60">Scheduled Matches</h2>
              <p className="mt-1 text-sm text-primary/70">Your upcoming rounds.</p>
            </div>
            <Link href="/matches/create" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              New match
            </Link>
          </div>
          <div className="space-y-3">
            {scheduledMatches.length === 0 ? (
              <p className="text-sm text-primary/70">No matches scheduled. Create one to get started.</p>
            ) : (
              scheduledMatches.map((m) => {
                const leagueName = m.leagues?.name || (m.match_type === "casual" ? "Casual" : "Match")
                const courseName = m.course_name || null
                const names = matchPlayerNames.get(m.id)
                const playersLabel = names && names.length > 0 ? names.join(" vs ") : null
                const parts = [leagueName, courseName, playersLabel].filter(Boolean)
                return (
                  <Link
                    key={m.id}
                    href={`/matches/${m.id}`}
                    className="block rounded-xl border border-primary/10 bg-cream px-4 py-3 hover:bg-primary/5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-primary">
                          {parts.join(" · ")}
                        </p>
                        <p className="text-xs text-primary/60">
                          {formatDate(m.match_date)}
                          {m.match_time ? ` · ${m.match_time.slice(0, 5)}` : ""}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                          m.match_type === "casual"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {m.match_type === "casual" ? "Casual" : "League"}
                      </span>
                    </div>
                  </Link>
                )
              })
            )}
          </div>
        </section>

        {/* 3. My Leagues */}
        <section className="rounded-2xl border border-primary/15 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-primary/60">My Leagues</h2>
              <p className="mt-1 text-sm text-primary/70">Where you are currently competing.</p>
            </div>
            <Link href="/leagues/list" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              See all
            </Link>
          </div>
          <div className="space-y-3">
            {memberships.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-primary/70">No leagues joined yet.</p>
                <div className="flex gap-2">
                  <Link href="/leagues/create" className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-cream hover:bg-primary/90">
                    Create League
                  </Link>
                  <Link href="/leagues/join" className="rounded-lg border border-primary/20 bg-cream px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5">
                    Join League
                  </Link>
                </div>
              </div>
            ) : (
              memberships.map((membership) => {
                const league = membership.leagues
                if (!league) return null
                return (
                  <Link
                    key={membership.id}
                    href={`/leagues/${league.id}`}
                    className="block rounded-xl border border-primary/10 bg-cream px-4 py-3 hover:bg-primary/5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-primary">{league.name}</p>
                      <span className="text-xs uppercase tracking-wide text-primary/50">{league.status || "active"}</span>
                    </div>
                  </Link>
                )
              })
            )}
          </div>
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

function formatDate(iso: string | null): string {
  if (!iso) return "Date TBA"
  const d = new Date(iso + "T00:00:00")
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}
