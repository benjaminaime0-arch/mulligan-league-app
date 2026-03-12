import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Navbar } from "@/components/Navbar"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Mulligan League",
  description: "Mulligan League App",
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
        <Navbar />
        <div className="pb-20 md:pb-0">{children}</div>
      </body>
    </html>
  )
}
