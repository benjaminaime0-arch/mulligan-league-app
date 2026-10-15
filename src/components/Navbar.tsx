"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { AppIcon } from "@/components/ui/AppIcon"
import { Logo } from "@/components/Logo"
import { Avatar } from "@/components/Avatar"
import { NotificationBell } from "@/components/NotificationBell"
import { NotificationReadSync } from "@/components/NotificationReadSync"
import { useAuthContext } from "@/components/AuthProvider"
import { useI18n } from "@/lib/i18n"
import { supabase } from "@/lib/supabase"
import { clearCardOfflineData, pendingCards } from "@/lib/cardOffline"
import { stopCardDrafts } from "@/lib/cardDraftManager"

/**
 * Routes that render their own full-screen shell and must not show the app
 * chrome: the landing/auth page, the OAuth callback, onboarding, and invite
 * deep links (which are viewable logged-out).
 */
const authFreeRoutes = ["/", "/auth/callback", "/welcome"]
const authFreePrefixes = ["/join/"]

/** The MVP actions share the same card and league entry points. */
function newActions(t: (k: string) => string) {
  return [
    { href: "/rounds?new=1", label: t("app.newCard"), icon: <AppIcon name="cards" /> },
    { href: "/games/create", label: t("nav.new.game"), icon: <AppIcon name="trophy" /> },
    { href: "/games/join", label: t("nav.new.join"), icon: <AppIcon name="join" /> },
  ]
}

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
  const { t, locale, setLocale } = useI18n()
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const NEW_ACTIONS = newActions(t)

  // Menu open states
  const [showActions, setShowActions] = useState(false) // mobile FAB sheet
  const [showNew, setShowNew] = useState(false) // desktop "+ New"
  const [showAvatar, setShowAvatar] = useState(false) // desktop avatar menu
  const newRef = useRef<HTMLDivElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)
  const actionDialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = actionDialog.current
    if (!dialog) return
    if (showActions && !dialog.open) dialog.showModal()
    const previousOverflow = document.body.style.overflow
    if (showActions) document.body.style.overflow = "hidden"
    if (!showActions && dialog.open) dialog.close()
    return () => { document.body.style.overflow = previousOverflow }
  }, [showActions])

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (showNew) newRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
      if (showAvatar) avatarRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
      setShowNew(false); setShowAvatar(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onClick)
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey) }
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
    if (href === "/profile") return pathname.startsWith("/profile")
    return pathname.startsWith(href)
  }

  const handleLogout = async () => {
    setShowAvatar(false)
    if (user && pendingCards(user.id).length && !window.confirm(t("personal.offline.logoutWarning"))) return
    if (user) { stopCardDrafts(user.id); clearCardOfflineData(user.id) }
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
            <DesktopLink href="/home" label={t("nav.home")} pathname={pathname} />
            <DesktopLink href="/rounds" label={t("personal.cards")} pathname={pathname} />
            <DesktopLink href="/games" label={t("nav.games")} pathname={pathname} />
            <DesktopLink href="/profile" label={t("nav.profile")} pathname={pathname} />

            {/* + New menu */}
            <div ref={newRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowNew((v) => !v)
                  setShowAvatar(false)
                }}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-cream hover:bg-primary/90"
                aria-controls="desktop-new-actions"
                aria-expanded={showNew}
              >
                <PlusIcon />
                {t("nav.new")}
                <ChevronDown open={showNew} />
              </button>
              {showNew && (
                <div id="desktop-new-actions" className="animate-slide-up absolute right-0 top-11 z-50 w-56 rounded-2xl border border-primary/10 bg-white p-1.5 shadow-xl">
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
                aria-controls="desktop-account-actions"
                aria-expanded={showAvatar}
                aria-label={t("nav.account")}
              >
                <Avatar src={avatarUrl} alt="Profile" size={32} fallback={avatarFallback} />
                <ChevronDown open={showAvatar} />
              </button>
              {showAvatar && (
                <div id="desktop-account-actions" className="animate-slide-up absolute right-0 top-12 z-50 w-56 rounded-2xl border border-primary/10 bg-white p-1.5 shadow-xl">
                  <MenuLink href="/profile" icon={<UserIcon />} label={t("nav.menu.profile")} />
                  <MenuLink href="/notifications#notification-settings" icon={<BellSmallIcon />} label={t("nav.menu.notifications")} onClick={() => { setShowAvatar(false); window.dispatchEvent(new Event("mulligan:open-notification-settings")) }} />
                  <div className="my-1 border-t border-primary/5" />
                  {/* Language switcher (T1.7) — FR default, EN fallback */}
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm font-medium text-primary/60">
                      {t("nav.menu.language")}
                    </span>
                    <span className="flex overflow-hidden rounded-lg border border-primary/15">
                      {(["fr", "en"] as const).map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setLocale(l)}
                          className={`px-2 py-1 text-xs font-semibold uppercase transition-colors ${
                            locale === l
                              ? "bg-primary text-cream"
                              : "bg-white text-primary/50 hover:bg-cream"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </span>
                  </div>
                  <div className="my-1 border-t border-primary/5" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    <span className="flex h-5 w-5 items-center justify-center text-red-500">
                      <LogoutIcon />
                    </span>
                    {t("nav.menu.logout")}
                  </button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      {/* Stable mobile header keeps notifications clear of page actions. */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-primary/10 bg-bone/95 px-4 backdrop-blur md:hidden">
        <Link href="/home" className="flex min-h-[44px] items-center gap-2 font-bold" aria-label={`Mulligan — ${t("nav.home")}`}><Logo mark size={28} /><span>Mulligan</span></Link>
        <NotificationBell />
      </header>
      <dialog ref={actionDialog} id="new-actions" aria-labelledby="new-actions-title" onCancel={() => setShowActions(false)} onClose={() => setShowActions(false)} onClick={e => { if (e.target === e.currentTarget) setShowActions(false) }} className="app-action-sheet fixed inset-x-0 top-auto bottom-0 m-auto w-full max-w-md rounded-t-[28px] border-0 bg-bone p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-primary shadow-xl">
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-9 rounded-full bg-primary/20" />
        <div className="mb-4 flex items-start justify-between gap-3"><div><h2 id="new-actions-title" className="mt-1 text-2xl font-bold">{t("nav.new")}</h2></div><button type="button" onClick={() => setShowActions(false)} aria-label={t("personal.ui.close")} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/5"><AppIcon name="close" className="h-5 w-5" /></button></div>
        <div className="space-y-2">{NEW_ACTIONS.map(a => <ActionMenuItem key={a.href} href={a.href} label={a.label} icon={a.icon} onClick={() => setShowActions(false)} />)}</div>
      </dialog>

      {/* Mobile bottom nav: Home · Cards · [+] · Leagues · Profile */}
      <nav className="mobile-nav-safe fixed bottom-0 left-0 right-0 z-40 border-t border-primary/10 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between px-2 pt-2">
          <MobileNavTab href="/home" label={t("nav.home")} active={isActive("/home")} icon={<HomeIcon />} activeIcon={<HomeIconFilled />} />
          <MobileNavTab href="/rounds" label={t("nav.cards")} active={isActive("/rounds")} icon={<AppIcon name="cards" />} activeIcon={<AppIcon name="cards" />} />

          {/* Center FAB */}
          <div className="relative flex flex-col items-center justify-end" style={{ minWidth: 56 }}>
            <button
              type="button"
              onClick={() => setShowActions((v) => !v)}
              className="mb-0.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-cream shadow-md shadow-primary/20 transition-transform active:scale-95"
              aria-label={showActions ? t("nav.closeMenu") : t("nav.new")}
              aria-expanded={showActions}
              aria-controls="new-actions"
              aria-haspopup="dialog"
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
            </button><span className="text-[10px] font-semibold text-primary/70">{t("nav.new")}</span>
          </div>

          <MobileNavTab href="/games" label={t("nav.games")} active={isActive("/games")} icon={<AppIcon name="trophy" />} activeIcon={<AppIcon name="trophy" />} />

          {/* Profile tab (avatar) */}
          <Link
            href="/profile"
            aria-current={isActive("/profile") ? "page" : undefined}
            className={`relative flex min-h-[52px] min-w-[56px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 ${isActive("/profile") ? "bg-sage/30" : ""}`}
          >
            <span
              className={`absolute -bottom-0.5 h-[3px] w-3 rounded-full bg-primary transition-opacity ${
                isActive("/profile") ? "opacity-100" : "opacity-0"
              }`}
            />
            <Avatar src={avatarUrl} alt="Profile" size={22} fallback={avatarFallback} />
            <span className={`text-[10px] font-semibold ${isActive("/profile") ? "text-primary" : "text-primary/70"}`}>
              {t("nav.profile")}
            </span>
          </Link>
        </div>
      </nav>
    </>
  )
}

/* ── Shared bits ─────────────────────────────────────────────── */

function MenuLink({ href, icon, label, onClick }: { href: string; icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
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
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-[52px] min-w-[56px] flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1.5 transition-colors ${active ? "bg-sage/30 text-primary" : "text-primary/60 active:bg-primary/5"}`}
    >
      <span
        className={`absolute -bottom-0.5 h-[3px] w-3 rounded-full bg-primary transition-opacity ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
      <span className="flex h-6 w-6 items-center justify-center">{active ? activeIcon : icon}</span>
      <span className={`text-[10px] font-semibold ${active ? "text-primary" : "text-primary/70"}`}>
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
      className="app-surface flex min-h-[76px] items-center gap-3 px-4 py-3 text-sm font-medium text-primary"
    >
      <span className="app-icon-tile">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block font-bold">{label}</span></span><AppIcon name="arrow" className="h-4 w-4 shrink-0" />
    </Link>
  )
}

function DesktopLink({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const active =
    href === "/home"
      ? pathname === href
      : pathname.startsWith(href)
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
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

function UserIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
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
