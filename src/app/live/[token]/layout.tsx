import type { Metadata } from "next"

/**
 * Public live-spectator page (Phase: live share). noindex on purpose:
 * these are ephemeral, token-scoped URLs shared into group chats —
 * search engines have no business archiving them.
 */
export const metadata: Metadata = {
  title: "Partie en direct",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Partie en direct — Mulligan",
    description: "Suivez cette partie de golf en direct sur Mulligan.",
  },
}

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return children
}
