"use client"

import { Avatar } from "@/components/Avatar"

export type AdminTransferCandidate = {
  user_id: string
  profiles?: {
    username?: string | null
    avatar_url?: string | null
  } | null
}

interface AdminTransferModalProps {
  open: boolean
  /** Candidates (typically: all match players except the leaver). */
  candidates: AdminTransferCandidate[]
  /** Currently-selected candidate user_id. */
  selected: string | null
  onSelect: (userId: string) => void
  onConfirm: (userId: string) => void
  onCancel: () => void
  loading: boolean
}

/**
 * Modal shown when a match admin wants to leave their match — they
 * must hand the admin role to someone else first. Parent owns state
 * (selected, loading) and the RPC call via onConfirm.
 */
export function AdminTransferModal({
  open,
  candidates,
  selected,
  onSelect,
  onConfirm,
  onCancel,
  loading,
}: AdminTransferModalProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40"
        onClick={() => {
          if (!loading) onCancel()
        }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-transfer-title"
        className="relative w-full max-w-sm rounded-2xl border border-primary/15 bg-white p-6 shadow-lg"
      >
        <h2
          id="admin-transfer-title"
          className="text-lg font-bold text-primary"
        >
          Choose a new admin
        </h2>
        <p className="mt-1 text-sm text-primary/70">
          Select a player to take over as match admin before you leave.
        </p>

        <div className="mt-4 space-y-2">
          {candidates.map((p) => {
            const name = p.profiles?.username || "Player"
            const isSelected = selected === p.user_id
            return (
              <button
                key={p.user_id}
                type="button"
                onClick={() => onSelect(p.user_id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-primary/15 bg-white hover:bg-primary/5"
                }`}
              >
                <Avatar
                  src={p.profiles?.avatar_url}
                  alt={`${name}'s avatar`}
                  size={32}
                  fallback={name}
                />
                <span className="text-sm font-medium text-primary">
                  {name}
                </span>
                {isSelected && (
                  <svg
                    className="ml-auto h-5 w-5 text-primary"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (selected) onConfirm(selected)
            }}
            disabled={!selected || loading}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-red-700 active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? "Leaving\u2026" : "Transfer & Leave"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
