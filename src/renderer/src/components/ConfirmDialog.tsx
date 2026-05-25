import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  open: boolean
  title: string
  message: ReactNode
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel
}: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={onCancel}
    >
      <div
        className="mx-4 w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-[15px] font-semibold tracking-tight text-text-primary">{title}</h3>
        </div>
        <div className="px-5 py-5">
          <p className="text-[14px] leading-relaxed text-text-primary">{message}</p>
          {detail && (
            <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">{detail}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/40 px-5 py-3">
          <button
            onClick={onCancel}
            autoFocus
            className="inline-flex h-9 items-center rounded-lg border border-border bg-surface-2 px-4 text-[13px] text-text-primary transition hover:bg-surface-3"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`inline-flex h-9 items-center rounded-lg px-4 text-[13px] font-medium text-white transition ${
              danger ? 'bg-danger hover:brightness-110' : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
