import { useEffect, useState } from 'react'

type Props = {
  title: string
  version: string
}

const Logo = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="currentColor">
    <rect x="3" y="3" width="8" height="8" rx="1.6" opacity="0.4" />
    <rect x="13" y="3" width="8" height="8" rx="1.6" opacity="0.6" />
    <rect x="3" y="13" width="8" height="8" rx="1.6" opacity="0.75" />
    <rect x="13" y="13" width="8" height="8" rx="1.6" />
  </svg>
)

const MinIcon = () => (
  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2"><line x1="2" y1="6" x2="10" y2="6" /></svg>
)
const MaxIcon = () => (
  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="2.5" y="2.5" width="7" height="7" /></svg>
)
const RestoreIcon = () => (
  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="3.5" y="3.5" width="6" height="6" />
    <path d="M3.5 5 V3 H 8" />
  </svg>
)
const CloseIcon = () => (
  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.2"><line x1="2.5" y1="2.5" x2="9.5" y2="9.5" /><line x1="9.5" y1="2.5" x2="2.5" y2="9.5" /></svg>
)

export function TitleBar({ title, version }: Props) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizedChanged(setMaximized)
  }, [])

  return (
    <div
      data-tauri-drag-region
      className="titlebar flex h-9 items-center justify-between border-b border-border bg-bg select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-3">
        <Logo />
        <span data-tauri-drag-region className="text-[13px] font-semibold tracking-tight text-text-primary">
          {title}
        </span>
        <span data-tauri-drag-region className="text-[11px] text-text-muted">v{version}</span>
      </div>
      <div data-tauri-drag-region="false" className="no-drag flex h-full items-center">
        <button
          aria-label="Minimize"
          className="flex h-9 w-11 items-center justify-center text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
          onClick={() => window.api.window.minimize()}
        >
          <MinIcon />
        </button>
        <button
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className="flex h-9 w-11 items-center justify-center text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
          onClick={() => window.api.window.maximize()}
        >
          {maximized ? <RestoreIcon /> : <MaxIcon />}
        </button>
        <button
          aria-label="Close"
          className="flex h-9 w-11 items-center justify-center rounded-tr-lg text-text-secondary transition hover:bg-danger hover:text-white"
          onClick={() => window.api.window.close()}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
