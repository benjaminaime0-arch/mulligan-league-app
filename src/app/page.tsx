"use client"

import { Suspense, useEffect, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { LoginForm } from "@/components/auth/LoginForm"
import { SignupForm } from "@/components/auth/SignupForm"
import { OAuthButtons } from "@/components/auth/OAuthButtons"
import { useI18n } from "@/lib/i18n"

export default function Home() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeContent />
    </Suspense>
  )
}

// The layout wraps every page in pb-[4.5rem] to clear the mobile bottom
// nav, but the Navbar doesn't render on "/" — the -mb cancels the padding
// so the bone/green surfaces reach the bottom edge instead of a white strip.
const NAV_PAD_CANCEL = "-mb-[4.5rem] md:mb-0"

function HomeLoading() {
  return (
    <main
      className={`flex min-h-screen items-center justify-center bg-bone ${NAV_PAD_CANCEL}`}
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
    </main>
  )
}

type Tab = "login" | "signup"

function HomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t } = useI18n()
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
    <main className={`flex min-h-screen flex-col lg:flex-row ${NAV_PAD_CANCEL}`}>
      {/* Brand panel — full-height left split on desktop, top band on mobile. */}
      <section className="flex flex-col bg-primary px-6 py-8 text-cream lg:min-h-screen lg:w-[55%] lg:px-14 lg:py-12">
        <div className="flex items-center gap-3">
          <Image
            src="/logo-mark-white.png"
            alt=""
            width={44}
            height={44}
            priority
            className="h-10 w-10 lg:h-11 lg:w-11"
          />
          {/* 0.4em tracking adds a trailing gap after the last letter, so the
              wordmark is left-aligned rather than centered. */}
          <span className="text-sm font-bold uppercase tracking-[0.4em] lg:text-base">
            Mulligan
          </span>
        </div>

        <div className="mt-8 lg:my-auto lg:py-16">
          {/* -0.04em is the brand kit's display tracking (.t-display). */}
          <h1 className="text-4xl font-black leading-[1.08] tracking-[-0.04em] sm:text-5xl lg:text-6xl xl:text-7xl">
            {t("auth.hero.line1")}
            <br />
            <span className="text-gold">{t("auth.hero.line2")}</span>
          </h1>
          <p className="mt-4 max-w-md text-base font-light text-sage lg:mt-6 lg:text-xl">
            {t("auth.subtitle")}
          </p>

          {/* Brand kit badge component (pill, 700 weight, 0.1em tracking).
              Outlined on green so the gold stays reserved for the headline —
              and unlike a separator row these wrap without a dangling glyph. */}
          <ul className="mt-6 flex flex-wrap gap-2 lg:mt-8">
            {["auth.badge.standings", "auth.badge.net", "auth.badge.private"].map((key) => (
              <li
                key={key}
                className="rounded-full border border-cream/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-cream/80 lg:text-[11px]"
              >
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Auth panel */}
      <section className="flex flex-1 justify-center bg-bone px-4 py-10 lg:items-center lg:overflow-y-auto lg:px-8">
        {/* Card matches the app's surface treatment — white card, green
            hairline, shadow-sm, exactly as /profile's cards — at the brand
            kit's 14px panel radius. The kit's #E7E1D2 hairline is specified
            for panels sitting on the off-white body; against bone it has
            almost no edge, so the green tint the app already uses wins. */}
        <div className="auth-card h-fit w-full max-w-[460px] rounded-[14px] border border-primary/15 bg-white p-6 shadow-sm sm:p-7">
          {/* Social sign-in first — the lowest-friction entry (T1.1). It sits
              above the tabs because it is tab-agnostic: Google both signs in
              and signs up, so putting it inside either pane would imply it
              only applies there. OAuthButtons renders its own "or" divider. */}
          <div className="mb-6">
            <OAuthButtons redirectTo={searchParams.get("redirect")} />
          </div>

          <div
            role="tablist"
            aria-label="Authentication"
            className="mb-7 grid grid-cols-2 gap-1 rounded-full bg-primary/5 p-1"
          >
            <TabButton active={tab === "login"} onClick={() => setTab("login")}>
              {t("auth.login")}
            </TabButton>
            <TabButton active={tab === "signup"} onClick={() => setTab("signup")}>
              {t("auth.signup")}
            </TabButton>
          </div>

          <div role="tabpanel">
            {tab === "login" ? <LoginForm /> : <SignupForm />}
          </div>
        </div>
      </section>
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
      // ring-offset-white puts a gap between pill and ring so the indicator is
      // visible on BOTH states — a plain primary ring vanishes on the active
      // green pill, and primary/40 was only 2.34:1 on the card (WCAG wants 3:1).
      className={`rounded-full py-2.5 text-sm font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        active
          ? "bg-primary text-cream"
          : "text-primary/70 hover:bg-primary/5 hover:text-primary"
      }`}
    >
      {children}
    </button>
  )
}
