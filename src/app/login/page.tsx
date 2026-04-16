"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { Logo } from "@/components/Logo"

export default function LoginPage() {
  const router = useRouter()
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
    if (!formData.email.trim()) errors.email = "Email is required"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = "Please enter a valid email"
    }
    if (!formData.password) errors.password = "Password is required"
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!validate()) return

    setLoading(true)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email.trim(),
        password: formData.password,
      })

      if (signInError) throw signInError

      router.refresh()
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid email or password")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mb-6 flex justify-center" aria-label="Mulligan League home">
          <Logo size={140} priority />
        </Link>
        <h1 className="mb-2 text-2xl font-bold text-primary">Log In</h1>
        <p className="mb-8 text-primary/70">
          Good to see you again.
        </p>

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
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-primary"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) =>
                setFormData((p) => ({ ...p, email: e.target.value }))
              }
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
            <label
              htmlFor="password"
              className="mb-1 block text-sm font-medium text-primary"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={formData.password}
              onChange={(e) =>
                setFormData((p) => ({ ...p, password: e.target.value }))
              }
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
            {loading ? "Logging in…" : "Log In"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-primary/70">
          {resetSent ? (
            <span className="text-emerald-700">Check your email for a reset link.</span>
          ) : (
            <button
              type="button"
              disabled={resetLoading}
              onClick={async () => {
                const email = formData.email.trim()
                if (!email) {
                  setError("Enter your email above, then click forgot password.")
                  return
                }
                setResetLoading(true)
                setError(null)
                try {
                  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email)
                  if (resetError) throw resetError
                  setResetSent(true)
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to send reset email.")
                } finally {
                  setResetLoading(false)
                }
              }}
              className="font-medium text-primary underline hover:no-underline disabled:opacity-60"
            >
              {resetLoading ? "Sending…" : "Forgot password?"}
            </button>
          )}
        </p>

        <p className="mt-4 text-center text-sm text-primary/70">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary underline hover:no-underline"
          >
            Sign up
          </Link>
        </p>
      </div>
    </main>
  )
}
