"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Logo } from "@/components/Logo"
import { Avatar } from "@/components/Avatar"
import { NotificationBell } from "@/components/NotificationBell"
import { NotificationReadSync } from "@/components/NotificationReadSync"
import { supabase } from "@/lib/supabase"

const authFreeRoutes = ["/", "/login", "/signup"]

export function Navbar() {
  const pathname = usePathname()
  const [showActions, setShowActions] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    const fetchAvatar = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!sessionData.session) return

      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", sessionData.session.user.id)
        .maybeSingle()

      if (data?.avatar_url) setAvatarUrl(data.avatar_url)
    }

    if (!authFreeRoutes.includes(pathname)) {
      fetchAvatar()
    }
  }, [pathname])

  // Close action menu on route change
  useEffect(() => {
    setShowActions(false)
  }, [pathname])

  // Hide navbar entirely on auth-free routes
  if (authFreeRoutes.includes(pathname)) {
    return null
  }

  const isActive = (href: string) => {
    if (href === "/profile") return pathname === "/profile"
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Mount the ?n= → mark-as-read sync once per authenticated session */}
      <NotificationReadSync />

      {/* Desktop top nav */}
      <header className="sticky top-0 z-40 hidden border-b border-primary/10 bg-white/95 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link
            href="/profile"
            className="flex items-center gap-2 text-sm font-semibold tracking-wide text-primary hover:text-primary/80"
            aria-label="Mulligan League — Home"
          >
            <Logo mark size={32} />
            <span className="hidden sm:inline">Mulligan League</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <DesktopLink href="/leagues" label="Leagues" pathname={pathname} />
            <DesktopLink href="/leaderboard" label="Leaderboard" pathname={pathname} />
            <DesktopLink href="/players" label="Players" pathname={pathname} />
            <Link
              href="/leagues/create"
              className="rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Create League
            </Link>
            <Link
              href="/leagues/join"
              className="rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Join League
            </Link>
            <Link
              href="/matches/create"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-cream hover:bg-primary/90"
            >
              Create Match
            </Link>
            <NotificationBell />
            <Link href="/profile" className="ml-1">
              <Avatar src={avatarUrl} alt="Profile" size={32} fallback="U" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile top-right bell */}
      <div className="fixed right-3 top-3 z-40 md:hidden">
        <NotificationBell />
      </div>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav-safe fixed bottom-0 left-0 right-0 z-40 border-t border-primary/10 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-end justify-between px-2 pt-1.5">
          {/* Leagues */}
          <MobileNavTab
            href="/leagues"
            label="Leagues"
            active={isActive("/leagues")}
            icon={<TrophyIcon />}
            activeIcon={<TrophyIconFilled />}
          />

          {/* Leaderboard */}
          <MobileNavTab
            href="/leaderboard"
            label="Board"
            active={isActive("/leaderboard")}
            icon={<LeaderboardIcon />}
            activeIcon={<LeaderboardIconFilled />}
          />

          {/* Center FAB */}
          <div className="relative flex flex-col items-center justify-end" style={{ minWidth: 56 }}>
            {/* Action menu */}
            {showActions && (
              <>
                <div
                  className="animate-fade-in fixed inset-0 z-40 bg-black/20"
                  onClick={() => setShowActions(false)}
                />
                <div className="animate-slide-up absolute bottom-14 z-50 flex flex-col gap-1 rounded-2xl border border-primary/10 bg-white p-2 shadow-xl">
                  <ActionMenuItem
                    href="/matches/create"
                    label="Create Match"
                    icon={<FlagIcon />}
                    onClick={() => setShowActions(false)}
                  />
                  <ActionMenuItem
                    href="/leagues/create"
                    label="Create League"
                    icon={<PlusCircleIcon />}
                    onClick={() => setShowActions(false)}
                  />
                  <ActionMenuItem
                    href="/leagues/join"
                    label="Join League"
                    icon={<JoinIcon />}
                    onClick={() => setShowActions(false)}
                  />
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowActions((v) => !v)}
              className="mb-0.5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-cream shadow-lg shadow-primary/25 active:scale-95 transition-transform"
              aria-label={showActions ? "Close menu" : "Create new"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-200 ${showActions ? "rotate-45" : ""}`}
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          {/* Players */}
          <MobileNavTab
            href="/players"
            label="Players"
            active={isActive("/players")}
            icon={<PlayersIcon />}
            activeIcon={<PlayersIconFilled />}
          />

          {/* Profile */}
          <Link
            href="/profile"
            className="relative flex min-h-[44px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1"
          >
            <span
              className={`absolute top-0 h-[3px] w-6 rounded-full bg-primary transition-opacity ${
                isActive("/profile") ? "opacity-100" : "opacity-0"
              }`}
            />
            <Avatar
              src={avatarUrl}
              alt="Profile"
              size={22}
              fallback="U"
            />
            <span className={`text-[10px] font-medium ${isActive("/profile") ? "text-primary" : "text-primary/40"}`}>
              Profile
            </span>
          </Link>
        </div>
      </nav>
    </>
  )
}

/* ── Mobile nav tab ──────────────────────────────────────────── */

function MobileNavTab({
  href,
  label,
  active,
  icon,
  activeIcon,
}: {
  href: string
  label: string
  active: boolean
  icon: React.ReactNode
  activeIcon: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="relative flex min-h-[44px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 active:bg-primary/5 transition-colors"
    >
      <span
        className={`absolute top-0 h-[3px] w-6 rounded-full bg-primary transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
      <span className="flex h-6 w-6 items-center justify-center">
        {active ? activeIcon : icon}
      </span>
      <span className={`text-[10px] font-medium ${active ? "text-primary" : "text-primary/40"}`}>
        {label}
      </span>
    </Link>
  )
}

/* ── Action menu item ────────────────────────────────────────── */

function ActionMenuItem({
  href,
  label,
  icon,
  onClick,
}: {
  href: string
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium text-primary hover:bg-cream active:bg-cream transition-colors"
    >
      <span className="flex h-5 w-5 items-center justify-center text-primary/60">{icon}</span>
      {label}
    </Link>
  )
}

/* ── Desktop link ────────────────────────────────────────────── */

function DesktopLink({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const active =
    href === "/profile" ? pathname === "/profile" : pathname.startsWith(href)

  return (
    <Link
      href={href}
      className={`border-b-2 pb-0.5 transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-primary/70 hover:border-primary/30 hover:text-primary"
      }`}
    >
      {label}
    </Link>
  )
}

/* ── SVG Icons ───────────────────────────────────────────────── */

function TrophyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

function TrophyIconFilled() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}

function LeaderboardIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
      <rect x="3" y="12" width="5" height="9" rx="1" /><rect x="9.5" y="4" width="5" height="17" rx="1" /><rect x="16" y="8" width="5" height="13" rx="1" />
    </svg>
  )
}

function LeaderboardIconFilled() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
      <rect x="3" y="12" width="5" height="9" rx="1" /><rect x="9.5" y="4" width="5" height="17" rx="1" /><rect x="16" y="8" width="5" height="13" rx="1" />
    </svg>
  )
}

function PlayersIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function PlayersIconFilled() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function FlagIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  )
}

function PlusCircleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function JoinIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  )
}
