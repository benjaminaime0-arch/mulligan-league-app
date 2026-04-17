"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Logo } from "@/components/Logo"
import { Avatar } from "@/components/Avatar"
import { supabase } from "@/lib/supabase"

const navItems = [
  { href: "/leagues/list", label: "Leagues", icon: "leagues" },
  { href: "/matches/create", label: "Match", icon: "+", isPrimaryAction: true },
  { href: "/players", label: "Players", icon: "players" },
  { href: "/profile", label: "Profile", icon: "profile" },
]

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

  // Hide navbar entirely on auth-free routes
  if (authFreeRoutes.includes(pathname)) {
    return null
  }

  return (
    <>
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
            <DesktopLink href="/leagues/list" label="Leagues" pathname={pathname} />
            <DesktopLink href="/players" label="Players" pathname={pathname} />
            <Link
              href="/leagues/create"
              className="rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/5"
            >
              Create League
            </Link>
            <Link
              href="/matches/create"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-cream hover:bg-primary/90"
            >
              Create Match
            </Link>
            <Link href="/profile" className="ml-1">
              <Avatar src={avatarUrl} alt="Profile" size={32} fallback="U" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-primary/10 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-2xl items-stretch justify-between px-1 py-1.5">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)

            if (item.isPrimaryAction) {
              return (
                <div key={item.href} className="relative flex flex-1 items-center justify-center">
                  {/* Action menu */}
                  {showActions && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
                      <div className="absolute bottom-16 z-50 flex flex-col gap-1.5 rounded-xl border border-primary/10 bg-white p-2 shadow-lg">
                        <Link
                          href="/matches/create"
                          onClick={() => setShowActions(false)}
                          className="whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium text-primary hover:bg-cream"
                        >
                          Create Match
                        </Link>
                        <Link
                          href="/leagues/create"
                          onClick={() => setShowActions(false)}
                          className="whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium text-primary hover:bg-cream"
                        >
                          Create League
                        </Link>
                        <Link
                          href="/leagues/join"
                          onClick={() => setShowActions(false)}
                          className="whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium text-primary hover:bg-cream"
                        >
                          Join League
                        </Link>
                      </div>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowActions((v) => !v)}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-cream shadow-md shadow-primary/30"
                  >
                    <span className={`text-xl transition-transform ${showActions ? "rotate-45" : ""}`} aria-hidden="true">
                      ⊕
                    </span>
                  </button>
                </div>
              )
            }

            // Profile tab with avatar
            if (item.icon === "profile") {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] font-medium"
                >
                  <Avatar src={avatarUrl} alt="Profile" size={20} fallback="U" className={isActive ? "ring-2 ring-primary" : ""} />
                  <span className={isActive ? "text-primary" : "text-primary/60"}>
                    {item.label}
                  </span>
                </Link>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] font-medium"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center ${
                    isActive ? "text-primary" : "text-primary/60"
                  }`}
                  aria-hidden="true"
                >
                  {item.icon === "leagues" && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                    </svg>
                  )}
                  {item.icon === "players" && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  )}
                </span>
                <span
                  className={`${
                    isActive ? "text-primary" : "text-primary/60"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}

interface DesktopLinkProps {
  href: string
  label: string
  pathname: string
}

function DesktopLink({ href, label, pathname }: DesktopLinkProps) {
  const isActive =
    href === "/profile" ? pathname === "/profile" : pathname.startsWith(href)

  return (
    <Link
      href={href}
      className={`border-b-2 pb-0.5 transition-colors ${
        isActive
          ? "border-primary text-primary"
          : "border-transparent text-primary/70 hover:border-primary/30 hover:text-primary"
      }`}
    >
      {label}
    </Link>
  )
}
