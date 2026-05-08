import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ContextMenuItem = {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  separatorAfter?: boolean
}

type Props = {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Adjust if the menu would overflow the right or bottom of the viewport.
  useLayoutEffect(() => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - rect.width - 8)
    }
    if (top + rect.height > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - rect.height - 8)
    }
    setPosition({ left, top })
  }, [x, y])

  // Dismiss on outside interaction. Defer attaching listeners so that the
  // very click that *opened* the menu doesn't immediately close it.
  useEffect(() => {
    const close = () => onClose()
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', close)
      document.addEventListener('contextmenu', close)
      document.addEventListener('scroll', close, true)
      document.addEventListener('keydown', keyHandler)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('contextmenu', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[1000] min-w-[180px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {items.map((item, i) => (
        <div key={i}>
          <button
            role="menuitem"
            onClick={() => {
              item.onClick()
              onClose()
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition hover:bg-surface-2 ${
              item.danger
                ? 'text-danger hover:bg-danger/10'
                : 'text-text-primary'
            }`}
          >
            {item.icon && <span className="flex h-4 w-4 items-center justify-center">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
          </button>
          {item.separatorAfter && i < items.length - 1 && (
            <div className="my-1 border-t border-border" />
          )}
        </div>
      ))}
    </div>,
    document.body
  )
}
