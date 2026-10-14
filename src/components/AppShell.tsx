"use client"
import { usePathname } from "next/navigation"
import { Navbar } from "./Navbar"

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const app = ["/home", "/rounds", "/games", "/profile", "/notifications"].some(p => pathname === p || pathname.startsWith(`${p}/`))
  return <div className={app ? "mulligan-app min-h-screen bg-bone" : "min-h-screen"}>
    <Navbar />
    <div className={app ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8" : "pb-[4.5rem] md:pb-0"}>{children}</div>
  </div>
}
