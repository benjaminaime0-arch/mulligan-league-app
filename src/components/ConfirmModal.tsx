"use client"

import { useEffect, useRef, useId, type ReactNode } from "react"
import { useT } from "@/lib/i18n"

interface ConfirmModalProps {
  open: boolean
  title: string
  message?: string
  children?: ReactNode
  confirmDisabled?: boolean
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  destructive?: boolean
  focusTitle?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  open,
  title,
  message,
  children,
  confirmDisabled = false,
  confirmLabel,
  cancelLabel,
  loading = false,
  destructive = false,
  focusTitle = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const t = useT()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    if (focusTitle) headingRef.current?.focus({ preventScroll: true })
    else cancelRef.current?.focus()
    return () => previous?.focus()
  }, [open, focusTitle])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel()
      if (e.key === "Tab") {
        const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")
        if (!buttons?.length) { e.preventDefault(); return }
        const first = buttons[0], last = buttons[buttons.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-primary/15 bg-white p-6 shadow-lg"
      >
        <h2 ref={headingRef} tabIndex={focusTitle ? -1 : undefined} id={titleId} className="outline-none break-words text-lg font-bold text-primary">
          {title}
        </h2>
        {message && <p className="mt-2 text-sm text-primary/70">{message}</p>}
        {children}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className={`min-h-[44px] flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98] disabled:opacity-60 ${
              destructive
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-primary text-cream hover:bg-primary/90"
            }`}
          >
            {loading ? t("common.loading") : confirmLabel ?? t("common.continue")}
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="min-h-[44px] flex-1 rounded-lg border border-primary/20 bg-white px-4 py-2.5 text-sm font-medium text-primary transition-all hover:bg-primary/5 active:scale-[0.98]"
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  )
}
