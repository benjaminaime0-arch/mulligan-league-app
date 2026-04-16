"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Logo } from "@/components/Logo"

const navItems = [
  { href: "/profile", label: "Home", icon: "⌂" },
  { href: "/leagues/list", label: "Leagues", icon: "🏆" },
  { href: "/matches/create", label: "Match", icon: "+", isPrimaryAction: true },
  { href: "/leaderboard", label: "Ranks", icon: "📊" },
]

const authFreeRoutes = ["/", "/login", "/signup"]

export function Navbar() {
  const pathname = usePathname()
  const [showActions, setShowActions] = useState(false)

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
            <DesktopLink href="/profile" label="Home" pathname={pathname} />
            <DesktopLink href="/leagues/list" label="Leagues" pathname={pathname} />
            <DesktopLink href="/leaderboard" label="Leaderboard" pathname={pathname} />
            <Link
              href="/matches/create"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-cream hover:bg-primary/90"
            >
              Create Match
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-primary/10 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-2xl items-stretch justify-between px-1 py-1.5">
          {navItems.map((item) => {
            const isActive =
              item.href === "/profile"
                ? pathname === "/profile"
                : pathname.startsWith(item.href)

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

            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-[11px] font-medium"
              >
                <span
                  className={`text-lg ${
                    isActive ? "text-primary" : "text-primary/60"
                  }`}
                  aria-hidden="true"
                >
                  {item.icon}
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
