import { useState } from "react"

interface InviteCodeSectionProps {
  inviteCode: string
  courseName: string | null | undefined
}

export function InviteCodeSection({ inviteCode, courseName }: InviteCodeSectionProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  const handleShare = async () => {
    const message = `Join my match at ${courseName || "the course"} on Mulligan League! Code: ${inviteCode}`
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: message })
      } catch {
        // user cancelled
      }
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(message)
      } catch {
        // ignore
      }
    }
  }

  return (
    <section className="rounded-xl border border-primary/15 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary/60">Invite Code</p>
          <p className="mt-1 font-mono text-xl tracking-[0.2em] text-primary">{inviteCode}</p>
          <p className="mt-1 text-xs text-primary/60">Send this to your playing partners so they can join.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-cream hover:bg-primary/90"
          >
            {copied ? "Copied!" : "Copy Code"}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="rounded-lg border border-primary/30 bg-white px-4 py-2 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Share Invite
          </button>
        </div>
      </div>
    </section>
  )
}
