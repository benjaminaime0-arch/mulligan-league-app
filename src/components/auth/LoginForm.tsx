"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useT } from "@/lib/i18n"

export function LoginForm() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirect")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  })

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!formData.email.trim()) errors.email = t("auth.error.email.required")
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = t("auth.error.email.invalid")
    }
    if (!formData.password) errors.password = t("auth.error.password.required")
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!validate()) return

    setLoading(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email.trim(),
        password: formData.password,
      })

      if (signInError) throw signInError

      router.refresh()
      router.push(redirectTo || "/home")
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.error.credentials"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div>
        <label htmlFor="login-email" className="mb-1 block text-sm font-medium text-primary">
          {t("auth.email")}
        </label>
        <input
          id="login-email"
          type="email"
          value={formData.email}
          onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
          className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="john@example.com"
          autoComplete="email"
          disabled={loading}
        />
        {fieldErrors.email && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.email}</p>
        )}
      </div>

      <div>
        <label htmlFor="login-password" className="mb-1 block text-sm font-medium text-primary">
          {t("auth.password")}
        </label>
        <input
          id="login-password"
          type="password"
          value={formData.password}
          onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
          className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="••••••••"
          autoComplete="current-password"
          disabled={loading}
        />
        {fieldErrors.password && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.password}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? t("auth.login.submitting") : t("auth.login")}
      </button>

      <p className="text-center text-sm text-primary/70">
        {resetSent ? (
          <span className="text-emerald-700">{t("auth.reset.sent")}</span>
        ) : (
          <button
            type="button"
            disabled={resetLoading}
            onClick={async () => {
              const email = formData.email.trim()
              if (!email) {
                setError(t("auth.reset.needemail"))
                return
              }
              setResetLoading(true)
              setError(null)
              try {
                const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                  // Recovery link returns the user to the home page; Supabase
                  // JS picks up the access_token from the URL hash and creates
                  // a recovery session.
                  redirectTo: `${window.location.origin}/`,
                })
                if (resetError) throw resetError
                setResetSent(true)
              } catch (err) {
                setError(err instanceof Error ? err.message : t("auth.reset.failed"))
              } finally {
                setResetLoading(false)
              }
            }}
            className="font-medium text-primary underline hover:no-underline disabled:opacity-60"
          >
            {resetLoading ? t("games.match.sending") : t("auth.forgot")}
          </button>
        )}
      </p>
    </form>
  )
}
