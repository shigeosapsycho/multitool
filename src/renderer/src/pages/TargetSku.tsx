import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { StatusBanner, Stat } from '../components/StatusBanner'
import { Card } from '../components/Card'
import { Button, Icons } from '../components/ToolShell'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { shortOutputPath } from '../lib/paths'
import {
  BUNDLED_SKUS,
  FORMAT_ENABLED,
  SHIKARI_MONITOR_MAX,
  buildGroups,
  chunkEvenly,
  detectFormat,
  fetchRemoteSkus,
  formatSkus,
  moveSkuToIndex,
  parseSkuList,
  rowDisplayName,
  type ExportFormat,
  type GroupingMode,
  type SkuEntry,
  type SkuGroup
} from '../lib/targetSkus'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
  pokemonGrouping: GroupingMode
  /** Append newly checked SKUs in check order (true) or catalog order (false). */
  orderBySelectDate: boolean
}

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'refract', label: 'Refract' },
  { id: 'shikari', label: 'Shikari' },
  { id: 'stellar', label: 'Stellar' }
]

/** Target product page for a SKU. */
const TARGET_URL = 'https://www.target.com/p/-/A-'

/** localStorage key for the persisted SKU selection (in export order). */
const SELECTION_STORAGE_KEY = 'target-sku:selection'

// Colors assigned, in order, to listings that have more than one selected SKU,
// so SKUs belonging to the same listing share a color in the Order tab. Chosen
// to read clearly on the dark surface.
const LISTING_PALETTE = [
  '#60a5fa',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#a78bfa',
  '#22d3ee',
  '#fb7185',
  '#a3e635',
  '#f59e0b',
  '#c084fc',
  '#2dd4bf',
  '#818cf8'
]

/** Load a persisted SKU list from localStorage; [] when missing or unreadable. */
function loadSavedSkus(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string')
      : []
  } catch {
    return []
  }
}

/** Human "updated N ago" phrasing for a past timestamp. */
function agoLabel(since: number): string {
  const secs = Math.max(0, Math.round((Date.now() - since) / 1000))
  if (secs < 60) return 'Updated just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `Updated ${mins}m ago`
  return `Updated ${Math.floor(mins / 60)}h ago`
}

/**
 * Catalog freshness label (search bar, right side). Owns the 30s tick that
 * keeps "updated N ago" current, so the timer re-renders only this label —
 * not the whole page — and stops entirely while the page is hidden.
 */
function SyncLabel({
  active,
  syncing,
  syncFailed,
  lastSync
}: {
  active: boolean
  syncing: boolean
  syncFailed: boolean
  lastSync: number | null
}) {
  // Bumped on a timer so the label keeps ticking between catalog pulls.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [active])

  const label = syncing
    ? 'Syncing…'
    : syncFailed
      ? 'Offline'
      : lastSync !== null
        ? agoLabel(lastSync)
        : 'Syncing…'

  return (
    <span
      className={`shrink-0 text-[11px] ${syncFailed ? 'text-warning' : 'text-text-muted'}`}
    >
      {label}
    </span>
  )
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <circle cx="11" cy="11" r="6.5" />
    <line x1="20" y1="20" x2="16" y2="16" />
  </svg>
)

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M14 3h7v7" />
    <path d="M21 3 11 13" />
    <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
  </svg>
)

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

/** Six-dot grip handle shown on draggable Order-tab rows. */
const GripIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <circle cx="9" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" />
    <circle cx="15" cy="6" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="15" cy="18" r="1.4" />
  </svg>
)

/** "Send to top" arrow for the Order-tab context menu. */
const ArrowTopIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <line x1="5" y1="4" x2="19" y2="4" />
    <line x1="12" y1="9" x2="12" y2="20" />
    <polyline points="7 14 12 9 17 14" />
  </svg>
)

/** Hash mark for the "Move to position…" Order-tab context-menu action. */
const HashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </svg>
)

