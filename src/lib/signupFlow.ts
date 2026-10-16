/** Only preserve app-local destinations when returning from an auth email. */
export function signupRedirectPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return null
  try {
    const url = new URL(value, "https://mulligan.invalid")
    if (url.origin !== "https://mulligan.invalid" || url.pathname.startsWith("//")) return null
    return url.pathname + url.search + url.hash
  } catch { return null }
}

export function signupDestination(redirect: string | null): string {
  return signupRedirectPath(redirect) || "/welcome"
}

export function signupConfirmationUrl(origin: string, redirect: string | null): string {
  const url = new URL("/", origin)
  url.searchParams.set("signup", "confirmed")
  const path = signupRedirectPath(redirect)
  if (path) url.searchParams.set("redirect", path)
  return url.toString()
}
