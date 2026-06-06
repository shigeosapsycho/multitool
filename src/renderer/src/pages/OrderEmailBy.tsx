import { useEffect, useRef, useState } from 'react'
import {
  ToolLayout,
  FilePanel,
  ResultPanel,
  Button,
  Icons,
  Stat,
  type FilePanelHandle
} from '../components/ToolShell'
import { consumePendingFile } from '../lib/pending'
import { shortOutputPath } from '../lib/paths'
import { detectProviders, orderEmailsByProviders, type ProviderCount } from '../lib/orderEmails'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

const GripIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3">
    <circle cx="9" cy="6" r="1.4" />
    <circle cx="15" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" />
    <circle cx="15" cy="18" r="1.4" />
  </svg>
)

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3 w-3">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3 w-3">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

// Move `src` to the position immediately before `target` within `arr`.
function moveBefore(arr: string[], src: string, target: string): string[] {
  if (src === target) return arr
  const next = arr.filter((d) => d !== src)
  const at = next.indexOf(target)
  if (at === -1) return arr
  next.splice(at, 0, src)
  return next
}

export function OrderEmailByPage({ onBack, onSetStatus, active = true }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const [results, setResults] = useState<string[] | null>(null)
  const [invalidCount, setInvalidCount] = useState(0)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  // All detected domains, in display order (ranked first; excluded keep their slot).
  const [order, setOrder] = useState<string[]>([])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [providers, setProviders] = useState<ProviderCount[]>([])
  const panelRef = useRef<FilePanelHandle>(null)
  const editDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragItem = useRef<string | null>(null)

  // Re-detect providers and reconcile with the current order/exclusions:
  // keep known positions, append new domains (frequency order), drop vanished ones.
  function reconcile(text: string) {
    const detected = detectProviders(text)
    setProviders(detected)
    const present = new Set(detected.map((p) => p.domain))
    setOrder((prev) => {
      const kept = prev.filter((d) => present.has(d))
      const added = detected.map((p) => p.domain).filter((d) => !kept.includes(d))
      return [...kept, ...added]
    })
    setExcluded((prev) => new Set([...prev].filter((d) => present.has(d))))
  }

  function invalidateResults() {
    setResults(null)
    setSavedTo(null)
  }

  async function loadFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFilePath(path)
    panelRef.current?.setValue(text)
    reconcile(text)
    invalidateResults()
    setInvalidCount(0)
    onSetStatus(`Loaded ${path}`)
  }

  // Pick up a file dropped on the Tools landing page when this tool becomes active.
  useEffect(() => {
    if (!active) return
    const pending = consumePendingFile()
    if (pending) void loadFromPath(pending)
  }, [active])

  useEffect(() => {
    return () => {
      if (editDebounce.current) clearTimeout(editDebounce.current)
    }
  }, [])

  async function handlePick() {
    const paths = await window.api.files.open({ title: 'Select a list of emails' })
    if (paths.length === 0) return
    await loadFromPath(paths[0]!)
  }

  function handleClear() {
    setFilePath(null)
    panelRef.current?.setValue('')
    setOrder([])
    setExcluded(new Set())
    setProviders([])
    invalidateResults()
    setInvalidCount(0)
    onSetStatus('Ready')
  }

  async function handleRun() {
    const content = panelRef.current?.getValue() ?? ''
    if (!content) return
    const start = Date.now()
    setRunning(true)
    try {
      const rankedOrder = order.filter((d) => !excluded.has(d))
      const { lines, invalid } = orderEmailsByProviders(content, rankedOrder)
      setResults(lines)
      setInvalidCount(invalid.length)
      setSavedTo(null)
      if (lines.length === 0) {
        onSetStatus('No valid emails to sort.')
      } else {
        onSetStatus(
          `${lines.length.toLocaleString()} emails sorted` +
            (invalid.length ? ` · ${invalid.length.toLocaleString()} invalid skipped` : '')
        )
      }
    } finally {
      const elapsed = Date.now() - start
      const min = 500
      if (elapsed < min) await new Promise((r) => setTimeout(r, min - elapsed))
      setRunning(false)
    }
  }

  function onChipDrop(target: string) {
    const src = dragItem.current
    dragItem.current = null
    if (!src) return
    setOrder((prev) => moveBefore(prev, src, target))
    invalidateResults()
  }

  function exclude(domain: string) {
    setExcluded((prev) => new Set(prev).add(domain))
    invalidateResults()
  }

  function include(domain: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      next.delete(domain)
      return next
    })
    invalidateResults()
  }

  const hasContent = lineCount > 0
  const countOf = (d: string) => providers.find((p) => p.domain === d)?.count ?? 0
  const rankedDomains = order.filter((d) => !excluded.has(d))
  const excludedDomains = order.filter((d) => excluded.has(d))
  const otherCount = excludedDomains.reduce((s, d) => s + countOf(d), 0)

  const toolbar =
    providers.length === 0 ? (
      <span className="text-[12px] text-text-muted">
        Load a list of emails to detect providers, then drag them into your order.
      </span>
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        {rankedDomains.map((d) => (
          <div
            key={d}
            draggable
            onDragStart={() => {
              dragItem.current = d
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onChipDrop(d)}
            className="inline-flex cursor-grab items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-text-primary transition hover:border-border-strong active:cursor-grabbing"
          >
            <span className="text-text-muted">
              <GripIcon />
            </span>
            <span>{d}</span>
            <span className="text-text-muted">({countOf(d).toLocaleString()})</span>
            <button
              type="button"
              aria-label={`Move ${d} to Other`}
              onClick={() => exclude(d)}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-text-muted transition hover:bg-surface-3 hover:text-text-primary"
            >
              <CloseIcon />
            </button>
          </div>
        ))}
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[12.5px] text-text-secondary">
          Other ({otherCount.toLocaleString()})
        </span>
        {excludedDomains.map((d) => (
          <button
            key={d}
            type="button"
            aria-label={`Rank ${d}`}
            onClick={() => include(d)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-text-muted opacity-60 transition hover:opacity-100"
          >
            <PlusIcon />
            <span>{d}</span>
            <span>({countOf(d).toLocaleString()})</span>
          </button>
        ))}
      </div>
    )

  return (
    <ToolLayout
      title="Order Email By"
      toolbar={toolbar}
      onBack={onBack}
      onRun={handleRun}
      running={running}
      banner={
        hasContent ? (
          <>
            <Stat value={lineCount.toLocaleString()} label="emails loaded" />
            <Stat value={results ? results.length.toLocaleString() : '—'} label="sorted" />
            <Stat value={invalidCount.toLocaleString()} label="invalid" separator={false} />
          </>
        ) : (
          <span>Load a list of emails, order the detected providers, then Run.</span>
        )
      }
      actions={
        <>
          <Button onClick={handleClear} variant="ghost">
            <Icons.Trash />
            Clear
          </Button>
          <Button onClick={handleRun} variant="primary" disabled={!hasContent || running}>
            <Icons.Play />
            {running ? 'Running…' : 'Order'}
          </Button>
        </>
      }
    >
      <FilePanel
        ref={panelRef}
        label="Emails"
        filePath={filePath}
        onPick={handlePick}
        onDropPath={loadFromPath}
        onLineCountChange={setLineCount}
        onUserEdit={() => {
          invalidateResults()
          if (editDebounce.current) clearTimeout(editDebounce.current)
          editDebounce.current = setTimeout(() => {
            reconcile(panelRef.current?.getValue() ?? '')
          }, 250)
        }}
      />
      <ResultPanel
        label="Ordered"
        results={results}
        emptyMessage="No valid emails to sort."
        initialMessage='Run "Order" to populate.'
        taskName="ordered-emails"
        savedTo={savedTo}
        onSaved={(path) => {
          setSavedTo(path)
          onSetStatus(`Saved to ${shortOutputPath(path)}`)
        }}
      />
    </ToolLayout>
  )
}
