"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  DEFAULT_LOCALE,
  LOCALES,
  dictionaries,
  type Locale,
} from "./dictionaries"

/**
 * Minimal i18n runtime (T1.7) — no dependency, no bundle cost beyond the
 * dictionaries themselves.
 *
 * Resolution order for a key:
 *   active locale → English fallback → the key itself
 * so a missing translation degrades to readable English rather than a blank
 * or a crash.
 *
 * Locale is chosen on first load from (1) a stored preference, (2) the
 * browser's language, (3) French. It is persisted to localStorage and mirrored
 * onto <html lang> for a11y and SEO.
 */

const STORAGE_KEY = "mulligan.locale"

type I18nValue = {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function interpolate(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, k) =>
    k in vars ? String(vars[k]) : m,
  )
}

function detectLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored && (LOCALES as string[]).includes(stored)) return stored as Locale
  const nav = window.navigator?.language?.slice(0, 2).toLowerCase()
  if (nav && (LOCALES as string[]).includes(nav)) return nav as Locale
  return DEFAULT_LOCALE
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Server and first client render must agree, so start at the default and
  // adopt the detected locale in an effect (avoids hydration mismatch).
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    const detected = detectLocale()
    if (detected !== locale) setLocaleState(detected)
    document.documentElement.lang = detected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    try {
      window.localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // private mode / storage disabled — the choice just won't persist
    }
    document.documentElement.lang = l
  }, [])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const active = dictionaries[locale]?.[key]
      const fallback = dictionaries.en[key]
      return interpolate(active ?? fallback ?? key, vars)
    },
    [locale],
  )

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/**
 * Access the translator. Safe outside the provider (falls back to English)
 * so a component can't crash a page just because it rendered somewhere the
 * provider isn't mounted.
 */
export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (ctx) return ctx
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key, vars) => interpolate(dictionaries.en[key] ?? key, vars),
  }
}

/** Shorthand for the common case. */
export function useT() {
  return useI18n().t
}

export type { Locale }
