import { useMemo, useState } from 'react'
import {
  ToolLayout,
  ResultPanel,
  Button,
  Icons,
  Stat
} from '../components/ToolShell'
import { Card } from '../components/Card'

export type TwoFileToolProps = {
  title: string
  hint: string
  taskName: string
  resultLabel: string
  resultUnit: string
  emptyResultMessage: string
  runLabel: string
  transform: (text1: string, text2: string) => string[]
  onBack: () => void
  onSetStatus: (msg: string) => void
}

function FileBox({
  index,
  filePath,
  content,
  onPick,
  onChange
}: {
  index: 1 | 2
  filePath: string | null
  content: string
  onPick: () => void
  onChange: (s: string) => void
}) {
  const lineCount = content
    ? content.split(/\r?\n/).filter((l) => l.trim().length > 0).length
    : 0
  return (
    <Card label={`File ${index}`} badge={lineCount.toLocaleString()}>
      <div className="flex h-full min-h-0 flex-col">
        <textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`No file ${index} loaded.\n\nClick "Choose" or paste content here.`}
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
          spellCheck={false}
        />
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1 truncate text-[12px] text-text-muted">
            {filePath ?? 'No file selected'}
          </span>
          <Button onClick={onPick} variant="ghost">
            <Icons.Folder />
            {filePath ? 'Change' : 'Choose'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

export function TwoFileTool(props: TwoFileToolProps) {
  const {
    title,
    hint,
    taskName,
    resultLabel,
    resultUnit,
    emptyResultMessage,
    runLabel,
    transform,
    onBack,
    onSetStatus
  } = props

  const [path1, setPath1] = useState<string | null>(null)
  const [content1, setContent1] = useState<string>('')
  const [path2, setPath2] = useState<string | null>(null)
  const [content2, setContent2] = useState<string>('')
  const [results, setResults] = useState<string[] | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const totalLines = useMemo(
    () =>
      (content1 ? content1.split(/\r?\n/).filter((l) => l.trim().length > 0).length : 0) +
      (content2 ? content2.split(/\r?\n/).filter((l) => l.trim().length > 0).length : 0),
    [content1, content2]
  )

  async function pick(which: 1 | 2) {
    const paths = await window.api.files.open({ title: `Select file ${which}` })
    if (paths.length === 0) return
    const path = paths[0]!
    const text = await window.api.files.read(path)
    if (which === 1) {
      setPath1(path)
      setContent1(text)
    } else {
      setPath2(path)
      setContent2(text)
    }
    setResults(null)
    setSavedTo(null)
    onSetStatus(`Loaded file ${which}: ${path}`)
  }

  function handleClear() {
    setPath1(null)
    setContent1('')
    setPath2(null)
    setContent2('')
    setResults(null)
    setSavedTo(null)
    onSetStatus('Ready')
  }

  async function handleRun() {
    if (!content1 || !content2) return
    setRunning(true)
    try {
      const out = transform(content1, content2)
      setResults(out)
      setSavedTo(null)
      onSetStatus(
        out.length === 0 ? emptyResultMessage : `${out.length.toLocaleString()} ${resultUnit}`
      )
    } finally {
      setRunning(false)
    }
  }

  const canRun = !!content1 && !!content2 && !running

  return (
    <ToolLayout
      title={title}
      onBack={onBack}
      banner={
        path1 || path2 ? (
          <>
            <Stat value={totalLines.toLocaleString()} label="lines loaded" />
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
          <Button onClick={handleRun} variant="primary" disabled={!canRun}>
            <Icons.Play />
            {running ? 'Running…' : runLabel}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-col gap-4">
        <FileBox
          index={1}
          filePath={path1}
          content={content1}
          onPick={() => pick(1)}
          onChange={(s) => {
            setContent1(s)
            setResults(null)
            setSavedTo(null)
          }}
        />
        <FileBox
          index={2}
          filePath={path2}
          content={content2}
          onPick={() => pick(2)}
          onChange={(s) => {
            setContent2(s)
            setResults(null)
            setSavedTo(null)
          }}
        />
      </div>
      <ResultPanel
        label={resultLabel}
        results={results}
        emptyMessage={emptyResultMessage}
        initialMessage={`Run "${runLabel}" to populate.`}
        taskName={taskName}
        savedTo={savedTo}
        onSaved={(p) => {
          setSavedTo(p)
          onSetStatus(`Saved to ${p}`)
        }}
      />
    </ToolLayout>
  )
}
