"use client"

/**
 * /share/season/[gameId] — public season-recap card (Phase G).
 *
 * Same contract as /share/round: anyone with the link sees the 1080×1080
 * card (the OG route reads with service role; the UUID is the only key),
 * plus native-share / copy-link / download actions. No session gate.
 */

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

export default function ShareSeasonPage() {
  const params = useParams<{ gameId: string }>()
  const gameId = String(params?.gameId ?? "")
  const [origin, setOrigin] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  if (!gameId) return null
  const shareUrl = origin ? `${origin}/share/season/${gameId}` : ""
  const imageUrl = origin ? `${origin}/api/og/season/${gameId}` : ""

  const nativeShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share && shareUrl) {
      try {
        await navigator.share({ url: shareUrl })
        return
      } catch {
        /* fall through */
      }
    }
    await copyLink()
  }
  const copyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center px-4 py-10">
      <h1 className="text-xl font-bold text-primary">Récap de saison</h1>
      <p className="mt-1 text-sm text-primary/60">
        Toute personne disposant du lien peut voir cette carte.
      </p>

      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="Carte récap de saison"
          width={1080}
          height={1080}
          className="mt-6 w-full rounded-2xl border border-primary/10 shadow-sm"
        />
      )}

      <div className="mt-6 flex w-full flex-col gap-2">
        <button
          type="button"
          onClick={nativeShare}
          className="h-11 w-full rounded-lg bg-primary font-semibold text-cream"
        >
          Partager
        </button>
        <button
          type="button"
          onClick={copyLink}
          className="h-11 w-full rounded-lg border border-primary/20 font-medium text-primary"
        >
          {copied ? "Lien copié !" : "Copier le lien"}
        </button>
        {imageUrl && (
          <a
            href={imageUrl}
            download={`mulligan-saison-${gameId}.png`}
            className="flex h-11 w-full items-center justify-center rounded-lg border border-primary/20 font-medium text-primary"
          >
            Télécharger l&apos;image
          </a>
        )}
      </div>
    </main>
  )
}
