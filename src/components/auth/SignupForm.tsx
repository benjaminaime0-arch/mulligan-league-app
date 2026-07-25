"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"

export function SignupForm() {
  const router = useRouter()
  // Honour `?redirect=` so an invite link (/join/[code]) returns the new
  // user straight to the game they were invited to (T1.3).
  const redirectTo = useSearchParams().get("redirect")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

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
    if (!username) errors.username = "Username is required"
    else if (username.length < 3) errors.username = "Username must be at least 3 characters"
    else if (!/^[a-zA-Z0-9]+$/.test(username)) errors.username = "Letters and numbers only"
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
    if (formData.password && formData.confirmPassword !== formData.password) {
      errors.confirmPassword = "Passwords do not match"
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
      const { error: signUpError } = await supabase.auth.signUp({
        email: formData.email.trim(),
        password: formData.password,
        options: {
          // Email confirmation links bring users back to the home page
          // (where the tabbed auth surface lives). Supabase JS auto-
          // handles the access_token in the URL hash and creates a
          // session, after which page.tsx's getSession effect routes
          // to /profile.
          emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/` : undefined,
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
          throw new Error("This username is already taken. Please choose another.")
        }
        throw signUpError
      }

      // New accounts go through onboarding unless an invite is pending.
      router.push(redirectTo || "/welcome")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="signup-username" className="mb-1 block text-sm font-medium text-primary">
            Username
          </label>
          <input
            id="signup-username"
            type="text"
            value={formData.username}
            onChange={(e) =>
              setFormData((p) => ({ ...p, username: e.target.value.replace(/[^a-zA-Z0-9]/g, "") }))
            }
            className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="JohnnyGolf"
            autoComplete="username"
            maxLength={30}
            disabled={loading}
          />
          <p className="mt-1 text-[11px] text-primary/40">Letters and numbers only</p>
          {fieldErrors.username && (
            <p className="mt-1 text-sm text-red-600">{fieldErrors.username}</p>
          )}
        </div>

        <div>
          <label htmlFor="signup-email" className="mb-1 block text-sm font-medium text-primary">
            Email
          </label>
          <input
            id="signup-email"
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
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="signup-firstName" className="mb-1 block text-sm font-medium text-primary">
            First name
          </label>
          <input
            id="signup-firstName"
            type="text"
            value={formData.firstName}
            onChange={(e) => setFormData((p) => ({ ...p, firstName: e.target.value }))}
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
          <label htmlFor="signup-lastName" className="mb-1 block text-sm font-medium text-primary">
            Last name
          </label>
          <input
            id="signup-lastName"
            type="text"
            value={formData.lastName}
            onChange={(e) => setFormData((p) => ({ ...p, lastName: e.target.value }))}
            className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
        <label htmlFor="signup-password" className="mb-1 block text-sm font-medium text-primary">
          Password
        </label>
        <input
          id="signup-password"
          type="password"
          value={formData.password}
          onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
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
        <label htmlFor="signup-confirmPassword" className="mb-1 block text-sm font-medium text-primary">
          Confirm password
        </label>
        <input
          id="signup-confirmPassword"
          type="password"
          value={formData.confirmPassword}
          onChange={(e) => setFormData((p) => ({ ...p, confirmPassword: e.target.value }))}
          className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="••••••••"
          autoComplete="new-password"
          disabled={loading}
        />
        {fieldErrors.confirmPassword && (
          <p className="mt-1 text-sm text-red-600">{fieldErrors.confirmPassword}</p>
        )}
      </div>

      <div>
        <label htmlFor="signup-club" className="mb-1 block text-sm font-medium text-primary">
          Home golf club <span className="font-normal text-primary/60">(optional)</span>
        </label>
        <input
          id="signup-club"
          type="text"
          value={formData.club}
          onChange={(e) => setFormData((p) => ({ ...p, club: e.target.value }))}
          className="w-full rounded-lg border border-primary/20 bg-cream px-4 py-2.5 text-primary placeholder:text-primary/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Pebble Beach Golf Links"
          disabled={loading}
        />
      </div>

      <div>
        <label htmlFor="signup-handicap" className="mb-1 block text-sm font-medium text-primary">
          Handicap <span className="font-normal text-primary/60">(optional, 0–54)</span>
        </label>
        <input
          id="signup-handicap"
          type="number"
          min={0}
          max={54}
          step={0.1}
          value={formData.handicap}
          onChange={(e) => setFormData((p) => ({ ...p, handicap: e.target.value }))}
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
        className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Creating account…" : "Create Account"}
      </button>
    </form>
  )
}
