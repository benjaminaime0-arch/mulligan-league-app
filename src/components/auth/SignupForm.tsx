"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { track } from "@/lib/analytics"
import { useT } from "@/lib/i18n"
import { signupConfirmationUrl, signupDestination } from "@/lib/signupFlow"

export function SignupForm() {
  const t = useT()
  const router = useRouter()
  // Honour `?redirect=` so an invite link (/join/[code]) returns the new
  // user straight to the game they were invited to (T1.3).
  const redirectTo = useSearchParams().get("redirect")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    username: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    club: "",
    handicap: "",
  })

  const validate = () => {
    const errors: Record<string, string> = {}
    const username = formData.username.trim()
    if (!username) errors.username = t("auth.error.username.required")
    else if (username.length < 3) errors.username = t("auth.error.username.short")
    else if (!/^[a-zA-Z0-9]+$/.test(username)) errors.username = t("auth.username.rule")
    if (!formData.firstName.trim()) errors.firstName = t("auth.error.firstname.required")
    if (!formData.lastName.trim()) errors.lastName = t("auth.error.lastname.required")
    if (!formData.email.trim()) errors.email = t("auth.error.email.required")
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = t("auth.error.email.invalid")
    }
    if (!formData.password) errors.password = t("auth.error.password.required")
    else if (formData.password.length < 6) {
      errors.password = t("auth.error.password.short")
    }
    if (formData.password && formData.confirmPassword !== formData.password) {
      errors.confirmPassword = t("auth.error.password.mismatch")
    }
    if (formData.handicap) {
      const h = parseFloat(formData.handicap)
      if (isNaN(h) || h < 0 || h > 54) {
        errors.handicap = t("auth.error.handicap.range")
      }
    }
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!validate()) return

    setLoading(true)
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: formData.email.trim(),
        password: formData.password,
        options: {
          // The auth shell waits for the confirmed session before opening onboarding.
          emailRedirectTo: signupConfirmationUrl(window.location.origin, redirectTo),
          data: {
            username: formData.username.trim(),
            first_name: formData.firstName.trim(),
            last_name: formData.lastName.trim(),
            club: formData.club.trim() || undefined,
            handicap: formData.handicap ? parseFloat(formData.handicap) : undefined,
          },
        },
      })

      if (signUpError) {
        if (signUpError.message?.includes("profiles_username_unique") || signUpError.message?.includes("duplicate")) {
          throw new Error(t("onboarding.username.taken"))
        }
        if (/sending confirmation email/i.test(signUpError.message)) {
          throw new Error(t("auth.signup.emailUnavailable"))
        }
        throw signUpError
      }

      // A successful request may still need email verification. Do not visit
      // protected onboarding without a session or retain passwords while waiting.
      if (!data.session) {
        setConfirmationEmail(formData.email.trim())
        setFormData((p) => ({ ...p, password: "", confirmPassword: "" }))
        track("signup_confirmation_requested", { provider: "email" })
        return
      }

      track("signup_completed", { provider: "email" })
      router.push(signupDestination(redirectTo))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error.generic"))
    } finally {
      setLoading(false)
    }
  }

  if (confirmationEmail) {
    return (
      <section className="space-y-4" aria-labelledby="signup-confirmation-title">
        <div role="status" className="rounded-[10px] border border-primary/20 bg-cream/40 p-4">
          <h2 id="signup-confirmation-title" className="text-lg font-bold text-primary">
            {t("auth.signup.checkEmail")}
          </h2>
          <p className="mt-2 break-words text-sm text-primary/80">
            {t("auth.signup.confirmationSent", { email: confirmationEmail })}
          </p>
          <p className="mt-2 text-sm text-primary/70">{t("auth.signup.confirmationHelp")}</p>
        </div>
        <button
          type="button"
          className="text-sm text-primary underline"
          onClick={() => {
            setConfirmationEmail(null)
            setFormData((p) => ({ ...p, email: "" }))
          }}
        >
          {t("auth.signup.changeEmail")}
        </button>
      </section>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="signup-username" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
            {t("onboarding.username")}
          </label>
          <input
            id="signup-username"
            type="text"
            value={formData.username}
            onChange={(e) =>
              setFormData((p) => ({ ...p, username: e.target.value.replace(/[^a-zA-Z0-9]/g, "") }))
            }
            className="w-full rounded-[10px] border border-primary/20 bg-white px-3.5 py-2.5 text-base text-charcoal placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="JohnnyGolf"
            autoComplete="username"
            maxLength={30}
            disabled={loading}
          />
          <p className="mt-1 text-[11px] text-primary/70">{t("auth.username.rule")}</p>
          {fieldErrors.username && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.username}</p>
          )}
        </div>

        <div>
          <label htmlFor="signup-email" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
            {t("auth.email")}
          </label>
          <input
            id="signup-email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
            className="w-full rounded-[10px] border border-primary/20 bg-white px-3.5 py-2.5 text-base text-charcoal placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="john@example.com"
            autoComplete="email"
            disabled={loading}
          />
          {fieldErrors.email && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.email}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="signup-firstName" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
            {t("auth.firstname")}
          </label>
          <input
            id="signup-firstName"
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData((p) => ({ ...p, firstName: e.target.value }))}
            className="w-full rounded-[10px] border border-primary/20 bg-white px-3.5 py-2.5 text-base text-charcoal placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="John"
            autoComplete="given-name"
            disabled={loading}
          />
          {fieldErrors.firstName && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.firstName}</p>
          )}
        </div>

        <div>
          <label htmlFor="signup-lastName" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
            {t("auth.lastname")}
          </label>
          <input
            id="signup-lastName"
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData((p) => ({ ...p, lastName: e.target.value }))}
            className="w-full rounded-[10px] border border-primary/20 bg-white px-3.5 py-2.5 text-base text-charcoal placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Smith"
            autoComplete="family-name"
            disabled={loading}
          />
          {fieldErrors.lastName && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.lastName}</p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="signup-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
          {t("auth.password")}
        </label>
        <input
          id="signup-password"
          type="password"
          value={formData.password}
          onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
          className="w-full rounded-[10px] border border-primary/20 bg-white px-3.5 py-2.5 text-base text-charcoal placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="••••••••"
          autoComplete="new-password"
          disabled={loading}
        />
        {fieldErrors.password && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.password}</p>
        )}
      </div>

      <div>
        <label htmlFor="signup-confirmPassword" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
          {t("auth.password.confirm")}
        </label>
        <input
          id="signup-confirmPassword"
          type="password"
          value={formData.confirmPassword}
          onChange={(e) => setFormData((p) => ({ ...p, confirmPassword: e.target.value }))}
          className="w-full rounded-[10px] border border-primary/20 bg-white px-3.5 py-2.5 text-base text-charcoal placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="••••••••"
          autoComplete="new-password"
          disabled={loading}
        />
        {fieldErrors.confirmPassword && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.confirmPassword}</p>
        )}
      </div>

      <div>
        <label htmlFor="signup-club" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
          {t("onboarding.club")} <span className="font-normal normal-case tracking-normal text-primary/70">{t("common.optional")}</span>
        </label>
        <input
          id="signup-club"
          type="text"
          value={formData.club}
          onChange={(e) => setFormData((p) => ({ ...p, club: e.target.value }))}
          className="w-full rounded-[10px] border border-primary/20 bg-white px-3.5 py-2.5 text-base text-charcoal placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Pebble Beach Golf Links"
          disabled={loading}
        />
      </div>

      <div>
        <label htmlFor="signup-handicap" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.2em] text-primary/70">
          {t("auth.handicap")} <span className="font-normal normal-case tracking-normal text-primary/70">{t("auth.handicap.optional")}</span>
        </label>
        <input
          id="signup-handicap"
          type="number"
          min={0}
          max={54}
          step={0.1}
          value={formData.handicap}
          onChange={(e) => setFormData((p) => ({ ...p, handicap: e.target.value }))}
          className="w-full rounded-[10px] border border-primary/20 bg-white px-3.5 py-2.5 text-base text-charcoal placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="18"
          disabled={loading}
        />
        {fieldErrors.handicap && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.handicap}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-[10px] bg-primary px-4 py-3 text-[15px] font-bold tracking-[-0.02em] text-cream transition-all hover:bg-primary-deep active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? t("auth.signup.creating") : t("auth.signup.submit")}
      </button>
    </form>
  )
}
