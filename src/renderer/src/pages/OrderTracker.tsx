import { useCallback, useEffect, useRef } from 'react'
import { PageHeader, Button } from '../components/PageHeader'
import { OrderTrackerLogo } from '../components/OrderTrackerLogo'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

const DASHBOARD_URL = 'https://irothordertracker-4.onrender.com/dashboard'

const ExternalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M14 3h7v7" />
    <path d="M21 3 11 13" />
    <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
  </svg>
)

/**
 * Order Tracker is a launcher: it opens the Iroth's Order Tracker dashboard in
 * the system browser. The dashboard opens automatically when the tool is
 * entered, and the button re-opens it.
 */
export function OrderTrackerPage({ onBack, onSetStatus, active = true }: Props) {
  const open = useCallback(() => {
    try {
      // Optional chaining keeps the dev browser (no Tauri shell, no window.api)
      // from throwing; in the packaged app this opens the default browser.
      window.api?.files?.openUrl(DASHBOARD_URL)?.catch(() => {})
    } catch {
      // window.api unavailable outside Tauri — nothing to do.
    }
    onSetStatus('Opened Order Tracker in your browser')
  }, [onSetStatus])

  // Launch the dashboard once per entry. The effect's deps can churn on unrelated App
  // re-renders (onSetStatus is a fresh function each render, so `open` is too), which would
  // otherwise re-fire open() and pop the browser open again a few seconds later. Guard with
  // a ref that only resets when the tool is left, so re-entry opens exactly once again.
  const openedRef = useRef(false)
  useEffect(() => {
    if (active && !openedRef.current) {
      openedRef.current = true
      open()
    } else if (!active) {
      openedRef.current = false
    }
  }, [active, open])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Order Tracker" onBack={onBack} />
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-5 text-center">
          <OrderTrackerLogo className="h-20 w-20 rounded-2xl shadow-card" />
          <div className="space-y-1">
            <div className="text-[16px] font-semibold text-text-primary">
              Iroth&apos;s Order Tracker
            </div>
            <div className="text-[13px] text-text-secondary">
              Opening the dashboard in your browser…
            </div>
          </div>
          <Button onClick={open} variant="primary">
            <ExternalIcon />
            Open Dashboard
          </Button>
          <div className="select-text break-all text-[11px] text-text-muted">{DASHBOARD_URL}</div>
        </div>
      </div>
    </div>
  )
}
