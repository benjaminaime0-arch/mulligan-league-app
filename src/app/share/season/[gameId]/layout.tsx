import type { Metadata } from "next"

/**
 * OG/Twitter metadata for the public season-recap share page (Phase G).
 * Mirrors share/round: relative image path, static copy, no data fetch.
 */
export function generateMetadata({ params }: { params: { gameId: string } }): Metadata {
  const image = `/api/og/season/${params.gameId}`
  return {
    title: "Récap de saison — Mulligan",
    description: "Le podium et les moments forts de la saison sur Mulligan.",
    openGraph: {
      title: "Récap de saison — Mulligan",
      description: "Le podium et les moments forts de la saison.",
      images: [{ url: image, width: 1080, height: 1080 }],
    },
    twitter: { card: "summary_large_image", images: [image] },
  }
}

export default function ShareSeasonLayout({ children }: { children: React.ReactNode }) {
  return children
}
