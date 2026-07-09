import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { EmailHeader, EmailBody } from '../lib/api'

type Props = {
  email: EmailHeader
  body: EmailBody | null
  loading: boolean
  error: string | null
  onClose: () => void
}

/**
 * Modal popup that previews a single email. The HTML body is rendered inside a
 * fully sandboxed iframe (`sandbox=""`) so scripts and forms in the message
 * cannot run; remote images still load. Falls back to the plain-text part.
 */
export function EmailPreview({ email, body, loading, error, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const date = email.dateMs ? new Date(email.dateMs).toLocaleString() : '-'

  return createPortal(
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold tracking-tight text-text-primary">
              {email.subject || '(no subject)'}
            </h3>
            <p className="mt-0.5 truncate text-[12.5px] text-text-secondary">
              {email.fromName ? `${email.fromName} · ` : ''}
              {email.fromAddr || '(unknown sender)'}
            </p>
            <p className="text-[11.5px] text-text-muted">{date}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
            aria-label="Close preview"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="h-4 w-4"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-[13px] text-text-muted">
              Loading message…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-danger">
              {error}
            </div>
          ) : body?.html ? (
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={body.html}
              className="h-full w-full rounded-md border border-border bg-white"
            />
          ) : body?.text ? (
            <pre className="h-full overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-4 font-mono text-[12.5px] leading-relaxed text-text-primary">
              {body.text}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-text-muted">
              This message has no previewable content.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
