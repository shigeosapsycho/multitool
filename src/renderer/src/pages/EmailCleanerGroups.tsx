import { useState } from 'react'
import type { EmailHeader } from '../lib/api'
import { ContextMenu } from '../components/ContextMenu'

export type SenderGroup<T extends EmailHeader = EmailHeader> = {
  /** Stable identity for this group — used as the React key and expand key. */
  key: string
  /** Display name, or the address when the sender has no display name. */
  name: string
  /** The sender address — empty when the group spans several addresses. */
  addr: string
  /** How many distinct sender addresses fall under this group. */
  addrCount: number
  emails: T[]
  totalSize: number
}

/**
 * Group scanned emails by sender, biggest groups first.
 *
 * Senders are keyed by display name when they have one, and by address
 * otherwise. Keying by name merges mail from senders that rotate their From
 * address per message — e.g. iCloud "Hide My Email" relay aliases, where
 * every message from "Best Buy" arrives from a different address.
 */
export function groupBySender<T extends EmailHeader>(emails: T[]): SenderGroup<T>[] {
  type Acc = {
    name: string
    firstAddr: string
    addrKeys: Set<string>
    emails: T[]
    totalSize: number
  }
  const map = new Map<string, Acc>()
  for (const e of emails) {
    const name = e.fromName.trim()
    const addr = e.fromAddr.trim()
    const key = name ? `name:${name.toLowerCase()}` : `addr:${addr.toLowerCase()}`
    let g = map.get(key)
    if (!g) {
      g = {
        name: name || addr || '(unknown sender)',
        firstAddr: addr,
        addrKeys: new Set(),
        emails: [],
        totalSize: 0
      }
      map.set(key, g)
    }
    if (addr) g.addrKeys.add(addr.toLowerCase())
    g.emails.push(e)
    g.totalSize += e.sizeBytes
  }
  return [...map.entries()]
    .map(([key, g]) => ({
      key,
      name: g.name,
      addr: g.addrKeys.size <= 1 ? g.firstAddr : '',
      addrCount: g.addrKeys.size,
      emails: g.emails,
      totalSize: g.totalSize
    }))
    .sort((a, b) => b.emails.length - a.emails.length)
}

/** Human-readable byte size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const CaretIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const EyeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="h-4 w-4"
  >
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

/** Tri-state checkbox: checked, unchecked, or indeterminate (some selected). */
function Check({
  state,
  onClick
}: {
  state: 'on' | 'off' | 'some'
  onClick: () => void
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
        state === 'off'
          ? 'border-border-strong bg-surface'
          : 'border-accent bg-accent text-white'
      }`}
      aria-checked={state === 'on'}
      role="checkbox"
    >
      {state === 'on' && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {state === 'some' && <span className="h-0.5 w-2 rounded bg-white" />}
    </button>
  )
}

type Props = {
  groups: SenderGroup[]
  selected: Set<number>
  expanded: Set<string>
  onToggleGroup: (group: SenderGroup) => void
  onToggleEmail: (uid: number) => void
  onToggleExpand: (addr: string) => void
  onPreview: (email: EmailHeader) => void
}

export function EmailCleanerGroups({
  groups,
  selected,
  expanded,
  onToggleGroup,
  onToggleEmail,
  onToggleExpand,
  onPreview
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; email: EmailHeader } | null>(null)

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {groups.map((g) => {
        const selectedCount = g.emails.filter((e) => selected.has(e.uid)).length
        const groupState: 'on' | 'off' | 'some' =
          selectedCount === 0 ? 'off' : selectedCount === g.emails.length ? 'on' : 'some'
        const isOpen = expanded.has(g.key)
        const subline = g.addr || (g.addrCount > 1 ? `${g.addrCount} addresses` : '')
        return (
          <div key={g.key} className="border-b border-border/60">
            <div
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-surface-2"
              onClick={() => onToggleExpand(g.key)}
            >
              <Check state={groupState} onClick={() => onToggleGroup(g)} />
              <span className="text-text-muted">
                <CaretIcon open={isOpen} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-text-primary">{g.name}</div>
                {subline && (
                  <div className="truncate text-[11px] text-text-muted">{subline}</div>
                )}
              </div>
              <span className="shrink-0 text-[12px] text-text-secondary">
                {g.emails.length} {g.emails.length === 1 ? 'email' : 'emails'}
              </span>
              <span className="w-16 shrink-0 text-right text-[12px] text-text-muted">
                {formatSize(g.totalSize)}
              </span>
            </div>
            {isOpen && (
              <div className="bg-surface-2/40">
                {g.emails.map((e) => (
                  <div
                    key={e.uid}
                    onClick={(ev) => {
                      // Ctrl+click (Cmd+click on macOS) anywhere on the row
                      // toggles the email's selection — a faster multi-select
                      // than aiming for the checkbox.
                      if (ev.ctrlKey || ev.metaKey) onToggleEmail(e.uid)
                    }}
                    onContextMenu={(ev) => {
                      ev.preventDefault()
                      setMenu({ x: ev.clientX, y: ev.clientY, email: e })
                    }}
                    title="Ctrl+click to select · right-click to preview"
                    className="flex select-none items-center gap-2.5 py-1.5 pl-11 pr-3 hover:bg-surface-2"
                  >
                    <Check
                      state={selected.has(e.uid) ? 'on' : 'off'}
                      onClick={() => onToggleEmail(e.uid)}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-secondary">
                      {e.subject || '(no subject)'}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px] text-text-muted">
                      {formatDate(e.dateMs)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-text-muted">
                      {formatSize(e.sizeBytes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: 'Preview email',
              icon: <EyeIcon />,
              onClick: () => onPreview(menu.email)
            }
          ]}
        />
      )}
    </div>
  )
}
