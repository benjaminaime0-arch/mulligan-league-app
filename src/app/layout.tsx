import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { AuthProvider } from "@/components/AuthProvider"
import { I18nProvider } from "@/lib/i18n"
import { ConsentBanner } from "@/components/ConsentBanner"
import { Navbar } from "@/components/Navbar"

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

// Nobel — Mulligan brand font. The brand's default tracking (-0.02em)
// is set on `body` in globals.css so every element inherits it without
// per-class repetition; headings opt into tighter values themselves.
//
// These are SUBSET WOFF2 files (~7.5KB each, was ~155KB OTF) built by
// scripts/build_nobel_woff2.py from the archived TRIAL OTFs in
// assets/fonts/nobel-trial/. The subsets contain ONLY the clean glyphs —
// the 481 codepoints the trial cut watermarks (most punctuation, every
// accented letter) are simply absent, so a "TRIAL" label can no longer
// render from these files at all. Those codepoints are still served by
// the generated "nobel-trial-patch" system-font fallback in globals.css,
// placed FIRST in the Tailwind sans stack — keep it there, and re-run
// both scripts if the source fonts ever change.
const nobel = localFont({
  src: [
    { path: "../fonts/nobel/NobelTRIAL-ExtraLight.woff2",       weight: "200", style: "normal" },
    { path: "../fonts/nobel/NobelTRIAL-ExtraLightItalic.woff2", weight: "200", style: "italic" },
    { path: "../fonts/nobel/NobelTRIAL-Light.woff2",            weight: "300", style: "normal" },
    { path: "../fonts/nobel/NobelTRIAL-LightItalic.woff2",      weight: "300", style: "italic" },
    { path: "../fonts/nobel/NobelTRIAL-Book.woff2",             weight: "400", style: "normal" },
    { path: "../fonts/nobel/NobelTRIAL-BookItalic.woff2",       weight: "400", style: "italic" },
    { path: "../fonts/nobel/NobelTRIAL-Regular.woff2",          weight: "500", style: "normal" },
    { path: "../fonts/nobel/NobelTRIAL-RegularItalic.woff2",    weight: "500", style: "italic" },
    { path: "../fonts/nobel/NobelTRIAL-Bold.woff2",             weight: "700", style: "normal" },
    { path: "../fonts/nobel/NobelTRIAL-BoldItalic.woff2",       weight: "700", style: "italic" },
    { path: "../fonts/nobel/NobelTRIAL-Black.woff2",            weight: "900", style: "normal" },
    { path: "../fonts/nobel/NobelTRIAL-BlackItalic.woff2",      weight: "900", style: "italic" },
  ],
  variable: "--font-nobel",
  display: "swap",
})

export const viewport: Viewport = {
  themeColor: "#0F3D2E",
  viewportFit: "cover",
}

export const metadata: Metadata = {
  title: {
    default: "Mulligan — Organize Your Golf Group",
    template: "%s | Mulligan",
  },
  description:
    "Turn your golf group into a real game. Create private games, track weekly scores, and compete with friends. Free to use.",
  keywords: [
    "golf game",
    "golf group",
    "golf scoring",
    "golf leaderboard",
    "weekly golf",
    "golf competition",
    "organize golf",
  ],
  // Reads NEXT_PUBLIC_SITE_URL from env (set in Vercel project settings)
  // with a fallback to the app subdomain. Apex mulliganclub.co is the
  // Webflow marketing site; the Next.js app lives at app.mulliganclub.co.
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
    title: "Mulligan — Organize Your Golf Group",
    description:
      "Turn your golf group into a real game. Create private games, track weekly scores, and compete with friends. Free to use.",
    type: "website",
    siteName: "Mulligan",
    images: [{ url: "/logo.png", width: 1024, height: 1024, alt: "Mulligan" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mulligan — Organize Your Golf Group",
    description:
      "Turn your golf group into a real game. Create private games, track weekly scores, and compete with friends. Free to use.",
    images: ["/logo.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // nobel.variable exposes --font-nobel; the font is applied through Tailwind's
  // `sans` stack (font-sans on <body>), NOT nobel.className. nobel.className
  // hard-sets font-family to next/font's own families, which would bypass the
  // "nobel-trial-patch" entry that must sit first in the stack for the
  // TRIAL-watermark fallback to take effect.
  return (
    <html lang="fr" className={nobel.variable}>
      <body
        className="min-h-screen bg-white font-sans text-primary antialiased"
      >
        <I18nProvider>
          <AuthProvider>
            <Navbar />
            <div className="pb-[4.5rem] md:pb-0">{children}</div>
            {/* GA is loaded from inside the banner, only after consent
                (CNIL) — never on first paint. */}
            <ConsentBanner measurementId={GA_MEASUREMENT_ID} />
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
