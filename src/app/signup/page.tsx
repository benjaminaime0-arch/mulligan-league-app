"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    club: "",
    handicap: "",
  })

  const validate = () => {
    const errors: Record<string, string> = {}
    if (!formData.firstName.trim()) errors.firstName = "First name is required"
    if (!formData.lastName.trim()) errors.lastName = "Last name is required"
    if (!formData.email.trim()) errors.email = "Email is required"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = "Please enter a valid email"
    }
    if (!formData.password) errors.password = "Password is required"
    else if (formData.password.length < 6) {
      errors.password = "Password must be at least 6 characters"
    }
    if (formData.handicap) {
      const h = parseFloat(formData.handicap)
      if (isNaN(h) || h < 0 || h > 54) {
        errors.handicap = "Handicap must be between 0 and 54"
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
          data: {
            first_name: formData.firstName.trim(),
            last_name: formData.lastName.trim(),
            club: formData.club.trim() || undefined,
            handicap: formData.handicap ? parseFloat(formData.handicap) : undefined,
          },
        },
      })

      if (signUpError) throw signUpError

      router.push("/dashboard")
      router.refresh()
    } catch (err) {
      // Debug: log full error object
      console.error("[signup] Full error:", err)
      console.error("[signup] Error details:", {
        message: err instanceof Error ? err.message : String(err),
        cause: err instanceof Error ? err.cause : undefined,
        stack: err instanceof Error ? err.stack : undefined,
        raw: err,
      })
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <h1 className="mb-2 text-2xl font-bold text-primary">Create Account</h1>
        <p className="mb-8 text-primary/70">
          Join Mulligan League to start competing
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
              htmlFor="firstName"
              className="mb-1 block text-sm font-medium text-primary"
            >
              First name
            </label>
            <input
              id="firstName"
              type="text"
              value={formData.firstName}
              onChange={(e) =>
                setFormData((p) => ({ ...p, firstName: e.target.value }))
              }
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="John"
              autoComplete="given-name"
              disabled={loading}
            />
            {fieldErrors.firstName && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.firstName}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="lastName"
              className="mb-1 block text-sm font-medium text-primary"
            >
              Last name
            </label>
            <input
              id="lastName"
              type="text"
              value={formData.lastName}
              onChange={(e) =>
                setFormData((p) => ({ ...p, lastName: e.target.value }))
              }
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Smith"
              autoComplete="family-name"
              disabled={loading}
            />
            {fieldErrors.lastName && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.lastName}</p>
            )}
          </div>

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
              autoComplete="new-password"
              disabled={loading}
            />
            {fieldErrors.password && (
              <p className="mt-1 text-sm text-red-600">{fieldErrors.password}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="club"
              className="mb-1 block text-sm font-medium text-primary"
            >
              Home golf club
            </label>
            <input
              id="club"
              type="text"
              value={formData.club}
              onChange={(e) =>
                setFormData((p) => ({ ...p, club: e.target.value }))
              }
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Pebble Beach Golf Links"
              disabled={loading}
            />
          </div>

          <div>
            <label
              htmlFor="handicap"
              className="mb-1 block text-sm font-medium text-primary"
            >
              Handicap <span className="font-normal text-primary/60">(optional, 0–54)</span>
            </label>
            <input
              id="handicap"
              type="number"
              min={0}
              max={54}
              step={0.1}
              value={formData.handicap}
              onChange={(e) =>
                setFormData((p) => ({ ...p, handicap: e.target.value }))
              }
              className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
            className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <p className="mt-8 text-center text-sm text-primary/70">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline hover:no-underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </main>
  )
}
