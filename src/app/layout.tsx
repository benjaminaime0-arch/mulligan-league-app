import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { AuthProvider } from "@/components/AuthProvider"
import { I18nProvider } from "@/lib/i18n"
import { ConsentBanner } from "@/components/ConsentBanner"
import { CardOfflineSupport } from "@/components/personal/CardOfflineSupport"
import { NotificationReadSync } from "@/components/NotificationReadSync"
import { AppShell } from "@/components/AppShell"

// NEXT_PUBLIC_* values are inlined at build time exactly as stored in the
// env store — including any stray whitespace (a trailing newline in the
// Vercel value shipped a SyntaxError inside the inline gtag config and
// killed analytics for every consenting visitor). Trim, then refuse
// anything that isn't a plausible G-XXXXXXX id: no id → no banner, no GA.
const GA_MEASUREMENT_ID = (() => {
  const raw = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()
  return raw && /^G-[A-Z0-9]{6,}$/.test(raw) ? raw : undefined
})()

// Self-hosted Inter keeps French text, UI labels, and score tables consistent.
const inter = localFont({
  src: [
    { path: "../fonts/inter/InterVariable.woff2", weight: "100 900", style: "normal" },
    { path: "../fonts/inter/InterVariable-Italic.woff2", weight: "100 900", style: "italic" },
  ],
  variable: "--font-inter",
  display: "swap",
})

export const viewport: Viewport = {
  themeColor: "#0F3D2E",
  viewportFit: "cover",
}

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: process.env.VERCEL_ENV === "preview" ? "Mulligan Test" : "Mulligan", statusBarStyle: "default" },
  title: {
    default: "Mulligan — Ligue de golf privée entre amis",
    template: "%s | Mulligan",
  },
  description:
    "Créez votre ligue de golf privée, invitez vos amis et partagez le classement de votre saison. Cartes personnelles sur 9 ou 18 trous.",
  robots: { index: false, follow: true },
  // Reads NEXT_PUBLIC_SITE_URL from env (set in Vercel project settings)
  // with a fallback to the app subdomain. Apex mulliganclub.co is the
  // WordPress marketing site; the Next.js app lives at app.mulliganclub.co.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://app.mulliganclub.co",
  ),
  icons: {
    icon: [
      { url: "/logo-mark.png", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: [{ url: "/logo-mark.png" }],
  },
  openGraph: {
    title: "Mulligan — Ligue de golf privée entre amis",
    description:
      "Créez votre ligue de golf privée, invitez vos amis et partagez le classement de votre saison. Cartes personnelles sur 9 ou 18 trous.",
    type: "website",
    siteName: "Mulligan",
    images: [{ url: "/logo.png", width: 1024, height: 1024, alt: "Mulligan" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mulligan — Ligue de golf privée entre amis",
    description:
      "Créez votre ligue de golf privée, invitez vos amis et partagez le classement de votre saison. Cartes personnelles sur 9 ou 18 trous.",
    images: ["/logo.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body
        className="min-h-screen bg-white font-sans text-primary antialiased"
      >
        <I18nProvider>
          <AuthProvider>
            <CardOfflineSupport />
            <NotificationReadSync />
            <AppShell>{children}</AppShell>
            {/* GA is loaded from inside the banner, only after consent
                (CNIL) — never on first paint. */}
            <ConsentBanner measurementId={GA_MEASUREMENT_ID} />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