/** A single SKU row: checkbox-style toggle plus the SKU and listing name. */
function SkuRow({
  entry,
  checked,
  stripSet,
  onSelect,
  onContextMenu
}: {
  entry: SkuEntry
  checked: boolean
  stripSet: boolean
  onSelect: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className="group flex w-full cursor-pointer select-none items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-2"
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
          checked ? 'border-accent bg-accent text-white' : 'border-border'
        }`}
      >
        {checked && <CheckIcon />}
      </span>
      <span className="w-[92px] shrink-0 font-mono text-[12px] text-text-secondary">
        {entry.sku}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
        {rowDisplayName(entry, stripSet)}
      </span>
    </div>
  )
}

/**
 * A draggable row in the Order tab. Shows its position, the SKU, and the
 * corresponding listing name so it's clear what's being dragged. The whole row
 * is the drag handle; right-click raises the Order context menu.
 */
function ReorderRow({
  index,
  sku,
  name,
  color,
  dragging,
  dragDisabled,
  onPointerDown,
  onContextMenu
}: {
  index: number
  sku: string
  name: string
  /** Listing color, set only when this SKU shares its listing with another. */
  color?: string
  dragging: boolean
  /** While a search filter is active, drag is off — the visible subset can't
   * map back onto the full `order`, so reordering is done via right-click. */
  dragDisabled?: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onPointerDown={dragDisabled ? undefined : onPointerDown}
      onContextMenu={onContextMenu}
      className={`flex touch-none select-none items-center gap-2.5 rounded-md border px-2 py-1 transition-[transform,box-shadow,background-color] duration-150 ${
        dragDisabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
      } ${
        dragging
          ? 'relative z-10 scale-[1.02] border-accent bg-accent-soft shadow-lg'
          : 'border-transparent hover:bg-surface-2'
      }`}
    >
      <span className={`shrink-0 text-text-muted ${dragDisabled ? 'opacity-40' : ''}`}>
        <GripIcon />
      </span>
      <span className="w-5 shrink-0 text-right font-mono text-[11px] text-text-muted">
        {index + 1}
      </span>
      <span
        className={`w-[88px] shrink-0 font-mono text-[12px] ${
          color ? 'font-bold' : 'text-text-secondary'
        }`}
        style={color ? { color } : undefined}
      >
        {sku}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-[12.5px] ${
          color ? 'font-semibold' : 'text-text-primary'
        }`}
        style={color ? { color } : undefined}
      >
        {name}
      </span>
    </div>
  )
}

/**
 * One labeled export box. Editable when `onChange` is given, read-only
 * otherwise. Owns its own Copy / Save controls and saved-path note.
 */
