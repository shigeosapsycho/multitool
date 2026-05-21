import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { StatusBanner, Stat } from '../components/StatusBanner'
import { Card } from '../components/Card'
import { Button, Icons } from '../components/ToolShell'
import { shortOutputPath } from '../lib/paths'
import {
  BUNDLED_SKUS,
  CATEGORY_ORDER,
  FORMAT_ENABLED,
  fetchRemoteSkus,
  formatSkus,
  type ExportFormat,
  type SkuEntry
} from '../lib/targetSkus'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
}

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'shikari', label: 'Shikari' },
  { id: 'refract', label: 'Refract' },
  { id: 'stellar', label: 'Stellar' }
]

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <circle cx="11" cy="11" r="6.5" />
    <line x1="20" y1="20" x2="16" y2="16" />
  </svg>
)

/** A single SKU row with a checkbox-style toggle. */
function SkuRow({
  entry,
  checked,
  onToggle
}: {
  entry: SkuEntry
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-surface-2"
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
        {entry.item}
      </span>
    </button>
  )
}

export function TargetSkuPage({ onBack, onSetStatus }: Props) {
  const [entries, setEntries] = useState<SkuEntry[]>(BUNDLED_SKUS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [format, setFormat] = useState<ExportFormat>('shikari')
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Load the bundled list instantly, then swap in the remote copy if one is
  // configured and reachable. Failures (incl. no URL) keep the bundled list.
  useEffect(() => {
    let cancelled = false
    fetchRemoteSkus()
      .then((remote) => {
        if (cancelled) return
        setEntries(remote)
        onSetStatus(`Updated — ${remote.length} SKUs loaded`)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [onSetStatus])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = q
      ? entries.filter(
          (e) => e.sku.toLowerCase().includes(q) || e.item.toLowerCase().includes(q)
        )
      : entries
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: visible.filter((e) => e.category === category)
    })).filter((g) => g.items.length > 0)
  }, [entries, query])

  // Build the export from the full catalog so a search filter never drops an
  // already-checked SKU. Order follows the catalog for deterministic output.
  const exportSkus = useMemo(
    () => entries.filter((e) => selected.has(e.sku)).map((e) => e.sku),
    [entries, selected]
  )
  const exportString = formatSkus(exportSkus, format)

  function toggle(sku: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sku)) next.delete(sku)
      else next.add(sku)
      return next
    })
    setSavedTo(null)
  }

  function setGroup(items: SkuEntry[], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const e of items) {
        if (on) next.add(e.sku)
        else next.delete(e.sku)
      }
      return next
    })
    setSavedTo(null)
  }

  function clearAll() {
    setSelected(new Set())
    setSavedTo(null)
    onSetStatus('Selection cleared')
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const remote = await fetchRemoteSkus()
      setEntries(remote)
      onSetStatus(`Updated — ${remote.length} SKUs loaded`)
    } catch {
      onSetStatus('SKU list is up to date')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleCopy() {
    if (!exportString) return
    try {
      await navigator.clipboard.writeText(exportString)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
  }

  async function handleSave() {
    if (!exportString) return
    const path = await window.api.files.writeOutput(
      `target-skus-${format}`,
      exportString + '\n'
    )
    setSavedTo(path)
    onSetStatus(`Saved to ${shortOutputPath(path)}`)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Target SKUs"
        onBack={onBack}
        actions={
          <>
            <Button onClick={handleRefresh} variant="ghost" disabled={refreshing}>
              <span className={refreshing ? 'animate-spin' : ''}>
                <RefreshIcon />
              </span>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button onClick={clearAll} variant="ghost" disabled={selected.size === 0}>
              <Icons.Trash />
              Clear
            </Button>
          </>
        }
      />
      <StatusBanner>
        <Stat value={entries.length.toLocaleString()} label="SKUs in catalog" />
        <Stat value={selected.size.toLocaleString()} label="selected" separator={false} />
      </StatusBanner>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 px-8 pb-8 pt-4">
        {/* Left: the checklist catalog */}
        <Card label="SKUs" badge={groups.reduce((n, g) => n + g.items.length, 0)}>
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
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {groups.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
                  No SKUs match “{query}”.
                </div>
              ) : (
                groups.map((g) => {
                  const groupSkus = g.items.map((e) => e.sku)
                  const selectedCount = groupSkus.filter((s) => selected.has(s)).length
                  const allOn = selectedCount === groupSkus.length
                  return (
                    <div key={g.category} className="mb-3 last:mb-0">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-secondary">
                          {g.category}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          {selectedCount}/{groupSkus.length}
                        </span>
                        <span className="flex-1" />
                        <button
                          onClick={() => setGroup(g.items, !allOn)}
                          className="text-[11px] font-medium text-accent transition hover:underline"
                        >
                          {allOn ? 'Clear' : 'Select all'}
                        </button>
                      </div>
                      {g.items.map((e) => (
                        <SkuRow
                          key={e.sku}
                          entry={e}
                          checked={selected.has(e.sku)}
                          onToggle={() => toggle(e.sku)}
                        />
                      ))}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </Card>

        {/* Right: format selector + generated export string */}
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
                      onClick={() => enabled && setFormat(f.id)}
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
            {exportString ? (
              <textarea
                readOnly
                value={exportString}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none"
              />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-[13px] text-text-muted">
                Check SKUs on the left to build the {FORMATS.find((f) => f.id === format)?.label} list.
              </div>
            )}
            <div className="flex items-center gap-2 border-t border-border p-3">
              {savedTo ? (
                <span className="flex-1 truncate text-[12px] text-text-secondary">
                  Saved to{' '}
                  <span className="text-text-primary">{shortOutputPath(savedTo)}</span>
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <Button onClick={handleCopy} variant="ghost" disabled={!exportString}>
                <Icons.Copy />
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <Button onClick={handleSave} variant="secondary" disabled={!exportString}>
                <Icons.Save />
                Save
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
