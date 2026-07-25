"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Logo } from "@/components/Logo"
import { LoginForm } from "@/components/auth/LoginForm"
import { SignupForm } from "@/components/auth/SignupForm"
import { OAuthButtons } from "@/components/auth/OAuthButtons"

export default function Home() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeContent />
    </Suspense>
  )
}

function HomeLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
    </main>
  )
}

type Tab = "login" | "signup"

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [checking, setChecking] = useState(true)
  // `?tab=signup` deep-links into the signup tab so /signup redirects can
  // land on the right pane.
  const initialTab: Tab = searchParams.get("tab") === "signup" ? "signup" : "login"
  const [tab, setTab] = useState<Tab>(initialTab)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace("/home")
      } else {
        setChecking(false)
      }
    })
  }, [router])

  if (checking) return <HomeLoading />

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mx-auto w-full max-w-[440px]">
        <div className="mb-8 flex flex-col items-center">
          <Logo size={160} priority />
          <span className="-mt-6 text-4xl font-bold text-primary">Mulligan</span>
        </div>
        <h1 className="sr-only">Mulligan</h1>
        <p className="mb-1 text-center text-lg text-primary/90">
          Your weekend golf crew, organized.
        </p>
        <p className="mb-6 text-center text-sm text-primary/60">
          Games, scores, bragging rights, all in one place.
        </p>

        {/* Social sign-in first — the lowest-friction entry (T1.1). */}
        <div className="mb-6">
          <OAuthButtons redirectTo={searchParams.get("redirect")} />
        </div>

        <div
          role="tablist"
          aria-label="Authentication"
          className="mb-6 grid grid-cols-2 rounded-lg border border-primary/15 bg-cream p-1"
        >
          <TabButton active={tab === "login"} onClick={() => setTab("login")}>
            Log In
          </TabButton>
          <TabButton active={tab === "signup"} onClick={() => setTab("signup")}>
            Sign Up
          </TabButton>
        </div>

        <div role="tabpanel">
          {tab === "login" ? <LoginForm /> : <SignupForm />}
        </div>
      </div>
    </main>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md py-2 text-sm font-semibold transition-colors ${
        active
          ? "bg-primary text-cream shadow-sm"
          : "text-primary/70 hover:text-primary"
      }`}
    >
      {children}
    </button>
  )
}
