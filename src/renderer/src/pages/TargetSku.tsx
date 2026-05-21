import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { StatusBanner, Stat } from '../components/StatusBanner'
import { Card } from '../components/Card'
import { Button, Icons } from '../components/ToolShell'
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
}

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'refract', label: 'Refract' },
  { id: 'shikari', label: 'Shikari' },
  { id: 'stellar', label: 'Stellar' }
]

/** Target product page for a SKU. */
const TARGET_URL = 'https://www.target.com/p/-/A-'

/** localStorage key for the persisted SKU selection. */
const SELECTION_STORAGE_KEY = 'target-sku:selection'

/** Load the persisted SKU selection; returns [] when missing or unreadable. */
function loadSavedSelection(): string[] {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY)
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

/** A single SKU row with a checkbox-style toggle. */
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
    <button
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className="flex w-full select-none items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-2"
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
    </button>
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

export function TargetSkuPage({ onBack, onSetStatus, pokemonGrouping }: Props) {
  const [entries, setEntries] = useState<SkuEntry[]>(BUNDLED_SKUS)
  // Selection + export text are restored from localStorage so they survive
  // restarts (see the persist effect below).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(loadSavedSelection()))
  // The export text. Editable — typing here re-checks the matching boxes.
  const [draft, setDraft] = useState(() => formatSkus(loadSavedSelection(), 'shikari'))
  const [query, setQuery] = useState('')
  // Group keys that are collapsed in the checklist.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Last row clicked without Shift — the anchor for Shift-click range selects.
  const [anchor, setAnchor] = useState<string | null>(null)
  // Right-click context menu: which SKU, and where to draw it.
  const [menu, setMenu] = useState<{ sku: string; x: number; y: number } | null>(null)
  const [format, setFormat] = useState<ExportFormat>('shikari')
  // Catalog sync state: timestamp of the last good remote pull, an in-flight
  // flag, and whether the most recent pull failed (offline / fetch error).
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  // Bumped on a timer so the "updated N ago" label keeps ticking between pulls.
  const [, setTick] = useState(0)

  const catalogSkus = useMemo(() => new Set(entries.map((e) => e.sku)), [entries])

  /** Canonical export string for a selection, in catalog order. */
  function selectionToDraft(sel: Set<string>, fmt: ExportFormat): string {
    return formatSkus(
      entries.filter((e) => sel.has(e.sku)).map((e) => e.sku),
      fmt
    )
  }

  // Pull the remote SKU catalog. A failed pull flips the offline badge but
  // keeps whatever list is already loaded (bundled, or a previous pull).
  const refreshCatalog = useCallback(() => {
    setSyncing(true)
    fetchRemoteSkus()
      .then((remote) => {
        setEntries(remote)
        setLastSync(Date.now())
        setSyncFailed(false)
      })
      .catch(() => setSyncFailed(true))
      .finally(() => setSyncing(false))
  }, [])

  // Show the bundled list instantly, then keep the catalog fresh: pull the
  // remote copy on mount and every minute after.
  useEffect(() => {
    refreshCatalog()
    const id = setInterval(refreshCatalog, 60_000)
    return () => clearInterval(id)
  }, [refreshCatalog])

  // Re-render every 30s so the "updated N ago" freshness label stays current.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // Persist the selection so it survives app restarts. Best-effort — a full or
  // unavailable localStorage just means the selection isn't remembered.
  useEffect(() => {
    try {
      localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify([...selected]))
    } catch {
      // ignore
    }
  }, [selected])

  // Dismiss the context menu on any click, Esc, scroll, or resize.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
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
  }, [menu])

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

  /** Apply a new selection from a checkbox action and re-render the export. */
  function applySelection(next: Set<string>) {
    setSelected(next)
    setDraft(selectionToDraft(next, format))
  }

  // Plain click toggles one SKU and moves the anchor. Shift-click selects every
  // row between the anchor and the clicked row (in displayed order).
  function handleRowClick(sku: string, shift: boolean) {
    if (shift && anchor) {
      const a = visibleOrder.indexOf(anchor)
      const b = visibleOrder.indexOf(sku)
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a]
        const next = new Set(selected)
        for (let i = lo; i <= hi; i++) next.add(visibleOrder[i]!)
        applySelection(next)
        return
      }
    }
    const next = new Set(selected)
    if (next.has(sku)) next.delete(sku)
    else next.add(sku)
    applySelection(next)
    setAnchor(sku)
  }

  function setGroup(items: SkuEntry[], on: boolean) {
    const next = new Set(selected)
    for (const e of items) {
      if (on) next.add(e.sku)
      else next.delete(e.sku)
    }
    applySelection(next)
  }

  function clearAll() {
    setSelected(new Set())
    setDraft('')
    setAnchor(null)
    onSetStatus('Selection cleared')
  }

  // Drop every draft SKU that isn't in the catalog (pasted typos, or SKUs from
  // another store), keeping the valid ones in canonical catalog order.
  function removeInvalid() {
    const valid = new Set(
      parseSkuList(draft, detectFormat(draft)).filter((s) => catalogSkus.has(s))
    )
    applySelection(valid)
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

  // User typed/pasted into the Export box: detect the format and re-check the
  // boxes for every catalog SKU found. The raw text is kept as-is so editing
  // never fights the cursor.
  function handleDraftChange(text: string) {
    setDraft(text)
    const fmt = detectFormat(text)
    setFormat(fmt)
    const found = new Set<string>()
    for (const token of parseSkuList(text, fmt)) {
      if (catalogSkus.has(token)) found.add(token)
    }
    setSelected(found)
  }

  function handleFormatChange(fmt: ExportFormat) {
    if (!FORMAT_ENABLED[fmt]) return
    setFormat(fmt)
    setDraft(selectionToDraft(selected, fmt))
  }

  // Shikari Monitor view: the Tasks SKUs split into comma lists, one per line,
  // none longer than SHIKARI_MONITOR_MAX.
  const monitorText = useMemo(
    () =>
      chunkEvenly(parseSkuList(draft, 'shikari'), SHIKARI_MONITOR_MAX)
        .map((list) => list.join(', '))
        .join('\n'),
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

  // Freshness label for the SKU catalog (search bar, right side).
  function syncLabel(): string {
    if (syncing) return 'Syncing…'
    if (syncFailed) return 'Offline'
    if (lastSync !== null) return agoLabel(lastSync)
    return 'Syncing…'
  }

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
            <ExportSection
              label={`Monitor — lists of ${SHIKARI_MONITOR_MAX} max`}
              value={monitorText}
              placeholder="Selected SKUs split into monitor lists appear here."
              taskName="target-skus-shikari-monitor"
              topBorder
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
          <span
            className={`shrink-0 text-[11px] ${syncFailed ? 'text-warning' : 'text-text-muted'}`}
          >
            {syncLabel()}
          </span>
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Target SKUs"
        onBack={onBack}
        actions={
          <Button onClick={clearAll} variant="ghost" disabled={selected.size === 0}>
            <Icons.Trash />
            Clear
          </Button>
        }
      />
      <StatusBanner>
        <Stat value={entries.length.toLocaleString()} label="SKUs in catalog" />
        <Stat value={selected.size.toLocaleString()} label="selected" separator={false} />
      </StatusBanner>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 px-8 pb-8 pt-4">
        {exportCard}
        {skuCard}
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-[150px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-card"
          style={{
            left: Math.min(menu.x, window.innerWidth - 170),
            top: Math.min(menu.y, window.innerHeight - 52)
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
        </div>
      )}
    </div>
  )
}
