import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  pickerTitle?: string
  pickerFilters?: { name: string; extensions: string[] }[]
  toolbar?: ReactNode
  /** Fired with the current input text on load/drop/clear and (debounced) on edit. */
  onContentChange?: (text: string) => void
  /** Extra action(s) rendered in the result panel footer when there are results. */
  resultActions?: (results: string[]) => ReactNode
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
    pickerTitle,
    pickerFilters,
    toolbar,
    onContentChange,
    resultActions,
    active = true,
    onBack,
    onSetStatus
  } = props

  const [filePath, setFilePath] = useState<string | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const [results, setResults] = useState<string[] | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const panelRef = useRef<FilePanelHandle>(null)
  const editDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function loadFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFilePath(path)
    panelRef.current?.setValue(text)
    onContentChange?.(text)
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

  useEffect(() => {
    return () => {
      if (editDebounce.current) clearTimeout(editDebounce.current)
    }
  }, [])

  async function handlePick() {
    const paths = await window.api.files.open({
      title: pickerTitle ?? 'Select a text file',
      filters: pickerFilters
    })
    if (paths.length === 0) return
    await loadFromPath(paths[0]!)
  }

  function handleClear() {
    setFilePath(null)
    panelRef.current?.setValue('')
    onContentChange?.('')
    setResults(null)
    setSavedTo(null)
    onSetStatus('Ready')
  }

  async function handleRun() {
    const content = panelRef.current?.getValue() ?? ''
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

  const hasContent = lineCount > 0

  return (
    <ToolLayout
      title={title}
      toolbar={toolbar}
      onBack={onBack}
      onRun={handleRun}
      active={active}
      running={running}
      banner={
        hasContent ? (
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
          <Button onClick={handleRun} variant="primary" disabled={!hasContent || running}>
            <Icons.Play />
            {running ? 'Running…' : runLabel}
          </Button>
        </>
      }
    >
      <FilePanel
        ref={panelRef}
        label={inputLabel}
        filePath={filePath}
        onPick={handlePick}
        onDropPath={loadFromPath}
        onLineCountChange={setLineCount}
        onUserEdit={() => {
          setResults(null)
          setSavedTo(null)
          if (!onContentChange) return
          if (editDebounce.current) clearTimeout(editDebounce.current)
          editDebounce.current = setTimeout(() => {
            onContentChange(panelRef.current?.getValue() ?? '')
          }, 250)
        }}
      />
      <ResultPanel
        label={resultLabel}
        results={results}
        emptyMessage={emptyResultMessage}
        initialMessage={`Run "${runLabel}" to populate.`}
        taskName={taskName}
        savedTo={savedTo}
        footerActions={resultActions}
        onSaved={(path) => {
          setSavedTo(path)
          onSetStatus(`Saved to ${shortOutputPath(path)}`)
        }}
      />
    </ToolLayout>
  )
}
