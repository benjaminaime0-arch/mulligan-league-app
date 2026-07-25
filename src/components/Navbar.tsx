"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Logo } from "@/components/Logo"
import { Avatar } from "@/components/Avatar"
import { NotificationBell } from "@/components/NotificationBell"
import { NotificationReadSync } from "@/components/NotificationReadSync"
import { useAuthContext } from "@/components/AuthProvider"
import { supabase } from "@/lib/supabase"

/**
 * Routes that render their own full-screen shell and must not show the app
 * chrome: the landing/auth page, the OAuth callback, onboarding, and invite
 * deep links (which are viewable logged-out).
 */
const authFreeRoutes = ["/", "/auth/callback", "/welcome"]
const authFreePrefixes = ["/join/"]

/** The three "+ New" actions, shared by the desktop menu and mobile FAB. */
const NEW_ACTIONS = [
  { href: "/matches/create", label: "Record a round", icon: <FlagIcon /> },
  { href: "/games/create", label: "Create a game", icon: <PlusCircleIcon /> },
  { href: "/games/join", label: "Join with code", icon: <JoinIcon /> },
]

/** First initial from the session user, for the avatar fallback. */
function initialOf(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string {
  const meta = user?.user_metadata ?? {}
  const name =
    (meta.username as string) ||
    (meta.first_name as string) ||
    (meta.full_name as string) ||
    user?.email ||
    ""
  return name.trim().charAt(0).toUpperCase() || " "
}

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user } = useAuthContext()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  // Menu open states
  const [showActions, setShowActions] = useState(false) // mobile FAB sheet
  const [showNew, setShowNew] = useState(false) // desktop "+ New"
  const [showAvatar, setShowAvatar] = useState(false) // desktop avatar menu
  const newRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)

  // Fetch the avatar once per authenticated user — not per route change.
  useEffect(() => {
    if (!user) {
      setAvatarUrl(null)
      return
    }
    let active = true
    supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active && data?.avatar_url) setAvatarUrl(data.avatar_url)
      })
    return () => {
      active = false
    }
  }, [user])

  // Close all menus on route change
  useEffect(() => {
    setShowActions(false)
    setShowNew(false)
    setShowAvatar(false)
  }, [pathname])

  // Close desktop dropdowns on outside click
  useEffect(() => {
    if (!showNew && !showAvatar) return
    const onClick = (e: MouseEvent) => {
      if (newRef.current && !newRef.current.contains(e.target as Node)) setShowNew(false)
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setShowAvatar(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [showNew, showAvatar])

  const avatarFallback = initialOf(user)

  if (
    authFreeRoutes.includes(pathname) ||
    authFreePrefixes.some((p) => pathname.startsWith(p))
  ) {
    return null
  }

  const isActive = (href: string) => {
    if (href === "/home") return pathname === "/home"
    if (href === "/profile") return pathname === "/profile"
    return pathname.startsWith(href)
  }

  const handleLogout = async () => {
    setShowAvatar(false)
    await supabase.auth.signOut()
    router.replace("/")
  }

  return (
    <>
      {/* Mount the ?n= → mark-as-read sync once per authenticated session */}
      <NotificationReadSync />

      {/* Desktop top nav */}
      <header className="sticky top-0 z-40 hidden border-b border-primary/10 bg-white/95 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link
            href="/home"
            className="flex items-center gap-2 text-sm font-semibold tracking-wide text-primary hover:text-primary/80"
            aria-label="Mulligan — Home"
          >
            <Logo mark size={32} />
            <span className="hidden sm:inline">Mulligan</span>
          </Link>

          <nav className="flex items-center gap-6 text-sm font-medium">
            <DesktopLink href="/home" label="Home" pathname={pathname} />
            <DesktopLink href="/games" label="Games" pathname={pathname} />
            <DesktopLink href="/players" label="Players" pathname={pathname} />

            {/* + New menu */}
            <div ref={newRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowNew((v) => !v)
                  setShowAvatar(false)
                }}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-cream hover:bg-primary/90"
                aria-haspopup="menu"
                aria-expanded={showNew}
              >
                <PlusIcon />
                New
                <ChevronDown open={showNew} />
              </button>
              {showNew && (
                <div className="animate-slide-up absolute right-0 top-11 z-50 w-56 rounded-2xl border border-primary/10 bg-white p-1.5 shadow-xl">
                  {NEW_ACTIONS.map((a) => (
                    <MenuLink key={a.href} href={a.href} icon={a.icon} label={a.label} />
                  ))}
                </div>
              )}
            </div>

            <NotificationBell />

            {/* Avatar menu */}
            <div ref={avatarRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowAvatar((v) => !v)
                  setShowNew(false)
                }}
                className="ml-1 flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                aria-haspopup="menu"
                aria-expanded={showAvatar}
                aria-label="Account menu"
              >
                <Avatar src={avatarUrl} alt="Profile" size={32} fallback={avatarFallback} />
                <ChevronDown open={showAvatar} />
              </button>
              {showAvatar && (
                <div className="animate-slide-up absolute right-0 top-12 z-50 w-56 rounded-2xl border border-primary/10 bg-white p-1.5 shadow-xl">
                  <MenuLink href="/profile" icon={<UserIcon />} label="Profile" />
                  <MenuLink href="/profile/matches" icon={<CalendarIcon />} label="My calendar" />
                  <MenuLink href="/notifications" icon={<BellSmallIcon />} label="Notification settings" />
                  <div className="my-1 border-t border-primary/5" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    <span className="flex h-5 w-5 items-center justify-center text-red-500">
                      <LogoutIcon />
                    </span>
                    Log out
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* Mobile top-right bell */}
      <div className="fixed right-3 top-3 z-40 md:hidden">
        <NotificationBell />
      </div>

      {/* Mobile bottom nav: Home · Games · [+] · Players · Profile */}
      <nav className="mobile-nav-safe fixed bottom-0 left-0 right-0 z-40 border-t border-primary/10 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-end justify-between px-2 pt-1.5">
          <MobileNavTab href="/home" label="Home" active={isActive("/home")} icon={<HomeIcon />} activeIcon={<HomeIconFilled />} />
          <MobileNavTab href="/games" label="Games" active={isActive("/games")} icon={<TrophyIcon />} activeIcon={<TrophyIconFilled />} />

          {/* Center FAB */}
          <div className="relative flex flex-col items-center justify-end" style={{ minWidth: 56 }}>
            {showActions && (
              <>
                <div
                  className="animate-fade-in fixed inset-0 z-40 bg-black/20"
                  onClick={() => setShowActions(false)}
                />
                <div className="animate-slide-up absolute bottom-14 z-50 flex flex-col gap-1 rounded-2xl border border-primary/10 bg-white p-2 shadow-xl">
                  {NEW_ACTIONS.map((a) => (
                    <ActionMenuItem
                      key={a.href}
                      href={a.href}
                      label={a.label}
                      icon={a.icon}
                      onClick={() => setShowActions(false)}
                    />
                  ))}
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => setShowActions((v) => !v)}
              className="mb-0.5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-cream shadow-lg shadow-primary/25 transition-transform active:scale-95"
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

          <MobileNavTab href="/players" label="Players" active={isActive("/players")} icon={<PlayersIcon />} activeIcon={<PlayersIconFilled />} />

          {/* Profile tab (avatar) */}
          <Link
            href="/profile"
            className="relative flex min-h-[44px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1"
          >
            <span
              className={`absolute top-0 h-[3px] w-6 rounded-full bg-primary transition-opacity ${
                isActive("/profile") ? "opacity-100" : "opacity-0"
              }`}
            />
            <Avatar src={avatarUrl} alt="Profile" size={22} fallback={avatarFallback} />
            <span className={`text-[10px] font-medium ${isActive("/profile") ? "text-primary" : "text-primary/40"}`}>
              Profile
            </span>
          </Link>
        </div>
      </nav>
    </>
  )
}

/* ── Shared bits ─────────────────────────────────────────────── */

function MenuLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-primary hover:bg-cream"
    >
      <span className="flex h-5 w-5 items-center justify-center text-primary/60">{icon}</span>
      {label}
    </Link>
  )
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-current transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

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
      className="relative flex min-h-[44px] min-w-[52px] flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 transition-colors active:bg-primary/5"
    >
      <span
        className={`absolute top-0 h-[3px] w-6 rounded-full bg-primary transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
      <span className="flex h-6 w-6 items-center justify-center">{active ? activeIcon : icon}</span>
      <span className={`text-[10px] font-medium ${active ? "text-primary" : "text-primary/40"}`}>
        {label}
      </span>
    </Link>
  )
}

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
      className="flex items-center gap-3 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-cream active:bg-cream"
    >
      <span className="flex h-5 w-5 items-center justify-center text-primary/60">{icon}</span>
      {label}
    </Link>
  )
}

function DesktopLink({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const active =
    href === "/home" || href === "/profile"
      ? pathname === href
      : pathname.startsWith(href)
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

function PlusIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-primary/50">
      <path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" />
    </svg>
  )
}

function HomeIconFilled() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" className="text-primary">
      <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-6H10v6H4a1 1 0 0 1-1-1V9.5Z" />
    </svg>
  )
}

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

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function BellSmallIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

function LogoutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
