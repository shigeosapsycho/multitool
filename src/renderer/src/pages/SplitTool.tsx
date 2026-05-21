import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  ToolLayout,
  FilePanel,
  Button,
  Icons,
  Stat,
  type FilePanelHandle
} from '../components/ToolShell'
import { Card } from '../components/Card'
import { basenameNoExt, nonEmptyLines } from '../lib/parse'
import { consumePendingFile } from '../lib/pending'
import { shortOutputPath } from '../lib/paths'

export type SplitToolProps = {
  title: string
  hint: string
  runLabel: string
  controls?: ReactNode
  getChunks: (lines: string[]) => string[][] | { error: string }
  partName: (baseName: string, index: number) => string
  active?: boolean
  onBack: () => void
  onSetStatus: (msg: string) => void
}

export function SplitTool(props: SplitToolProps) {
  const {
    title,
    hint,
    runLabel,
    controls,
    getChunks,
    partName,
    active = true,
    onBack,
    onSetStatus
  } = props

  const [filePath, setFilePath] = useState<string | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const [outputs, setOutputs] = useState<{ path: string; lines: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const panelRef = useRef<FilePanelHandle>(null)

  async function loadFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFilePath(path)
    panelRef.current?.setValue(text)
    setOutputs(null)
    setError(null)
    onSetStatus(`Loaded ${path}`)
  }

  // Pick up a file dropped on the Tools landing page. Re-runs on active.
  useEffect(() => {
    if (!active) return
    const pending = consumePendingFile()
    if (pending) void loadFromPath(pending)
  }, [active])

  async function handlePick() {
    const paths = await window.api.files.open({ title: 'Select a text file' })
    if (paths.length === 0) return
    await loadFromPath(paths[0]!)
  }

  function handleClear() {
    setFilePath(null)
    panelRef.current?.setValue('')
    setOutputs(null)
    setError(null)
    onSetStatus('Ready')
  }

  async function handleRun() {
    const content = panelRef.current?.getValue() ?? ''
    if (!content) return
    const start = Date.now()
    setRunning(true)
    setError(null)
    try {
      const lines = nonEmptyLines(content)
      const result = getChunks(lines)
      if ('error' in result) {
        setError(result.error)
        setOutputs(null)
        onSetStatus(result.error)
        return
      }
      const baseName = filePath ? basenameNoExt(filePath) : 'split'
      const items = result.map((chunk, i) => ({
        name: partName(baseName, i),
        content: chunk.join('\n') + '\n'
      }))
      const paths = await window.api.files.writeOutputs(items)
      const out = paths.map((p, i) => ({ path: p, lines: result[i]!.length }))
      setOutputs(out)
      onSetStatus(`Wrote ${paths.length} files to output/`)
    } finally {
      const elapsed = Date.now() - start
      const min = 500
      if (elapsed < min) await new Promise((r) => setTimeout(r, min - elapsed))
      setRunning(false)
    }
  }

  const hasContent = lineCount > 0

  return (
    <ToolLayout
      title={title}
      onBack={onBack}
      onRun={handleRun}
      running={running}
      banner={
        hasContent ? (
          <>
            <Stat value={lineCount.toLocaleString()} label="lines loaded" />
            <Stat
              value={outputs ? outputs.length.toString() : '—'}
              label="files written"
              separator={false}
            />
          </>
        ) : (
          <span>{hint}</span>
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
            {running ? 'Splitting…' : runLabel}
          </Button>
        </>
      }
    >
      <FilePanel
        ref={panelRef}
        label="Input File"
        filePath={filePath}
        onPick={handlePick}
        onDropPath={loadFromPath}
        onLineCountChange={setLineCount}
        onUserEdit={() => {
          setOutputs(null)
          setError(null)
        }}
      />

      <div className="flex min-h-0 flex-col gap-4">
        {controls && (
          <Card label="Settings">
            <div className="p-4">{controls}</div>
          </Card>
        )}

        <Card
          label="Output Files"
          badge={outputs ? outputs.length.toString() : '—'}
          className="min-h-0 flex-1"
        >
          {error ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-danger">
              {error}
            </div>
          ) : outputs === null ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
              Run "{runLabel}" to write files.
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-auto p-3">
                {outputs.map((o) => (
                  <div
                    key={o.path}
                    className="mb-2 flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 last:mb-0"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      {o.lines.toLocaleString()} lines
                    </span>
                    <span className="flex-1 truncate font-mono text-[12px] text-text-primary">
                      {shortOutputPath(o.path)}
                    </span>
                    <Button
                      onClick={() => window.api.files.openFile(o.path)}
                      variant="ghost"
                    >
                      <Icons.Reveal />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="border-t border-border p-3">
                <Button onClick={() => window.api.files.openOutputDir()} variant="secondary">
                  <Icons.Folder />
                  Open output folder
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </ToolLayout>
  )
}
