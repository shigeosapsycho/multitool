import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { StatusBanner, Stat } from '../components/StatusBanner'
import { Card } from '../components/Card'
import { Toggle } from '../components/Toggle'
import { Button, Icons } from '../components/ToolShell'
import { shortOutputPath } from '../lib/paths'
import { consumePendingFile } from '../lib/pending'
import { CsvTable } from '../components/CsvTable'
import {
  combineProfiles,
  parseProfiles,
  serializeRefract,
  serializeShikari,
  serializeStellar,
  type CombineResult,
  type ProfileFormat
} from '../lib/profileFilter'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
  formatCsv?: boolean
}

type OutputFormat = 'refract' | 'stellar' | 'shikari' | 'emails'

/** One entry in the source list. `id` is stable so removing a row is unambiguous. */
type Source = { id: number; name: string; text: string }

const FORMAT_LABELS: Record<ProfileFormat, string> = {
  refract: 'Refract',
  stellar: 'Stellar',
  shikari: 'Shikari',
  unknown: '?'
}

const OUTPUT_LABELS: Record<OutputFormat, string> = {
  refract: 'Refract JSON',
  stellar: 'Stellar JSON',
  shikari: 'Shikari CSV',
  emails: 'Combined emails'
}

const OUTPUTS: { id: OutputFormat; label: string }[] = [
  { id: 'refract', label: 'Refract JSON' },
  { id: 'stellar', label: 'Stellar JSON' },
  { id: 'shikari', label: 'Shikari CSV' },
  { id: 'emails', label: 'Emails only' }
]

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

const RemoveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

// Text + count + save extension for the chosen output format. A run whose
// sources are all the same JSON format keeps that format's original elements
// verbatim (`nativeOutput`); everything else is re-serialized from the
// canonical profiles.
function outputFor(result: CombineResult, fmt: OutputFormat): { text: string; count: number; ext: string } {
  if (fmt === 'emails') {
    return { text: result.emails.join('\n'), count: result.emails.length, ext: 'txt' }
  }
  if (fmt === result.nativeFormat) {
    return { text: result.nativeOutput, count: result.keptCount, ext: 'json' }
  }
  const text =
    fmt === 'refract'
      ? serializeRefract(result.combined)
      : fmt === 'stellar'
        ? serializeStellar(result.combined)
        : serializeShikari(result.combined)
  return { text, count: result.combined.length, ext: fmt === 'shikari' ? 'csv' : 'json' }
}

/** Format + profile count for a source, recomputed as the list changes. */
type SourceInfo = { format: ProfileFormat; count: number; error: string | null }

