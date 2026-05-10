import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

type Option<T extends string> = { value: T; label: string }

type Props<T extends string> = {
  value: T
  options: Option<T>[]
  onChange: (next: T) => void
  ariaLabel?: string
}

export function Select<T extends string>({ value, options, onChange, ariaLabel }: Props<T>) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; minWidth: number } | null>(
    null
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Position the menu under the trigger when opened, clamped to viewport.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    let left = rect.left
    let top = rect.bottom + 4
    const menuMinWidth = rect.width
    // After mount, fix horizontal overflow.
    setPosition({ left, top, minWidth: menuMinWidth })
    // Once rendered, also nudge if it overflows.
    requestAnimationFrame(() => {
      if (!menuRef.current) return
      const m = menuRef.current.getBoundingClientRect()
      if (m.right > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - m.width - 8)
      }
      if (m.bottom > window.innerHeight - 8) {
        top = Math.max(8, rect.top - m.height - 4)
      }
      setPosition({ left, top, minWidth: menuMinWidth })
    })
  }, [open])

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const click = (e: MouseEvent) => {
      const target = e.target as Node | null
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', click)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', click)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const current = options.find((o) => o.value === value) ?? options[0]

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 min-w-[120px] items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-text-primary transition hover:border-border-strong hover:bg-surface-3"
      >
        <span>{current?.label}</span>
        <span className="text-text-muted">
          <ChevronIcon />
        </span>
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: position.left,
              top: position.top,
              minWidth: position.minWidth
            }}
            className="z-[1000] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
          >
            {options.map((o) => {
              const selected = o.value === value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition hover:bg-surface-2 ${
                    selected ? 'text-accent' : 'text-text-primary'
                  }`}
                >
                  <span>{o.label}</span>
                  {selected && <CheckIcon />}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}
