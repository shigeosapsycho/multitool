import type { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  actions?: ReactNode
  onBack?: () => void
}

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

export function PageHeader({ title, subtitle, actions, onBack }: Props) {
  return (
    <div className="flex items-center justify-between gap-4 px-8 pt-7 pb-5">
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface hover:text-text-primary"
            aria-label="Back"
          >
            <BackIcon />
          </button>
        )}
        <div className="select-none">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-text-primary">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-[13px] text-text-secondary">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  )
}

type ButtonProps = {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  /** Native tooltip, e.g. the full error message behind a "Failed" label. */
  title?: string
}

export function Button({ children, onClick, variant = 'secondary', disabled, title }: ButtonProps) {
  const base =
    'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
  const styles =
    variant === 'primary'
      ? 'bg-accent text-white hover:bg-accent-hover shadow-glow-accent'
      : variant === 'ghost'
        ? 'text-text-secondary hover:bg-surface hover:text-text-primary'
        : 'border border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-2'
  return (
    <button onClick={onClick} disabled={disabled} title={title} className={`${base} ${styles}`}>
      {children}
    </button>
  )
}