/** The source list: add / remove rows, each showing its detected format and size. */
function SourcesCard({
  sources,
  info,
  onAdd,
  onRemove,
  onDropPaths
}: {
  sources: Source[]
  info: SourceInfo[]
  onAdd: () => void
  onRemove: (id: number) => void
  onDropPaths: (paths: string[]) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    return window.api.files.registerDropZone(el, {
      onDrop: (paths) => {
        setDragOver(false)
        // Every dropped path becomes its own source, so one multi-file drag
        // loads the whole set instead of only the first file.
        if (paths.length > 0) onDropPaths(paths)
      },
      onEnter: () => setDragOver(true),
      onLeave: () => setDragOver(false)
    })
  }, [onDropPaths])

  return (
    <Card label="Sources" badge={sources.length.toLocaleString()} className="min-h-0 flex-1">
      <div
        ref={dropRef}
        className={`relative flex h-full min-h-0 flex-col transition ${dragOver ? 'bg-accent-soft' : ''}`}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-dashed border-accent" />
        )}
        {sources.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
            Drop Refract, Stellar, or Shikari exports here, or click Add files.
            <br />
            Formats can be mixed.
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {sources.map((s, i) => {
              const meta = info[i]
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-2 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <span className="w-5 shrink-0 text-[12px] tabular-nums text-text-muted">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary" title={s.name}>
                    {s.name}
                  </span>
                  {meta?.error ? (
                    <span className="shrink-0 text-[11.5px] text-warning" title={meta.error}>
                      {meta.error.length > 28 ? 'Unreadable' : meta.error}
                    </span>
                  ) : (
                    <>
                      <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                        {FORMAT_LABELS[meta?.format ?? 'unknown']}
                      </span>
                      <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-text-secondary">
                        {(meta?.count ?? 0).toLocaleString()}
                      </span>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${s.name}`}
                    onClick={() => onRemove(s.id)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-3 hover:text-text-primary"
                  >
                    <RemoveIcon />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1 truncate text-[12px] text-text-muted">
            Combined in this order; the first profile per email wins.
          </span>
          <Button onClick={onAdd} variant="secondary">
            <Icons.Folder />
            Add files
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Paste box for a source with no file behind it. Adds a "(pasted)" row. */
function PasteCard({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  const format = useMemo(
    () => (trimmed ? parseProfiles(text).format : 'unknown'),
    [text, trimmed]
  )

  return (
    <Card
      label="Paste an export"
      badge={trimmed ? FORMAT_LABELS[format] : '-'}
      className="max-h-[34%] shrink-0"
    >
      <div className="flex h-full min-h-0 flex-col">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder="Paste a Refract JSON, Stellar JSON, or Shikari CSV export, then add it as a source."
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
        />
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1" />
          <Button
            onClick={() => {
              if (!trimmed) return
              onAdd(text)
              setText('')
            }}
            variant="secondary"
            disabled={!trimmed}
          >
            <PlusIcon />
            Add as source
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Combined output box. Owns its Copy / Save controls and saved-path note. */
function OutputCard({
  result,
  format,
  formatCsv,
  onSetStatus
}: {
  result: CombineResult | null
  format: OutputFormat
  formatCsv: boolean
  onSetStatus: (msg: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [savedTo, setSavedTo] = useState<string | null>(null)

  const out = result && !result.error ? outputFor(result, format) : null
  const text = out?.text ?? ''
  const has = text.length > 0

  // A changed output (new run or mode switch) voids the "Saved to …" note.
  useEffect(() => {
    setSavedTo(null)
  }, [text])

  async function copy() {
    if (!has) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
  }

  async function save() {
    if (!has || !out) return
    const path = await window.api.files.writeOutput('combine-profiles', text + '\n', out.ext)
    setSavedTo(path)
    onSetStatus(`Saved to ${shortOutputPath(path)}`)
  }

  return (
    <Card label={OUTPUT_LABELS[format]} badge={out ? out.count.toLocaleString() : '-'} className="min-h-0 flex-1">
      {result === null ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
          Run to combine the sources.
        </div>
      ) : result.error ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-warning">
          {result.error}
        </div>
      ) : !has ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-secondary">
          No profiles were read from the sources.
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {format === 'shikari' && formatCsv ? (
            <CsvTable text={text} />
          ) : (
            <textarea
              readOnly
              value={text}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none"
            />
          )}
          <div className="flex items-center gap-2 border-t border-border p-3">
            {savedTo ? (
              <span className="flex-1 truncate text-[12px] text-text-secondary">
                Saved to <span className="text-text-primary">{shortOutputPath(savedTo)}</span>
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <Button onClick={copy} variant="ghost">
              <Icons.Copy />
              {copied ? 'Copied!' : 'Copy all'}
            </Button>
            {savedTo ? (
              <Button onClick={() => window.api.files.reveal(savedTo)} variant="ghost">
                <Icons.Reveal />
                Reveal
              </Button>
            ) : (
              <Button onClick={save} variant="secondary">
                <Icons.Save />
                Save to Output
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

/** Emails dropped because an earlier source already carried them. */
function DuplicatesCard({ emails }: { emails: string[] }) {
  const [copied, setCopied] = useState(false)
  const text = emails.join('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can reject when the window isn't focused; the user can retry.
    }
  }

  return (
    <Card label="Removed duplicates" badge={emails.length.toLocaleString()} className="max-h-[34%] shrink-0">
      <div className="flex h-full min-h-0 flex-col">
        <textarea
          readOnly
          value={text}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-secondary outline-none"
        />
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1 truncate text-[12px] text-text-muted">
            Already present in an earlier source.
          </span>
          <Button onClick={copy} variant="ghost">
            <Icons.Copy />
            {copied ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** Basename of a path, for the source row label. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function CombineProfilesPage({ onBack, onSetStatus, active = true, formatCsv = true }: Props) {
  const [sources, setSources] = useState<Source[]>([])
  const [result, setResult] = useState<CombineResult | null>(null)
  const [outFmt, setOutFmt] = useState<OutputFormat>('refract')
  const [dedupe, setDedupe] = useState(true)
  // Once the user clicks an output format, stop auto-following the sources.
  const userPickedFmt = useRef(false)
  const nextId = useRef(1)

  // Format + count per row. Parsing is cheap next to the combine itself and
  // only reruns when the list changes, so rows can show what they hold before
  // the first Run.
  const info = useMemo<SourceInfo[]>(
    () =>
      sources.map((s) => {
        const parsed = parseProfiles(s.text)
        return { format: parsed.format, count: parsed.profiles.length, error: parsed.error }
      }),
    [sources]
  )

  // Changing the source list voids a stale result; the combine is only as
  // current as the rows it ran on.
  const addSources = useCallback((items: { name: string; text: string }[]) => {
    if (items.length === 0) return
    setSources((prev) => [
      ...prev,
      ...items.map((it) => ({ id: nextId.current++, name: it.name, text: it.text }))
    ])
    setResult(null)
  }, [])

  const loadPaths = useCallback(
    async (paths: string[]) => {
      const items: { name: string; text: string }[] = []
      for (const path of paths) {
        items.push({ name: baseName(path), text: await window.api.files.read(path) })
      }
      addSources(items)
      onSetStatus(
        items.length === 1 ? `Loaded ${paths[0]}` : `Loaded ${items.length} files`
      )
    },
    [addSources, onSetStatus]
  )

  // Pick up a file dropped on the Tools landing page as the first source.
  useEffect(() => {
    if (!active) return
    const pending = consumePendingFile()
    if (pending) void loadPaths([pending])
  }, [active])

  async function handleAddFiles() {
    const paths = await window.api.files.open({
      multiple: true,
      title: 'Select Refract JSON, Stellar JSON, or Shikari CSV exports',
      filters: [
        { name: 'Profiles', extensions: ['json', 'csv', 'txt'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (paths.length > 0) await loadPaths(paths)
  }

  function handleAddPasted(text: string) {
    const n = sources.filter((s) => s.name.startsWith('(pasted')).length
    addSources([{ name: n === 0 ? '(pasted)' : `(pasted ${n + 1})`, text }])
  }

  function handleRemove(id: number) {
    setSources((prev) => prev.filter((s) => s.id !== id))
    setResult(null)
  }

  const run = useCallback(
    (withDedupe: boolean) => {
      if (sources.length === 0) return
      const r = combineProfiles(
        sources.map((s) => ({ name: s.name, text: s.text })),
        { dedupe: withDedupe }
      )
      setResult(r)
      // Follow the sources while the user has not chosen a format: an
      // all-one-format run stays in that format, a mixed one keeps whatever
      // is selected.
      const formats = new Set(r.sources.filter((s) => !s.error).map((s) => s.format))
      if (!userPickedFmt.current && formats.size === 1) {
        const only = [...formats][0]!
        if (only !== 'unknown') setOutFmt(only)
      }
      const failed = r.sources.filter((s) => s.error).length
      onSetStatus(
        `${r.keptCount.toLocaleString()} combined · ${r.duplicateCount.toLocaleString()} duplicates removed` +
          (failed > 0 ? ` · ${failed} source${failed === 1 ? '' : 's'} unreadable` : '')
      )
    },
    [sources, onSetStatus]
  )

  const handleRun = useCallback(() => run(dedupe), [run, dedupe])

  // Ctrl/Cmd+Enter runs, but only on the visible tool (others stay mounted hidden).
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleRun()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, handleRun])

  function handleDedupeChange(next: boolean) {
    setDedupe(next)
    // Re-run in place so the toggle reads as a live setting rather than
    // something that only takes effect on the next Run.
    if (result) run(next)
  }

  function handleClear() {
    setSources([])
    setResult(null)
    setOutFmt('refract')
    setDedupe(true)
    userPickedFmt.current = false
    onSetStatus('Ready')
  }

  const failedSources = result?.sources.filter((s) => s.error).length ?? 0

  const banner =
    result && !result.error ? (
      <>
        <Stat value={result.sources.length.toLocaleString()} label="sources" />
        <Stat
          value={result.keptCount.toLocaleString()}
          label={`combined of ${result.totalCount.toLocaleString()}`}
        />
        <Stat
          value={result.duplicateCount.toLocaleString()}
          label="duplicates removed"
          separator={failedSources > 0}
        />
        {failedSources > 0 && (
          <span className="text-warning">
            {failedSources} source{failedSources === 1 ? '' : 's'} could not be read
          </span>
        )}
      </>
    ) : result?.error ? (
      <span className="text-warning">{result.error}</span>
    ) : (
      <span>Add Refract, Stellar, or Shikari exports in any mix, then Run.</span>
    )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Combine Profiles"
        onBack={onBack}
        actions={
          <>
            <Button onClick={handleClear} variant="ghost">
              <Icons.Trash />
              Clear
            </Button>
            <Button onClick={handleRun} variant="primary" disabled={sources.length === 0}>
              <Icons.Play />
              Combine
            </Button>
          </>
        }
      />
      <StatusBanner>{banner}</StatusBanner>

      <div className="flex items-center gap-3 px-8 pt-4">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          {OUTPUTS.map((m) => {
            const isActive = outFmt === m.id
            return (
              <button
                key={m.id}
                onClick={() => {
                  userPickedFmt.current = true
                  setOutFmt(m.id)
                }}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition ${
                  isActive
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {m.label}
              </button>
            )
          })}
        </div>
        <label className="inline-flex items-center gap-2 text-[12.5px] text-text-secondary">
          <Toggle
            checked={dedupe}
            onChange={handleDedupeChange}
            ariaLabel="Remove duplicate emails"
          />
          Remove duplicates
        </label>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 px-8 pb-8 pt-4">
        <div className="flex min-h-0 flex-col gap-4">
          <SourcesCard
            sources={sources}
            info={info}
            onAdd={handleAddFiles}
            onRemove={handleRemove}
            onDropPaths={loadPaths}
          />
          <PasteCard onAdd={handleAddPasted} />
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <OutputCard result={result} format={outFmt} formatCsv={formatCsv} onSetStatus={onSetStatus} />
          {result && !result.error && result.duplicateEmails.length > 0 && (
            <DuplicatesCard emails={result.duplicateEmails} />
          )}
        </div>
      </div>
    </div>
  )
}
