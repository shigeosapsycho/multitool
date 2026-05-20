import type { EmailHeader } from '../lib/api'

export type SenderGroup = {
  addr: string
  name: string
  emails: EmailHeader[]
  totalSize: number
}

/** Group scanned emails by sender address, biggest groups first. */
export function groupBySender(emails: EmailHeader[]): SenderGroup[] {
  const map = new Map<string, SenderGroup>()
  for (const e of emails) {
    const key = e.fromAddr.toLowerCase()
    let g = map.get(key)
    if (!g) {
      g = { addr: e.fromAddr || '(unknown sender)', name: e.fromName, emails: [], totalSize: 0 }
      map.set(key, g)
    }
    g.emails.push(e)
    g.totalSize += e.sizeBytes
  }
  return [...map.values()].sort((a, b) => b.emails.length - a.emails.length)
}

/** Human-readable byte size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
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
}

export function EmailCleanerGroups({
  groups,
  selected,
  expanded,
  onToggleGroup,
  onToggleEmail,
  onToggleExpand
}: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {groups.map((g) => {
        const selectedCount = g.emails.filter((e) => selected.has(e.uid)).length
        const groupState: 'on' | 'off' | 'some' =
          selectedCount === 0 ? 'off' : selectedCount === g.emails.length ? 'on' : 'some'
        const isOpen = expanded.has(g.addr)
        return (
          <div key={g.addr} className="border-b border-border/60">
            <div
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-surface-2"
              onClick={() => onToggleExpand(g.addr)}
            >
              <Check state={groupState} onClick={() => onToggleGroup(g)} />
              <span className="text-text-muted">
                <CaretIcon open={isOpen} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-text-primary">
                  {g.name || g.addr}
                </div>
                {g.name && (
                  <div className="truncate text-[11px] text-text-muted">{g.addr}</div>
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
                    title="Ctrl+click to select"
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
    </div>
  )
}
