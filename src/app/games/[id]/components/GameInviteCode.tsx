"use client"

import { useEffect, useState } from "react"
import { LeaguePlayerInvite } from "@/components/LeaguePlayerInvite"
import { useT } from "@/lib/i18n"

interface GameInviteCodeProps {
  gameId?: string
  inviteCode: string
  gameName: string
  /** "desktop" shows inline next to title, "mobile" shows centered block, "bottom" always visible */
  variant: "desktop" | "mobile" | "bottom"
}

export function GameInviteCode({ gameId, inviteCode, gameName, variant }: GameInviteCodeProps) {
  const t = useT()
  const [feedback, setFeedback] = useState<string | null>(null)
  const [joinUrl, setJoinUrl] = useState("")

  useEffect(() => { setJoinUrl(`${window.location.origin}/join/${encodeURIComponent(inviteCode)}`) }, [inviteCode])

  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) { setFeedback(t("invite.share.failed")); return }
    try {
      await navigator.clipboard.writeText(inviteCode)
      setFeedback(t("invite.code.copied"))
    } catch {
      setFeedback(t("invite.share.failed"))
    }
  }

  const handleShare = async () => {
    // Share the preview URL so friends can return to this invitation after sign-up.
    const joinUrl = `${window.location.origin}/join/${encodeURIComponent(inviteCode)}`
    const message = `${t("invite.share.message.link", { name: gameName })}\n${joinUrl}`
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: message, url: joinUrl })
      } catch {
        // user cancelled or share failed
      }
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(message)
        setFeedback(t("invite.share.copied"))
      } catch {
        setFeedback(t("invite.share.failed"))
      }
    }
  }

  const containerClass =
    variant === "desktop"
      ? "ml-2 hidden items-center justify-center gap-2 sm:flex"
      : variant === "mobile"
      ? "flex items-center justify-center gap-2 sm:hidden"
      : "flex w-full flex-wrap items-center justify-center gap-2"

  return (
    <div className={containerClass}>
      {/* Fixed h-8 on both so they read as a pair and align with the
          h-8 destructive icon button in the Game Settings row. */}
      <button
        type="button"
        onClick={handleCopy}
        className="flex min-h-[44px] items-center rounded-xl bg-primary/10 px-2.5 font-mono text-sm tracking-[0.15em] text-primary hover:bg-primary/15"
        title={t("invite.code.copy.click")}
        aria-label={t("invite.code.copy.click")}
      >
        {inviteCode}
      </button>
      <button
        type="button"
        onClick={handleShare}
        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-white px-3 text-xs font-medium text-primary hover:bg-primary/5"
        aria-label={t("invite.share.cta")}
      >
        {/* Same share-node glyph used elsewhere (match-detail "Share
            score card") so the share affordance reads consistently
            across the app. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
        </svg>
        {t("games.share.cta")}
      </button>
      {joinUrl && <a className="inline-flex min-h-[44px] items-center rounded-xl border border-primary/30 bg-white px-3 text-xs font-medium text-primary hover:bg-primary/5" href={`https://wa.me/?text=${encodeURIComponent(`${t("invite.share.message.link", { name: gameName })}\n${joinUrl}`)}`} target="_blank" rel="noopener noreferrer">{t("invite.share.whatsapp")}</a>}
      {feedback && <p role="status" className="w-full text-center text-xs text-primary">{feedback}</p>}
      {gameId && <LeaguePlayerInvite gameId={gameId} />}
    </div>
  )
}
