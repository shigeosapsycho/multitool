import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ToolLayout,
  FilePanel,
  ResultPanel,
  Button,
  Icons,
  Stat,
  type FilePanelHandle
} from '../components/ToolShell'
import { Select } from '../components/Select'
import { consumePendingFile } from '../lib/pending'
import { shortOutputPath } from '../lib/paths'
import { buildFilteredCsv, csvColumnLabel, parseCsv } from '../lib/csvFilter'

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

type SeparatorChoice = 'comma' | 'semicolon' | 'tab' | 'pipe' | 'space' | 'custom'

const SEPARATOR_OPTIONS: { value: SeparatorChoice; label: string }[] = [
  { value: 'comma', label: 'Comma (,)' },
  { value: 'semicolon', label: 'Semicolon (;)' },
  { value: 'tab', label: 'Tab' },
  { value: 'pipe', label: 'Pipe (|)' },
  { value: 'space', label: 'Space' },
  { value: 'custom', label: 'Custom…' }
]

const SEPARATOR_VALUES: Record<Exclude<SeparatorChoice, 'custom'>, string> = {
  comma: ',',
  semicolon: ';',
  tab: '\t',
  pipe: '|',
  space: ' '
}

export function CsvFilterPage({ onBack, onSetStatus, active = true }: Props) {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const [results, setResults] = useState<string[] | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  // Header cells from the loaded CSV; chip identity is the column index, so
  // duplicate or blank header names still map to distinct columns.
  const [headers, setHeaders] = useState<string[]>([])
  const [rowCount, setRowCount] = useState(0)
  // All column indices in display order (kept columns first; removed ones keep their slot).
  const [order, setOrder] = useState<number[]>([])
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  const [separatorChoice, setSeparatorChoice] = useState<SeparatorChoice>('comma')
  const [customSeparator, setCustomSeparator] = useState('')
  const panelRef = useRef<FilePanelHandle>(null)
  const editDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Pointer-based drag reorder for column chips. HTML5 drag events don't fire
  // under Tauri's OS-level drag-drop (dragDropEnabled), so we hold the dragged
  // chip and reorder live by pointer position, same approach as Order Email By.
  const [dragCol, setDragCol] = useState<number | null>(null)
  const dragColRef = useRef<number | null>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const headersRef = useRef(headers)
  headersRef.current = headers
  const orderRef = useRef(order)
  orderRef.current = order
  const removedRef = useRef(removed)
  removedRef.current = removed

  function invalidateResults() {
    setResults(null)
    setSavedTo(null)
  }

  // Re-parse the header row and reconcile: identical headers keep the user's
  // column arrangement; a changed header row resets it (indices would no
  // longer point at the same columns).
  function reconcile(text: string) {
    const parsed = parseCsv(text)
    setRowCount(parsed.rows.length)
    const prev = headersRef.current
    const same =
      prev.length === parsed.headers.length && prev.every((h, i) => h === parsed.headers[i])
    if (same) return
    setHeaders(parsed.headers)
    setOrder(parsed.headers.map((_, i) => i))
    setRemoved(new Set())
    invalidateResults()
  }

  async function loadFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFilePath(path)
    panelRef.current?.setValue(text)
    reconcile(text)
    invalidateResults()
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
    const paths = await window.api.files.open({
      title: 'Select a CSV file',
      filters: [
        { name: 'CSV files', extensions: ['csv'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (paths.length === 0) return
    await loadFromPath(paths[0]!)
  }

  function handleClear() {
    setFilePath(null)
    panelRef.current?.setValue('')
    setHeaders([])
    setRowCount(0)
    setOrder([])
    setRemoved(new Set())
    invalidateResults()
    onSetStatus('Ready')
  }

  function resolveSeparator(): string {
    return separatorChoice === 'custom' ? customSeparator : SEPARATOR_VALUES[separatorChoice]
  }

  async function handleRun() {
    const content = panelRef.current?.getValue() ?? ''
    if (!content) return
    const start = Date.now()
    setRunning(true)
    try {
      const parsed = parseCsv(content)
      const kept = order.filter((i) => !removed.has(i))
      const lines = buildFilteredCsv(parsed, kept, resolveSeparator())
      setResults(lines)
      setSavedTo(null)
      if (lines.length === 0) {
        onSetStatus(kept.length === 0 ? 'No columns selected.' : 'No CSV content found.')
      } else {
        onSetStatus(
          `${parsed.rows.length.toLocaleString()} rows filtered to ${kept.length.toLocaleString()} ` +
            (kept.length === 1 ? 'column' : 'columns')
        )
      }
    } finally {
      const elapsed = Date.now() - start
      const min = 500
      if (elapsed < min) await new Promise((r) => setTimeout(r, min - elapsed))
      setRunning(false)
    }
  }

  function startChipDrag(e: ReactPointerEvent, col: number) {
    e.preventDefault()
    dragColRef.current = col
    setDragCol(col)
  }

  // Live reorder while a chip is held: find the insertion slot from the pointer
  // position across the (possibly wrapped) chip row, then splice the kept list.
  useEffect(() => {
    if (dragCol === null) return
    const onMove = (e: PointerEvent) => {
      const col = dragColRef.current
      const container = chipsRef.current
      if (col === null || !container) return
      const chips = Array.from(container.querySelectorAll<HTMLElement>('[data-col]'))
      if (chips.length === 0) return
      // Insertion slot: first chip the pointer sits before in reading order
      // (earlier row, or same row and left of the chip's horizontal midpoint).
      let target = chips.length
      for (let i = 0; i < chips.length; i++) {
        const r = chips[i]!.getBoundingClientRect()
        if (e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2)) {
          target = i
          break
        }
      }
      const kept = orderRef.current.filter((c) => !removedRef.current.has(c))
      const from = kept.indexOf(col)
      if (from === -1) return
      const insertAt = from < target ? target - 1 : target
      if (insertAt === from) return
      const next = [...kept]
      const [moved] = next.splice(from, 1)
      next.splice(insertAt, 0, moved!)
      const removedList = orderRef.current.filter((c) => removedRef.current.has(c))
      setOrder([...next, ...removedList])
      invalidateResults()
    }
    const onUp = (e: PointerEvent) => {
      const col = dragColRef.current
      dragColRef.current = null
      setDragCol(null)
      if (col === null) return
      // Released over the "Removed" box → drop the dragged column.
      const el = document.elementFromPoint(e.clientX, e.clientY)
      if (el && el.closest('[data-removed-box]')) removeColumn(col)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragCol])

  function removeColumn(col: number) {
    setRemoved((prev) => new Set(prev).add(col))
    invalidateResults()
  }

  function restoreColumn(col: number) {
    setRemoved((prev) => {
      const next = new Set(prev)
      next.delete(col)
      return next
    })
    invalidateResults()
  }

  const hasContent = lineCount > 0
  const keptCols = order.filter((c) => !removed.has(c))
  const removedCols = order.filter((c) => removed.has(c))

  const toolbar =
    headers.length === 0 ? (
      <span className="text-[12px] text-text-muted">
        Load a CSV to detect its headers, then pick and reorder the columns to keep.
      </span>
    ) : (
      <div className="flex flex-col gap-3">
        <div ref={chipsRef} className="flex flex-wrap items-center gap-2">
          {keptCols.map((c) => (
            <div
              key={c}
              data-col={c}
              onPointerDown={(e) => startChipDrag(e, c)}
              className={`inline-flex cursor-grab touch-none select-none items-center gap-1.5 rounded-lg border bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-text-primary transition active:cursor-grabbing ${
                dragCol === c
                  ? 'border-accent shadow-glow-accent'
                  : 'border-border hover:border-border-strong'
              }`}
            >
              <span className="text-text-muted">
                <GripIcon />
              </span>
              <span>{csvColumnLabel(headers[c] ?? '', c)}</span>
              <button
                type="button"
                aria-label={`Remove ${csvColumnLabel(headers[c] ?? '', c)}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => removeColumn(c)}
                className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-text-muted transition hover:bg-surface-3 hover:text-text-primary"
              >
                <CloseIcon />
              </button>
            </div>
          ))}
          <div
            data-removed-box
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[12.5px] text-text-secondary"
          >
            Removed ({removedCols.length.toLocaleString()})
          </div>
          {removedCols.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Keep ${csvColumnLabel(headers[c] ?? '', c)}`}
              onClick={() => restoreColumn(c)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12.5px] text-text-muted opacity-60 transition hover:opacity-100"
            >
              <PlusIcon />
              <span>{csvColumnLabel(headers[c] ?? '', c)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-text-secondary">Separator</span>
          <Select
            value={separatorChoice}
            options={SEPARATOR_OPTIONS}
            onChange={(next) => {
              setSeparatorChoice(next)
              invalidateResults()
            }}
            ariaLabel="Output separator"
          />
          {separatorChoice === 'custom' && (
            <input
              type="text"
              value={customSeparator}
              onChange={(e) => {
                setCustomSeparator(e.target.value)
                invalidateResults()
              }}
              placeholder="e.g. ;;"
              aria-label="Custom separator"
              maxLength={8}
              className="h-9 w-24 rounded-lg border border-border bg-surface-2 px-3 font-mono text-[13px] text-text-primary placeholder:text-text-muted outline-none transition focus:border-accent"
            />
          )}
        </div>
      </div>
    )

  return (
    <ToolLayout
      title="CSV Filter"
      toolbar={toolbar}
      onBack={onBack}
      onRun={handleRun}
      active={active}
      running={running}
      banner={
        hasContent ? (
          <>
            <Stat value={headers.length.toLocaleString()} label="columns detected" />
            <Stat value={keptCols.length.toLocaleString()} label="kept" />
            <Stat value={rowCount.toLocaleString()} label="rows" separator={false} />
          </>
        ) : (
          <span>Load a CSV, pick the columns to keep, drag them into order, then Run.</span>
        )
      }
      actions={
        <>
          <Button onClick={handleClear} variant="ghost">
            <Icons.Trash />
            Clear
          </Button>
          <Button
            onClick={handleRun}
            variant="primary"
            disabled={!hasContent || keptCols.length === 0 || running}
          >
            <Icons.Play />
            {running ? 'Running…' : 'Filter'}
          </Button>
        </>
      }
    >
      <FilePanel
        ref={panelRef}
        label="CSV"
        filePath={filePath}
        onPick={handlePick}
        onDropPath={loadFromPath}
        onLineCountChange={setLineCount}
        onUserEdit={() => {
          // Keep the last output on screen while editing; it refreshes on the
          // next run. Still re-parse headers so the column chips track edits.
          if (editDebounce.current) clearTimeout(editDebounce.current)
          editDebounce.current = setTimeout(() => {
            reconcile(panelRef.current?.getValue() ?? '')
          }, 250)
        }}
      />
      <ResultPanel
        label="Filtered CSV"
        results={results}
        emptyMessage="No columns selected, or no CSV content found."
        initialMessage='Run "Filter" to populate.'
        taskName="csv-filter"
        savedTo={savedTo}
        onSaved={(path) => {
          setSavedTo(path)
          onSetStatus(`Saved to ${shortOutputPath(path)}`)
        }}
      />
    </ToolLayout>
  )
}
