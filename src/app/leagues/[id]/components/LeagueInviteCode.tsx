interface LeagueInviteCodeProps {
  inviteCode: string
  leagueName: string
  /** "desktop" shows inline next to title, "mobile" shows centered block, "bottom" always visible */
  variant: "desktop" | "mobile" | "bottom"
}

export function LeagueInviteCode({ inviteCode, leagueName, variant }: LeagueInviteCodeProps) {
  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(inviteCode)
    } catch {
      // ignore
    }
  }

  const handleShare = async () => {
    const joinUrl = `${window.location.origin}/leagues/join?code=${inviteCode}`
    const message = `Join my golf league "${leagueName}" on Mulligan League!\n${joinUrl}`
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: message, url: joinUrl })
      } catch {
        // user cancelled or share failed
      }
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(message)
      } catch {
        // ignore
      }
    }
  }

  const containerClass =
    variant === "desktop"
      ? "ml-2 hidden items-center justify-center gap-2 sm:flex"
      : variant === "mobile"
      ? "flex items-center justify-center gap-2 sm:hidden"
      : "flex items-center justify-center gap-2"

  return (
    <div className={containerClass}>
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-md bg-primary/10 px-2.5 py-1 font-mono text-sm tracking-[0.15em] text-primary hover:bg-primary/15"
        title={variant === "mobile" ? "Tap to copy invite code" : "Click to copy invite code"}
      >
        {inviteCode}
      </button>
      <button
        type="button"
        onClick={handleShare}
        className="inline-flex items-center justify-center rounded-lg border border-primary/30 bg-white px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
      >
        Share Invite
      </button>
    </div>
  )
}
