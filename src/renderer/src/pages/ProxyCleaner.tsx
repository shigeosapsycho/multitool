import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SingleFileTool } from './SingleFileTool'
import { Button } from '../components/ToolShell'
import { filterProxies, detectProviders, detectIspUsers, type ProxyFilters } from '../lib/proxy'
import { setPendingProxies } from '../lib/pending'
import type { Route } from '../types'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  onNavigate: (route: Route) => void
  active?: boolean
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
)

/** A single on/off filter chip, styled to match ModeToggle's segments. */
function FilterChip({
  active,
  onToggle,
  onContextMenu,
  title,
  children
}: {
  active: boolean
  onToggle: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      onContextMenu={onContextMenu}
      title={title}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition ${
        active ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${
        active ? 'border-accent bg-accent text-bg' : 'border-border'
      }`}>
        {active && <CheckIcon />}
      </span>
      {children}
    </button>
  )
}

/**
 * Right-click popover for capping how many proxies each provider keeps.
 * One number input per detected provider; blank means uncapped. Positioning
 * and dismiss behavior mirror components/ContextMenu.tsx.
 */
function ProviderLimitsPopover({
  x,
  y,
  providers,
  limits,
  onApply,
  onClose
}: {
  x: number
  y: number
  providers: { provider: string; count: number }[]
  limits: Map<string, number>
  onApply: (limits: Map<string, number>) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const { provider } of providers) {
      const limit = limits.get(provider)
      init[provider] = limit != null ? String(limit) : ''
    }
    return init
  })

  // Adjust if the popover would overflow the right or bottom of the viewport.
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

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Dismiss on outside interaction. Defer attaching listeners so that the
  // very click that *opened* the popover doesn't immediately close it.
  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Consume the key so App's Escape-to-Tools handler doesn't also fire.
        e.stopPropagation()
        onClose()
      }
    }
    // No 'contextmenu' close listener: an outside right-click already closes
    // via its mousedown, and the page handler then reopens at the new spot.
    const id = window.setTimeout(() => {
      document.addEventListener('mousedown', close)
      document.addEventListener('scroll', close, true)
      document.addEventListener('keydown', keyHandler)
    }, 0)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [onClose])

  // Number() (not parseInt) so '2e3' reads as 2000, and '2.5' is rejected
  // outright instead of silently truncating. Blank means "no cap".
  const parsedOf = (v: string): number | null => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 ? n : null
  }
  const allValid = Object.values(values).every((v) => v.trim() === '' || parsedOf(v) != null)

  function apply() {
    if (!allValid) return
    const next = new Map<string, number>()
    for (const [provider, v] of Object.entries(values)) {
      const n = parsedOf(v)
      if (v.trim() !== '' && n != null) next.set(provider, n)
    }
    onApply(next)
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      // dialog + aria-modal is the contract App.tsx's Escape-to-Tools handler
      // yields to (same as ConfirmDialog).
      role="dialog"
      aria-modal="true"
      className="fixed z-[1000] w-[270px] rounded-lg border border-border bg-surface p-3 shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
      style={{ left: position.left, top: position.top }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="pb-2 text-[12px] font-medium text-text-secondary">
        Max proxies per provider
      </div>
      {providers.length === 0 ? (
        <div className="pb-1 text-[12px] text-text-muted">
          No providers detected, load a proxy list first.
        </div>
      ) : (
        <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {providers.map(({ provider, count }, i) => (
            <label key={provider} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
                {provider}
                <span className="pl-1 text-[11px] text-text-muted">· {count.toLocaleString()}</span>
              </span>
              <input
                ref={i === 0 ? inputRef : undefined}
                type="number"
                min={1}
                value={values[provider] ?? ''}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [provider]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply()
                }}
                placeholder="all"
                className="h-7 w-16 shrink-0 rounded-md border border-border bg-bg px-2 text-[12.5px] text-text-primary outline-none focus:border-accent"
              />
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center justify-end gap-1.5 pt-2.5">
        {limits.size > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              onApply(new Map())
              onClose()
            }}
          >
            Clear
          </Button>
        )}
        {providers.length > 0 && (
          <Button variant="primary" disabled={!allValid} onClick={apply}>
            Filter
          </Button>
        )}
      </div>
    </div>,
    document.body
  )
}

export function ProxyCleanerPage({ onBack, onSetStatus, onNavigate, active }: Props) {
  const [filters, setFilters] = useState<ProxyFilters>({ residential: true, isp: true })
  const [content, setContent] = useState('')
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [removedUsers, setRemovedUsers] = useState<Set<string>>(() => new Set())
  const [providerLimits, setProviderLimits] = useState<Map<string, number>>(() => new Map())
  const [limitPopover, setLimitPopover] = useState<{ x: number; y: number } | null>(null)

  // Pages stay mounted (display:none) while the popover portals to body -
  // close it when the page deactivates (back/forward nav, IPC nav) so it
  // can't float orphaned over another page.
  useEffect(() => {
    if (!active) setLimitPopover(null)
  }, [active])

  const providers = useMemo(() => detectProviders(content), [content])
  const ispUsers = useMemo(() => detectIspUsers(content), [content])

  function toggleProvider(provider: string) {
    setRemoved((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  function toggleIspUser(user: string) {
    setRemovedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(user)) next.delete(user)
      else next.add(user)
      return next
    })
  }

  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="inline-flex items-center gap-1 self-start rounded-lg border border-border bg-surface p-1">
        <FilterChip
          active={filters.residential}
          onToggle={() => setFilters((f) => ({ ...f, residential: !f.residential }))}
        >
          Residential
        </FilterChip>
        <FilterChip
          active={filters.isp}
          onToggle={() => setFilters((f) => ({ ...f, isp: !f.isp }))}
        >
          ISPs
        </FilterChip>
      </div>
      {providers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="pr-1 text-[12px] text-text-muted">Providers:</span>
          {providers.map(({ provider, count }) => (
            <FilterChip
              key={provider}
              active={!removed.has(provider)}
              onToggle={() => toggleProvider(provider)}
              title="Right-click to cap how many proxies this provider keeps"
            >
              {provider} · {count.toLocaleString()}
              {providerLimits.has(provider) &&
                ` · max ${providerLimits.get(provider)!.toLocaleString()}`}
            </FilterChip>
          ))}
        </div>
      )}
      {ispUsers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="pr-1 text-[12px] text-text-muted">ISP users:</span>
          {ispUsers.map(({ user, count }) => (
            <FilterChip
              key={user}
              active={!removedUsers.has(user)}
              onToggle={() => toggleIspUser(user)}
            >
              {user} · {count.toLocaleString()}
            </FilterChip>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* display:contents, no layout box, but right-click anywhere on the
          page bubbles here and opens the limit popover at the cursor. */}
      <div
        className="contents"
        onContextMenu={(e) => {
          e.preventDefault()
          setLimitPopover({ x: e.clientX, y: e.clientY })
        }}
      >
      <SingleFileTool
        title="Proxy Cleaner"
        hint="Keep Residential or ISP proxies. Use the header chips to remove providers or accounts, or right-click to cap a provider."
        taskName="filtered-proxies"
        inputLabel="Proxy List"
        resultLabel="Filtered Proxies"
        resultUnit="proxies"
        emptyResultMessage="No proxies matched the selected filters."
        runLabel="Filter Proxies"
        transform={(text) => filterProxies(text, filters, removed, removedUsers, providerLimits)}
        pickerTitle="Select a proxy list"
        toolbar={toolbar}
        onContentChange={setContent}
        resultActions={(results) => (
          <Button
            variant="secondary"
            onClick={() => {
              setPendingProxies(results.join('\n') + '\n')
              onNavigate('proxy-tester')
            }}
          >
            <SendIcon />
            Send to Proxy Tester
          </Button>
        )}
        active={active}
        onBack={onBack}
        onSetStatus={onSetStatus}
      />
      </div>
      {limitPopover && (
        <ProviderLimitsPopover
          x={limitPopover.x}
          y={limitPopover.y}
          providers={providers}
          limits={providerLimits}
          onApply={setProviderLimits}
          onClose={() => setLimitPopover(null)}
        />
      )}
    </>
  )
}
