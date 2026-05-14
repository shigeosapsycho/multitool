type Props = {
  message: string
  /** When provided, renders a trailing action button (e.g. "Restart now"). */
  actionLabel?: string
  onAction?: () => void
  actionDisabled?: boolean
}

const UpdateIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

export function StatusBar({ message, actionLabel, onAction, actionDisabled }: Props) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-accent/30 bg-accent-soft px-4 text-[12px] font-medium text-accent">
      <UpdateIcon />
      <span className="flex-1">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
          className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-accent-hover disabled:opacity-60"
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
