import { type ReactNode, useMemo, useState } from 'react'
import {
  ToolLayout,
  FilePanel,
  Button,
  Icons,
  Stat
} from '../components/ToolShell'
import { Card } from '../components/Card'
import { basenameNoExt, nonEmptyLines } from '../lib/parse'

export type SplitToolProps = {
  title: string
  hint: string
  runLabel: string
  controls?: ReactNode
  getChunks: (lines: string[]) => string[][] | { error: string }
  partName: (baseName: string, index: number) => string
  onBack: () => void
  onSetStatus: (msg: string) => void
}

export function SplitTool(props: SplitToolProps) {
  const { title, hint, runLabel, controls, getChunks, partName, onBack, onSetStatus } = props

  const [filePath, setFilePath] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [outputs, setOutputs] = useState<{ path: string; lines: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const lineCount = useMemo(() => nonEmptyLines(content).length, [content])

  async function loadFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFilePath(path)
    setContent(text)
    setOutputs(null)
    setError(null)
    onSetStatus(`Loaded ${path}`)
  }

  async function handlePick() {
    const paths = await window.api.files.open({ title: 'Select a text file' })
    if (paths.length === 0) return
    await loadFromPath(paths[0]!)
  }

  function handleClear() {
    setFilePath(null)
    setContent('')
    setOutputs(null)
    setError(null)
    onSetStatus('Ready')
  }

  async function handleRun() {
    if (!content) return
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
      setRunning(false)
    }
  }

  return (
    <ToolLayout
      title={title}
      onBack={onBack}
      banner={
        content ? (
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
          <Button onClick={handleRun} variant="primary" disabled={!content || running}>
            <Icons.Play />
            {running ? 'Splitting…' : runLabel}
          </Button>
        </>
      }
    >
      <FilePanel
        label="Input File"
        filePath={filePath}
        content={content}
        onContentChange={(s) => {
          setContent(s)
          setOutputs(null)
          setError(null)
        }}
        onPick={handlePick}
        onDropPath={loadFromPath}
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
                      {o.path}
                    </span>
                    <Button onClick={() => window.api.files.reveal(o.path)} variant="ghost">
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
