import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  icon?: ReactNode
}

const DefaultIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

export function StatusBanner({ children, icon }: Props) {
  return (
    <div className="mx-8 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] text-text-secondary">
      <span className="text-accent">{icon ?? <DefaultIcon />}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

export function Stat({
  value,
  label,
  separator = true
}: {
  value: ReactNode
  label: string
  separator?: boolean
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-semibold text-text-primary">{value}</span>
      <span>{label}</span>
      {separator && <span className="mx-2 text-text-muted">·</span>}
    </span>
  )
}
