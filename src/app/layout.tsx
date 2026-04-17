import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import Script from "next/script"
import "./globals.css"
import { Navbar } from "@/components/Navbar"

const GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

const inter = Inter({ subsets: ["latin"] })

export const viewport: Viewport = {
  themeColor: "#0F3D2E",
  viewportFit: "cover",
}

export const metadata: Metadata = {
  title: {
    default: "Mulligan League — Organize Your Golf Group",
    template: "%s | Mulligan League",
  },
  description:
    "Turn your golf group into a real league. Create private leagues, track weekly scores, and compete with friends. Free to use.",
  keywords: [
    "golf league",
    "golf group",
    "golf scoring",
    "golf leaderboard",
    "weekly golf",
    "golf competition",
    "organize golf",
  ],
  metadataBase: new URL("https://app.mulliganleague.com"),
  icons: {
    icon: [
      { url: "/logo-mark.png", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: [{ url: "/logo-mark.png" }],
  },
  openGraph: {
    title: "Mulligan League — Organize Your Golf Group",
    description:
      "Turn your golf group into a real league. Create private leagues, track weekly scores, and compete with friends. Free to use.",
    type: "website",
    siteName: "Mulligan League",
    images: [{ url: "/logo.png", width: 1024, height: 1024, alt: "Mulligan League" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mulligan League — Organize Your Golf Group",
    description:
      "Turn your golf group into a real league. Create private leagues, track weekly scores, and compete with friends. Free to use.",
    images: ["/logo.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.className} min-h-screen bg-cream text-primary antialiased`}
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
