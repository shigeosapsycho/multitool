import type { ReactNode } from 'react'

/** Which input shape a merged tool is showing — one file or two. */
export type FileMode = 'single' | 'double'

const FileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <polyline points="14 3 14 8 19 8" />
  </svg>
)

function Segment({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition ${
        active ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

type Props = {
  mode: FileMode
  onChange: (mode: FileMode) => void
}

/**
 * Segmented control to swap a tool between its one-file and two-file layouts.
 * Switching modes swaps the underlying tool shell, so loaded content does not
 * carry over — an explicit, deliberate action.
 */
export function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      <Segment active={mode === 'single'} onClick={() => onChange('single')}>
        <FileIcon />
        1 File
      </Segment>
      <Segment active={mode === 'double'} onClick={() => onChange('double')}>
        <FileIcon />
        2 Files
      </Segment>
    </div>
  )
}
