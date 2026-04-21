import type { Metadata } from "next"

interface LayoutProps {
  children: React.ReactNode
  params: { matchId: string }
}

/**
 * Per-match OG metadata so link previews in WhatsApp / iMessage /
 * Slack / Twitter render the round card automatically.
 */
export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const imagePath = `/api/og/round/${params.matchId}`

  return {
    title: "Round on Mulligan League",
    description: "Check out this round on Mulligan League.",
    openGraph: {
      title: "Round on Mulligan League",
      description: "Check out this round on Mulligan League.",
      images: [
        {
          url: imagePath,
          width: 1080,
          height: 1080,
          alt: "Round summary card",
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Round on Mulligan League",
      description: "Check out this round on Mulligan League.",
      images: [imagePath],
    },
  }
}

export default function RoundShareLayout({ children }: LayoutProps) {
  return <>{children}</>
}
