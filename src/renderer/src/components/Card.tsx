import type { ReactNode } from 'react'

type Props = {
  label: string
  badge?: ReactNode
  children: ReactNode
  className?: string
}

export function Card({ label, badge, children, className = '' }: Props) {
  return (
    <div className={`flex flex-col rounded-xl border border-border bg-surface shadow-card ${className}`}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
          {label}
        </span>
        {badge !== undefined && (
          <span className="inline-flex h-6 min-w-[28px] items-center justify-center rounded-full bg-accent-soft px-2 text-[12px] font-medium text-accent">
            {badge}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  )
}
