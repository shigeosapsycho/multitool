import { useEffect, useMemo, useState } from 'react'
import {
  ToolLayout,
  FilePanel,
  ResultPanel,
  Button,
  Icons,
  Stat
} from '../components/ToolShell'
import { consumePendingFile } from '../lib/pending'

export type SingleFileToolProps = {
  title: string
  hint: string
  taskName: string
  inputLabel?: string
  resultLabel: string
  resultUnit: string
  emptyResultMessage: string
  runLabel: string
  transform: (text: string) => string[]
  active?: boolean
  onBack: () => void
  onSetStatus: (msg: string) => void
}

export function SingleFileTool(props: SingleFileToolProps) {
  const {
    title,
    hint,
    taskName,
    inputLabel = 'Input File',
    resultLabel,
    resultUnit,
    emptyResultMessage,
    runLabel,
    transform,
    active = true,
    onBack,
    onSetStatus
  } = props

  const [filePath, setFilePath] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [results, setResults] = useState<string[] | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const lineCount = useMemo(
    () => (content ? content.split(/\r?\n/).filter((l) => l.trim().length > 0).length : 0),
    [content]
  )

  async function loadFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFilePath(path)
    setContent(text)
    setResults(null)
    setSavedTo(null)
    onSetStatus(`Loaded ${path}`)
  }

  // Pick up a file dropped on the Tools landing page. Re-runs when the tool
  // becomes active so revisits via drop-on-card still work after first mount.
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
    setContent('')
    setResults(null)
    setSavedTo(null)
    onSetStatus('Ready')
  }

  async function handleRun() {
    if (!content) return
    const start = Date.now()
    setRunning(true)
    try {
      const out = transform(content)
      setResults(out)
      setSavedTo(null)
      if (out.length === 0) {
        onSetStatus(emptyResultMessage)
      } else {
        onSetStatus(`${out.length.toLocaleString()} ${resultUnit}`)
      }
    } finally {
      const elapsed = Date.now() - start
      const min = 500
      if (elapsed < min) await new Promise((r) => setTimeout(r, min - elapsed))
      setRunning(false)
    }
  }

  return (
    <ToolLayout
      title={title}
      onBack={onBack}
      onRun={handleRun}
      running={running}
      banner={
        content ? (
          <>
            <Stat value={lineCount.toLocaleString()} label="lines loaded" />
            <Stat
              value={results ? results.length.toLocaleString() : '—'}
              label={resultUnit}
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
            {running ? 'Running…' : runLabel}
          </Button>
        </>
      }
    >
      <FilePanel
        label={inputLabel}
        filePath={filePath}
        content={content}
        onContentChange={(s) => {
          setContent(s)
          setResults(null)
          setSavedTo(null)
        }}
        onPick={handlePick}
        onDropPath={loadFromPath}
      />
      <ResultPanel
        label={resultLabel}
        results={results}
        emptyMessage={emptyResultMessage}
        initialMessage={`Run "${runLabel}" to populate.`}
        taskName={taskName}
        savedTo={savedTo}
        onSaved={(path) => {
          setSavedTo(path)
          onSetStatus(`Saved to ${path}`)
        }}
      />
    </ToolLayout>
  )
}