function ExportSection({
  label,
  value,
  onChange,
  placeholder,
  taskName,
  topBorder,
  onSaved,
  invalidCount,
  onRemoveInvalid
}: {
  label?: string
  value: string
  onChange?: (next: string) => void
  placeholder?: string
  taskName: string
  topBorder?: boolean
  onSaved?: (path: string) => void
  /** Count of draft SKUs not in the catalog. Shows the "Remove invalid" button. */
  invalidCount?: number
  onRemoveInvalid?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)

  // A changed value voids the "Saved to …" note — it no longer matches.
  useEffect(() => {
    setSavedTo(null)
  }, [value])

  const has = value.trim().length > 0

  async function copy() {
    if (!has) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
  }

  async function save() {
    if (!has) return
    const path = await window.api.files.writeOutput(taskName, value + '\n')
    setSavedTo(path)
    onSaved?.(path)
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${topBorder ? 'border-t border-border' : ''}`}
    >
      {label && (
        <div className="shrink-0 px-4 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
          {label}
        </div>
      )}
      <textarea
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={!onChange}
        spellCheck={false}
        placeholder={placeholder}
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
      />
      <div className="flex items-center gap-2 border-t border-border p-3">
        {savedTo ? (
          <span className="flex-1 truncate text-[12px] text-text-secondary">
            Saved to <span className="text-text-primary">{shortOutputPath(savedTo)}</span>
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {onRemoveInvalid && invalidCount ? (
          <Button onClick={onRemoveInvalid} variant="ghost">
            <Icons.Trash />
            Remove {invalidCount} invalid
          </Button>
        ) : null}
        <Button onClick={copy} variant="ghost" disabled={!has}>
          <Icons.Copy />
          {copied ? 'Copied!' : 'Copy'}
        </Button>
        <Button onClick={save} variant="secondary" disabled={!has}>
          <Icons.Save />
          Save
        </Button>
      </div>
    </div>
  )
}

/**
 * The Shikari Monitor export: the Tasks SKUs split into lists of
 * SHIKARI_MONITOR_MAX, rendered one row per list so each can be copied into its
 * own monitor group. Owns Copy-all and Save like ExportSection.
 */
function MonitorSection({
  label,
  lists,
  taskName,
  onSaved
}: {
  label: string
  lists: string[]
  taskName: string
  onSaved?: (path: string) => void
}) {
  // Which row last copied; -1 means the Copy-all button. Cleared after 1.5s.
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const allText = lists.join('\n')
  const has = lists.length > 0

  // A changed list set voids the "Saved to …" note — it no longer matches.
  useEffect(() => {
    setSavedTo(null)
  }, [allText])

  async function copyOne(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx((c) => (c === idx ? null : c)), 1500)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
  }

  async function save() {
    if (!has) return
    const path = await window.api.files.writeOutput(taskName, allText + '\n')
    setSavedTo(path)
    onSaved?.(path)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="flex shrink-0 items-center gap-2 px-4 pt-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">
          {label}
        </span>
        {has && (
          <span className="text-[11px] text-text-muted">
            {lists.length} list{lists.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!has ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
            Selected SKUs split into monitor lists appear here.
          </div>
        ) : (
          lists.map((text, i) => {
            const count = text ? text.split(',').length : 0
            const copied = copiedIdx === i
            return (
              <div
                key={i}
                className="group flex items-center gap-3 rounded-md px-2 py-1.5 transition hover:bg-surface-2"
              >
                <span className="w-[52px] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                  List {i + 1}
                </span>
                <span className="w-9 shrink-0 text-[11px] text-text-muted">{count}</span>
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-secondary"
                  title={text}
                >
                  {text}
                </span>
                <button
                  onClick={() => copyOne(text, i)}
                  className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium transition ${
                    copied
                      ? 'text-accent'
                      : 'text-text-muted opacity-0 hover:bg-surface hover:text-text-primary group-hover:opacity-100'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )
          })
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border p-3">
        {savedTo ? (
          <span className="flex-1 truncate text-[12px] text-text-secondary">
            Saved to <span className="text-text-primary">{shortOutputPath(savedTo)}</span>
          </span>
        ) : (
          <span className="flex-1" />
        )}
        <Button onClick={() => copyOne(allText, -1)} variant="ghost" disabled={!has}>
          <Icons.Copy />
          {copiedIdx === -1 ? 'Copied!' : 'Copy all'}
        </Button>
        <Button onClick={save} variant="secondary" disabled={!has}>
          <Icons.Save />
          Save
        </Button>
      </div>
    </div>
  )
}

export function TargetSkuPage({
  onBack,
  onSetStatus,
  active = true,
  pokemonGrouping,
  orderBySelectDate
}: Props) {
  const [entries, setEntries] = useState<SkuEntry[]>(BUNDLED_SKUS)

  // The selected SKUs in their export order. This array is the single source
  // of truth for ordering: the checklist toggles membership, the Order tab
  // drags rows around, and the export renders from it.
  // Persisted (as an ordered array) so it survives restarts.
  const [order, setOrder] = useState<string[]>(() => loadSavedSkus(SELECTION_STORAGE_KEY))
  // Membership view of `order` for O(1) checkbox lookups.
  const selected = useMemo(() => new Set(order), [order])
  // The export text. Editable — typing here re-checks the matching boxes.
  const [draft, setDraft] = useState(() =>
    formatSkus(loadSavedSkus(SELECTION_STORAGE_KEY), 'shikari')
  )
  // Which sub-tab is showing: the Select checklist or the Order arranger.
  const [tab, setTab] = useState<'select' | 'order'>('select')
  const [query, setQuery] = useState('')
  // Group keys that are collapsed in the checklist.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Last row clicked without Shift — the anchor for Shift-click range selects.
  const [anchor, setAnchor] = useState<string | null>(null)
  // Right-click context menu in the checklist (Select tab).
  const [menu, setMenu] = useState<{ sku: string; x: number; y: number } | null>(null)
  // Right-click context menu in the Order tab.
  const [orderMenu, setOrderMenu] = useState<{ sku: string; x: number; y: number } | null>(
    null
  )
  // Search box on the Reorder tab. Filters the list to matching SKUs while each
  // row keeps its true position number; a non-empty query also disables drag.
  const [orderQuery, setOrderQuery] = useState('')
  // "Move to position…" numeric-input popover (Order tab) and its draft value.
  const [posPrompt, setPosPrompt] = useState<{ sku: string; x: number; y: number } | null>(
    null
  )
  const [posValue, setPosValue] = useState('')
  // Select-all confirm modal (Select tab).
  const [confirmSelectAll, setConfirmSelectAll] = useState(false)
  // "Copied!" flash on the Reorder tab's Copy-list button.
  const [orderCopied, setOrderCopied] = useState(false)
  // Pointer-based drag reorder. HTML5 drag events don't fire under Tauri's
  // OS-level drag-drop, so we hold the dragged SKU and reorder by pointer
  // position. Refs let the window listeners read the latest order without
  // re-subscribing on every move.
  const [dragSku, setDragSku] = useState<string | null>(null)
  const dragSkuRef = useRef<string | null>(null)
  const orderRef = useRef<string[]>(order)
  const listRef = useRef<HTMLDivElement>(null)
  const [format, setFormat] = useState<ExportFormat>('shikari')
  // Catalog sync state: timestamp of the last good remote pull, an in-flight
  // flag, and whether the most recent pull failed (offline / fetch error).
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  // Raw CSV text of the last successful pull. A byte-identical re-fetch skips
  // setEntries, so an unchanged catalog doesn't churn `entries` (and every
  // memo downstream) with a fresh array each minute.
  const lastCsvRef = useRef<string | null>(null)

  const catalogSkus = useMemo(() => new Set(entries.map((e) => e.sku)), [entries])
  // SKU -> entry, for resolving listing names in the Order tab.
  const entryBySku = useMemo(() => new Map(entries.map((e) => [e.sku, e])), [entries])
  // SKU -> catalog position, for inserting new selections in catalog order.
  const catalogIndex = useMemo(() => {
    const m = new Map<string, number>()
    entries.forEach((e, i) => m.set(e.sku, i))
    return m
  }, [entries])

  // SKU -> listing color for the Order tab. Only SKUs whose listing (item
  // title) is shared by another selected SKU get a color; unique listings stay
  // default so the list isn't a rainbow. Colors are assigned by first
  // appearance, cycling the palette.
  const orderColors = useMemo(() => {
    const keyOf = (sku: string) => entryBySku.get(sku)?.item ?? sku
    const counts = new Map<string, number>()
    for (const sku of order) {
      const k = keyOf(sku)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const colorByKey = new Map<string, string>()
    const map = new Map<string, string>()
    let next = 0
    for (const sku of order) {
      const k = keyOf(sku)
      if ((counts.get(k) ?? 0) < 2) continue
      if (!colorByKey.has(k)) {
        colorByKey.set(k, LISTING_PALETTE[next % LISTING_PALETTE.length]!)
        next++
      }
      map.set(sku, colorByKey.get(k)!)
    }
    return map
  }, [order, entryBySku])

  /** Export string for the manual SKU order. */
  function orderToDraft(ord: string[], fmt: ExportFormat): string {
    return formatSkus(ord, fmt)
  }

  // Pull the remote SKU catalog. A failed pull flips the offline badge but
  // keeps whatever list is already loaded (bundled, or a previous pull).
  // An unchanged file is a ~5KB string compare instead of a re-parse +
  // state churn.
  const refreshCatalog = useCallback(() => {
    setSyncing(true)
    fetchRemoteSkus()
      .then(({ text, entries }) => {
        if (text !== lastCsvRef.current) {
          lastCsvRef.current = text
          setEntries(entries)
        }
        setLastSync(Date.now())
        setSyncFailed(false)
      })
      .catch(() => setSyncFailed(true))
      .finally(() => setSyncing(false))
  }, [])

  // Show the bundled list instantly, then keep the catalog fresh while the
  // page is showing: pull the remote copy immediately on becoming active and
  // every minute after. Hidden (keep-alive mounted) pages don't poll.
  useEffect(() => {
    if (!active) return
    refreshCatalog()
    const id = setInterval(refreshCatalog, 60_000)
    return () => clearInterval(id)
  }, [active, refreshCatalog])

  // Persist the order + stars so they survive app restarts. Best-effort —
  // a full or unavailable localStorage just means they aren't remembered.
  useEffect(() => {
    try {
      localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(order))
    } catch {
      // ignore
    }
  }, [order])

  // Keep a ref to the live order for the drag listeners.
  useEffect(() => {
    orderRef.current = order
  }, [order])

  // While a row is held, reorder live as the pointer crosses row midpoints.
  useEffect(() => {
    if (!dragSku) return
    const onMove = (e: PointerEvent) => {
      const sku = dragSkuRef.current
      const container = listRef.current
      if (!sku || !container) return
      const rows = Array.from(container.children) as HTMLElement[]
      if (rows.length === 0) return
      // Insertion slot: index of the first row whose midpoint sits below the
      // pointer, else rows.length (drop at the very end). rows.length-1 here
      // would cap the drop at second-to-last — the can't-reach-bottom bug.
      let target = rows.length
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) {
          target = i
          break
        }
      }
      const cur = orderRef.current
      const from = cur.indexOf(sku)
      if (from === -1) return
      const insertAt = from < target ? target - 1 : target
      if (insertAt === from) return
      const next = [...cur]
      next.splice(from, 1)
      next.splice(insertAt, 0, sku)
      orderRef.current = next
      applyOrder(next)
    }
    const onUp = () => {
      dragSkuRef.current = null
      setDragSku(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragSku])

  // Dismiss either context menu or the position popover on any click, Esc,
  // scroll, or resize. (The popover stops its own clicks from bubbling here.)
  useEffect(() => {
    if (!menu && !orderMenu && !posPrompt) return
    const close = () => {
      setMenu(null)
      setOrderMenu(null)
      setPosPrompt(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, orderMenu, posPrompt])

  // The page stays mounted while hidden (keep-alive). A lingering aria-modal
  // popover would swallow Escape app-wide — the documented overlay misfire — so
  // close all transient overlays the moment the page goes inactive.
  useEffect(() => {
    if (!active) {
      setMenu(null)
      setOrderMenu(null)
      setPosPrompt(null)
    }
  }, [active])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = q
      ? entries.filter(
          (e) => e.sku.toLowerCase().includes(q) || e.item.toLowerCase().includes(q)
        )
      : entries
    return buildGroups(visible, pokemonGrouping)
  }, [entries, query, pokemonGrouping])

  const searching = query.trim() !== ''
  // A group is open when expanded, or always while a search is active.
  const isOpen = (key: string) => searching || !collapsed.has(key)

  /** Every leaf SKU entry under a group, recursing into sub-groups. */
  function leafItems(group: SkuGroup): SkuEntry[] {
    return group.children ? group.children.flatMap(leafItems) : group.items
  }

  // Flat SKU order as currently rendered — used to resolve Shift-click ranges.
  // Collapsed groups (at any level) contribute nothing; their rows aren't shown.
  const visibleOrder = useMemo(() => {
    const walk = (gs: SkuGroup[]): string[] =>
      gs.flatMap((g) => {
        if (!isOpen(g.key)) return []
        return g.children ? walk(g.children) : g.items.map((e) => e.sku)
      })
    return walk(groups)
  }, [groups, searching, collapsed])

  /** Apply a new SKU order and re-render the export to match. */
  function applyOrder(next: string[]) {
    setOrder(next)
    setDraft(orderToDraft(next, format))
  }

  /**
   * Add SKUs to the order, skipping ones already present. By select-date (the
   * default), new SKUs append in the given sequence; otherwise each is inserted
   * at its catalog-order position. Existing entries (incl. manual drags) keep
   * their places.
   */
  function addToOrder(ord: string[], additions: string[]): string[] {
    const next = [...ord]
    for (const s of additions) {
      if (next.includes(s)) continue
      if (orderBySelectDate) {
        next.push(s)
      } else {
        const ci = catalogIndex.get(s) ?? Number.MAX_SAFE_INTEGER
        const at = next.findIndex(
          (x) => (catalogIndex.get(x) ?? Number.MAX_SAFE_INTEGER) > ci
        )
        if (at === -1) next.push(s)
        else next.splice(at, 0, s)
      }
    }
    return next
  }

  // Plain click toggles one SKU and moves the anchor. Shift-click selects every
  // row between the anchor and the clicked row (in displayed order). New SKUs
  // are appended to the end of the order; deselecting drops them.
  function handleRowClick(sku: string, shift: boolean) {
    if (shift && anchor) {
      const a = visibleOrder.indexOf(anchor)
      const b = visibleOrder.indexOf(sku)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        applyOrder(addToOrder(order, visibleOrder.slice(lo, hi + 1)))
        return
      }
    }
    const next = order.includes(sku)
      ? order.filter((s) => s !== sku)
      : addToOrder(order, [sku])
    applyOrder(next)
    setAnchor(sku)
  }

  function setGroup(items: SkuEntry[], on: boolean) {
    if (on) {
      applyOrder(addToOrder(order, items.map((e) => e.sku)))
    } else {
      const remove = new Set(items.map((e) => e.sku))
      applyOrder(order.filter((s) => !remove.has(s)))
    }
  }

  function clearAll() {
    setOrder([])
    setDraft('')
    setAnchor(null)
    setOrderQuery('')
    onSetStatus('Selection cleared')
  }

  // Drop every draft SKU that isn't in the catalog (pasted typos, or SKUs from
  // another store), keeping the valid ones in their current order.
  function removeInvalid() {
    const seen = new Set<string>()
    const next: string[] = []
    for (const s of parseSkuList(draft, detectFormat(draft))) {
      if (catalogSkus.has(s) && !seen.has(s)) {
        seen.add(s)
        next.push(s)
      }
    }
    applyOrder(next)
    onSetStatus('Removed invalid SKUs')
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // User typed/pasted into the Export box: detect the format and rebuild the
  // order from the catalog SKUs found, in the pasted sequence. The raw text is
  // kept as-is so editing never fights the cursor.
  function handleDraftChange(text: string) {
    setDraft(text)
    const fmt = detectFormat(text)
    setFormat(fmt)
    const seen = new Set<string>()
    const next: string[] = []
    for (const token of parseSkuList(text, fmt)) {
      if (catalogSkus.has(token) && !seen.has(token)) {
        seen.add(token)
        next.push(token)
      }
    }
    setOrder(next)
  }

  function handleFormatChange(fmt: ExportFormat) {
    if (!FORMAT_ENABLED[fmt]) return
    setFormat(fmt)
    setDraft(orderToDraft(order, fmt))
  }

  // ----- Order tab drag + menu actions -----

  function startRowDrag(e: React.PointerEvent, sku: string) {
    if (e.button !== 0) return
    e.preventDefault()
    dragSkuRef.current = sku
    setDragSku(sku)
  }

  function moveToTop(sku: string) {
    applyOrder([sku, ...order.filter((s) => s !== sku)])
    setOrderMenu(null)
  }

  function moveToBottom(sku: string) {
    applyOrder([...order.filter((s) => s !== sku), sku])
    setOrderMenu(null)
  }

  // Move a SKU to a 1-based position from the "Move to position…" popover.
  // Invalid / out-of-range input is handled in moveSkuToIndex (no-op / clamp).
  function moveToIndex(sku: string, pos1: number) {
    applyOrder(moveSkuToIndex(order, sku, pos1))
    setPosPrompt(null)
    setPosValue('')
  }

  // Copy the whole reordered list in the format chosen on the Select tab.
  async function copyOrder() {
    if (order.length === 0) return
    try {
      await navigator.clipboard.writeText(formatSkus(order, format))
      setOrderCopied(true)
      setTimeout(() => setOrderCopied(false), 1500)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
  }

  function removeFromOrder(sku: string) {
    applyOrder(order.filter((s) => s !== sku))
    setOrderMenu(null)
  }

  // "Copy SKU" from either context menu: just the one SKU, no formatting.
  async function copySku(sku: string) {
    try {
      await navigator.clipboard.writeText(sku)
      onSetStatus(`Copied ${sku}`)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
    setMenu(null)
    setOrderMenu(null)
  }

  // Shikari Monitor view: the Tasks SKUs split into comma lists, none longer
  // than SHIKARI_MONITOR_MAX — one list per monitor group, each copyable on
  // its own.
  const monitorLists = useMemo(
    () =>
      chunkEvenly(parseSkuList(draft, 'shikari'), SHIKARI_MONITOR_MAX).map((list) =>
        list.join(', ')
      ),
    [draft]
  )

  // Distinct SKUs in the draft that aren't in the catalog — drives the
  // "Remove invalid" button.
  const invalidCount = useMemo(() => {
    const bad = new Set<string>()
    for (const tok of parseSkuList(draft, detectFormat(draft))) {
      if (!catalogSkus.has(tok)) bad.add(tok)
    }
    return bad.size
  }, [draft, catalogSkus])

  // Render one checklist group, recursing into sub-groups (era → set).
  function renderGroup(group: SkuGroup, depth: number): JSX.Element {
    const items = leafItems(group)
    const selectedCount = items.filter((e) => selected.has(e.sku)).length
    const allOn = items.length > 0 && selectedCount === items.length
    const open = isOpen(group.key)
    return (
      <div key={group.key} className={depth === 0 ? 'mb-3 last:mb-0' : ''}>
        <div
          className="flex items-center gap-2 py-1.5 pr-2"
          style={{ paddingLeft: 8 + depth * 18 }}
        >
          <button
            onClick={() => toggleCollapse(group.key)}
            className="flex min-w-0 items-center gap-1.5"
          >
            <span
              className={`text-text-muted transition-transform ${open ? '' : '-rotate-90'}`}
            >
              <ChevronIcon />
            </span>
            <span
              className={
                depth === 0
                  ? 'text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary'
                  : 'text-[12px] font-medium text-text-secondary'
              }
            >
              {group.label}
            </span>
            <span className="text-[11px] text-text-muted">
              {selectedCount}/{items.length}
            </span>
          </button>
          <span className="flex-1" />
          {/* Era groups skip Select all — selection is done per set / per row. */}
          {!group.key.startsWith('era:') && (
            <button
              onClick={() => setGroup(items, !allOn)}
              className="text-[11px] font-medium text-accent transition hover:underline"
            >
              {allOn ? 'Clear' : 'Select all'}
            </button>
          )}
        </div>
        {open &&
          (group.children
            ? group.children.map((child) => renderGroup(child, depth + 1))
            : group.items.map((e) => (
                <div key={e.sku} style={{ paddingLeft: depth * 18 }}>
                  <SkuRow
                    entry={e}
                    checked={selected.has(e.sku)}
                    stripSet={pokemonGrouping !== 'era'}
                    onSelect={(ev) => handleRowClick(e.sku, ev.shiftKey)}
                    onContextMenu={(ev) => {
                      ev.preventDefault()
                      setMenu({ sku: e.sku, x: ev.clientX, y: ev.clientY })
                    }}
                  />
                </div>
              )))}
      </div>
    )
  }

  // Left: the Export box (editable). Right: the SKU checklist.
  const exportCard = (
    <Card label="Export" badge={selected.size}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-1 border-b border-border p-3">
          <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
            {FORMATS.map((f) => {
              const enabled = FORMAT_ENABLED[f.id]
              const isActive = format === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => handleFormatChange(f.id)}
                  disabled={!enabled}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition ${
                    isActive
                      ? 'bg-accent-soft text-accent'
                      : enabled
                        ? 'text-text-secondary hover:text-text-primary'
                        : 'cursor-not-allowed text-text-muted'
                  }`}
                >
                  {f.label}
                  {!enabled && (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                      Soon
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        {format === 'shikari' ? (
          <>
            <ExportSection
              label="Tasks"
              value={draft}
              onChange={handleDraftChange}
              placeholder="Start checking SKUs on the right or paste an existing SKU list"
              taskName="target-skus-shikari-tasks"
              invalidCount={invalidCount}
              onRemoveInvalid={removeInvalid}
              onSaved={(p) => onSetStatus(`Saved to ${shortOutputPath(p)}`)}
            />
            <MonitorSection
              label={`Monitor — lists of ${SHIKARI_MONITOR_MAX} max`}
              lists={monitorLists}
              taskName="target-skus-shikari-monitor"
              onSaved={(p) => onSetStatus(`Saved to ${shortOutputPath(p)}`)}
            />
          </>
        ) : (
          <ExportSection
            value={draft}
            onChange={handleDraftChange}
            placeholder="Start checking SKUs on the right or paste an existing SKU list"
            taskName={`target-skus-${format}`}
            invalidCount={invalidCount}
            onRemoveInvalid={removeInvalid}
            onSaved={(p) => onSetStatus(`Saved to ${shortOutputPath(p)}`)}
          />
        )}
      </div>
    </Card>
  )

  const skuCard = (
    <Card label="SKUs" badge={groups.reduce((n, g) => n + leafItems(g).length, 0)}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="text-text-muted">
            <SearchIcon />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by SKU or item name…"
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
            spellCheck={false}
          />
          <SyncLabel
            active={active}
            syncing={syncing}
            syncFailed={syncFailed}
            lastSync={lastSync}
          />
          <button
            onClick={refreshCatalog}
            disabled={syncing}
            aria-label="Refresh SKU catalog"
            className="shrink-0 rounded p-1 text-text-muted transition hover:bg-surface-2 hover:text-text-primary disabled:opacity-50"
          >
            <span className={syncing ? 'block animate-spin' : 'block'}>
              <RefreshIcon />
            </span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {groups.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
              No SKUs match “{query}”.
            </div>
          ) : (
            groups.map((g) => renderGroup(g, 0))
          )}
        </div>
      </div>
    </Card>
  )

  // Reorder-tab search: filter the list to SKUs whose number or listing name
  // matches, keeping each row's TRUE position index so "#7" stays accurate.
  const orderQ = orderQuery.trim().toLowerCase()
  const visibleRows = useMemo(() => {
    const rows = order.map((sku, index) => ({ sku, index }))
    if (!orderQ) return rows
    return rows.filter(({ sku }) => {
      const item = entryBySku.get(sku)?.item ?? ''
      return sku.toLowerCase().includes(orderQ) || item.toLowerCase().includes(orderQ)
    })
  }, [order, orderQ, entryBySku])

  // Order tab: the selected SKUs as draggable rows, in export order.
  // Order tab card. Not the shared <Card> (which forces h-full and leaves a
  // tall empty box for short lists) — this hugs its rows and only scrolls once
  // the list outgrows the available height.
  const orderCard = (
    <div className="flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-secondary">
          Reorder SKUs
        </span>
      </div>
      {order.length === 0 ? (
        <div className="p-8 text-center text-[13px] text-text-muted">
          No SKUs selected. Check SKUs in the Select tab to arrange them here.
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
            <span className="text-text-muted">
              <SearchIcon />
            </span>
            <input
              value={orderQuery}
              onChange={(e) => setOrderQuery(e.target.value)}
              placeholder="Search selected SKUs by number or name…"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text-primary outline-none placeholder:text-text-muted"
              spellCheck={false}
            />
            {orderQ && (
              <span className="shrink-0 text-[11px] text-text-muted">
                {visibleRows.length} of {order.length}
              </span>
            )}
          </div>
          <div className="shrink-0 border-b border-border px-4 py-2 text-[11px] text-text-muted">
            {orderQ
              ? 'Right-click a row to move it · clear search to drag'
              : 'Drag rows to reorder · right-click for options'}
          </div>
          {visibleRows.length === 0 ? (
            <div className="flex-1 p-8 text-center text-[13px] text-text-muted">
              No selected SKUs match “{orderQuery}”.
            </div>
          ) : (
            <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-2">
              {visibleRows.map(({ sku, index }) => {
                const entry = entryBySku.get(sku)
                return (
                  <ReorderRow
                    key={sku}
                    index={index}
                    sku={sku}
                    name={entry ? rowDisplayName(entry, false) : sku}
                    color={orderColors.get(sku)}
                    dragging={dragSku === sku}
                    dragDisabled={!!orderQ}
                    onPointerDown={(ev) => startRowDrag(ev, sku)}
                    onContextMenu={(ev) => {
                      ev.preventDefault()
                      setOrderMenu({ sku, x: ev.clientX, y: ev.clientY })
                    }}
                  />
                )
              })}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-2 border-t border-border p-3">
            <span className="flex-1 text-[12px] text-text-muted">
              Copies the list in {FORMATS.find((f) => f.id === format)?.label ?? format}{' '}
              format (set on the Select tab).
            </span>
            <Button onClick={copyOrder} variant="secondary" disabled={order.length === 0}>
              <Icons.Copy />
              {orderCopied ? 'Copied!' : 'Copy list'}
            </Button>
          </div>
        </>
      )}
    </div>
  )

  const tabBar = (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      {([
        ['select', 'Select'],
        ['order', 'Reorder SKUs']
      ] as const).map(([id, label]) => {
        const isActive = tab === id
        return (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition ${
              isActive
                ? 'bg-accent-soft text-accent'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Target SKUs"
        onBack={onBack}
        actions={
          <Button onClick={clearAll} variant="ghost" disabled={order.length === 0}>
            <Icons.Trash />
            Clear
          </Button>
        }
      />
      <StatusBanner>
        <Stat value={entries.length.toLocaleString()} label="SKUs in catalog" />
        <Stat value={order.length.toLocaleString()} label="selected" separator={false} />
      </StatusBanner>

      <div className="flex items-center gap-2 px-8 pt-4">
        {tabBar}
        {tab === 'select' && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[12px] text-text-muted">{order.length} selected</span>
            <Button onClick={() => setConfirmSelectAll(true)} variant="secondary">
              Select all
            </Button>
          </div>
        )}
      </div>

      {tab === 'select' ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 px-8 pb-8 pt-3">
          {exportCard}
          {skuCard}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-start justify-center px-8 pb-8 pt-3">
          <div className="flex min-h-0 max-h-full w-full max-w-3xl">{orderCard}</div>
        </div>
      )}

      {menu && (
        <div
          className="fixed z-50 min-w-[150px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-card"
          style={{
            left: Math.min(menu.x, window.innerWidth - 170),
            top: Math.min(menu.y, window.innerHeight - 84)
          }}
        >
          <button
            onClick={() => {
              window.api.files.openUrl(`${TARGET_URL}${menu.sku}`).catch(() => {})
              setMenu(null)
            }}
            className="flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-primary transition hover:bg-surface-2"
          >
            <LinkIcon />
            Open link
          </button>
          <button
            onClick={() => copySku(menu.sku)}
            className="flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-primary transition hover:bg-surface-2"
          >
            <Icons.Copy />
            Copy SKU
          </button>
        </div>
      )}

      {orderMenu && (
        <div
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-card"
          style={{
            left: Math.min(orderMenu.x, window.innerWidth - 180),
            top: Math.min(orderMenu.y, window.innerHeight - 150)
          }}
        >
          <button
            onClick={() => moveToTop(orderMenu.sku)}
            className="flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-primary transition hover:bg-surface-2"
          >
            <ArrowTopIcon />
            Move to top
          </button>
          <button
            onClick={() => moveToBottom(orderMenu.sku)}
            className="flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-primary transition hover:bg-surface-2"
          >
            <span className="inline-flex rotate-180">
              <ArrowTopIcon />
            </span>
            Move to bottom
          </button>
          <button
            onClick={(e) => {
              // Stop the click reaching the window-level dismiss listener, which
              // would clear posPrompt the instant we open it.
              e.stopPropagation()
              setPosValue('')
              setPosPrompt({ sku: orderMenu.sku, x: orderMenu.x, y: orderMenu.y })
              setOrderMenu(null)
            }}
            className="flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-primary transition hover:bg-surface-2"
          >
            <HashIcon />
            Move to position…
          </button>
          <button
            onClick={() => {
              window.api.files.openUrl(`${TARGET_URL}${orderMenu.sku}`).catch(() => {})
              setOrderMenu(null)
            }}
            className="flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-primary transition hover:bg-surface-2"
          >
            <LinkIcon />
            Open link
          </button>
          <button
            onClick={() => copySku(orderMenu.sku)}
            className="flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-primary transition hover:bg-surface-2"
          >
            <Icons.Copy />
            Copy SKU
          </button>
          <button
            onClick={() => removeFromOrder(orderMenu.sku)}
            className="flex w-full select-none items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-text-primary transition hover:bg-surface-2"
          >
            <Icons.Trash />
            Remove
          </button>
        </div>
      )}

      {posPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          // Keep clicks inside the popover from reaching the window-level
          // dismiss listener (both phases — it closes on `click`).
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-50 w-[224px] overflow-hidden rounded-lg border border-border bg-surface p-3 shadow-card"
          style={{
            left: Math.min(posPrompt.x, window.innerWidth - 244),
            top: Math.min(posPrompt.y, window.innerHeight - 130)
          }}
        >
          <div className="mb-2 text-[11px] text-text-muted">
            Move <span className="font-mono text-text-secondary">{posPrompt.sku}</span> (now #
            {order.indexOf(posPrompt.sku) + 1})
          </div>
          <input
            autoFocus
            inputMode="numeric"
            value={posValue}
            onChange={(e) => setPosValue(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                moveToIndex(posPrompt.sku, parseInt(posValue, 10))
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setPosPrompt(null)
                setPosValue('')
              }
            }}
            placeholder={`type a number 1 - ${order.length}`}
            className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              onClick={() => {
                setPosPrompt(null)
                setPosValue('')
              }}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              onClick={() => moveToIndex(posPrompt.sku, parseInt(posValue, 10))}
              variant="secondary"
            >
              Move
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmSelectAll}
        title="Select all SKUs?"
        message="Are you sure? Some SKUs might not be the actual SKUs you want in your list."
        confirmLabel="Select all"
        onConfirm={() => {
          applyOrder(addToOrder(order, entries.map((e) => e.sku)))
          setConfirmSelectAll(false)
          onSetStatus('Selected all SKUs')
        }}
        onCancel={() => setConfirmSelectAll(false)}
      />
    </div>
  )
}
