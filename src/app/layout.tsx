import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import Script from "next/script"
import "./globals.css"
import { Navbar } from "@/components/Navbar"

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

// Nobel TRIAL — Mulligan brand font. Letter-spacing default (-0.05em / -50)
// is set globally on `body` in tailwind.config.ts so every element using
// this font inherits the tight tracking without per-class repetition.
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
  return (
    <html lang="en" className={nobel.variable}>
      <body
        className={`${nobel.className} min-h-screen bg-white text-primary antialiased`}
      >
        {GA_MEASUREMENT_ID && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${GA_MEASUREMENT_ID}');
              `}
            </Script>
          </>
        )}
        <Navbar />
        <div className="pb-[4.5rem] md:pb-0">{children}</div>
      </body>
    </html>
  )
}
