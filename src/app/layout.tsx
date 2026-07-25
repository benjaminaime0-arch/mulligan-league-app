import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import "./globals.css"
import { AuthProvider } from "@/components/AuthProvider"
import { I18nProvider } from "@/lib/i18n"
import { ConsentBanner } from "@/components/ConsentBanner"
import { Navbar } from "@/components/Navbar"

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

// Nobel TRIAL — Mulligan brand font. The brand's default tracking (-0.02em)
// is set on `body` in globals.css so every element inherits it without
// per-class repetition; headings opt into tighter values themselves.
//
// NOTE: these files ship the TRIAL cut, which draws a "TRIAL" watermark
// instead of the real glyph for 481 codepoints — most punctuation and every
// accented letter. globals.css carries a generated per-weight/style fallback
// under its OWN family ("nobel-trial-patch"), placed first in the Tailwind
// sans stack. It is no longer keyed to next/font's hashed family, so changing
// the weights or files below cannot silently disable it — but re-run
// scripts/gen_nobel_fallback_range.py if you swap the font files themselves.
const nobel = localFont({
  src: [
    { path: "../../public/fonts/nobel/NobelTRIAL-ExtraLight.otf",       weight: "200", style: "normal" },
    { path: "../../public/fonts/nobel/NobelTRIAL-ExtraLightItalic.otf", weight: "200", style: "italic" },
    { path: "../../public/fonts/nobel/NobelTRIAL-Light.otf",            weight: "300", style: "normal" },
    { path: "../../public/fonts/nobel/NobelTRIAL-LightItalic.otf",      weight: "300", style: "italic" },
    { path: "../../public/fonts/nobel/NobelTRIAL-Book.otf",             weight: "400", style: "normal" },
    { path: "../../public/fonts/nobel/NobelTRIAL-BookItalic.otf",       weight: "400", style: "italic" },
    { path: "../../public/fonts/nobel/NobelTRIAL-Regular.otf",          weight: "500", style: "normal" },
    { path: "../../public/fonts/nobel/NobelTRIAL-RegularItalic.otf",    weight: "500", style: "italic" },
    { path: "../../public/fonts/nobel/NobelTRIAL-Bold.otf",             weight: "700", style: "normal" },
    { path: "../../public/fonts/nobel/NobelTRIAL-BoldItalic.otf",       weight: "700", style: "italic" },
    { path: "../../public/fonts/nobel/NobelTRIAL-Black.otf",            weight: "900", style: "normal" },
    { path: "../../public/fonts/nobel/NobelTRIAL-BlackItalic.otf",      weight: "900", style: "italic" },
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
