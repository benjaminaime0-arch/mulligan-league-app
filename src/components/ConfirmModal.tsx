"use client"

import { useEffect, useRef } from "react"

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Continue",
  cancelLabel = "Cancel",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      cancelRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel()
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, loading, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/40"
        onClick={() => { if (!loading) onCancel() }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative w-full max-w-sm rounded-2xl border border-primary/15 bg-white p-6 shadow-lg"
      >
        <h2 id="confirm-title" className="text-lg font-bold text-primary">
          {title}
        </h2>
        <p className="mt-2 text-sm text-primary/70">{message}</p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-cream transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
          >
            {loading ? "Working…" : confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
