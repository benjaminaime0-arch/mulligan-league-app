"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const primary = "text-primary"
const accent = "text-emerald-600"

const navItems = [
  { href: "/dashboard", label: "Home", icon: "⌂" },
  { href: "/leagues/list", label: "Leagues", icon: "🏆" },
  { href: "/matches/create", label: "Match", icon: "+", isPrimaryAction: true },
  { href: "/leaderboard", label: "Ranks", icon: "📊" },
  { href: "/profile", label: "Profile", icon: "👤" },
]

const authFreeRoutes = ["/", "/login", "/signup"]

export function Navbar() {
  const pathname = usePathname()

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
            href="/dashboard"
            className="text-sm font-semibold tracking-wide text-primary hover:text-primary/80"
          >
            Mulligan League
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <DesktopLink href="/dashboard" label="Dashboard" pathname={pathname} />
            <DesktopLink href="/leagues/list" label="Leagues" pathname={pathname} />
            <DesktopLink href="/leaderboard" label="Leaderboard" pathname={pathname} />
            <Link
              href="/profile"
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${
                pathname.startsWith("/profile")
                  ? "border-primary bg-primary text-cream"
                  : "border-primary/20 bg-cream text-primary hover:border-primary/40"
              }`}
              aria-label="Profile"
            >
              👤
            </Link>
          </nav>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-primary/10 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-2xl items-stretch justify-between px-1 py-1.5">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href)

            if (item.isPrimaryAction) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex flex-1 items-center justify-center"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-cream shadow-md shadow-primary/30">
                    <span className="text-xl" aria-hidden="true">
                      ⊕
                    </span>
                  </div>
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
    href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href)

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

