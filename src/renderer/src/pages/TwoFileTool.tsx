import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react'
import {
  ToolLayout,
  ResultPanel,
  Button,
  Icons,
  Stat,
  type FilePanelHandle
} from '../components/ToolShell'
import { Card } from '../components/Card'
import { consumePendingFile } from '../lib/pending'

export type TwoFileToolProps = {
  title: string
  hint: string
  taskName: string
  resultLabel: string
  resultUnit: string
  emptyResultMessage: string
  runLabel: string
  transform: (text1: string, text2: string) => string[]
  file1Label?: string
  file2Label?: string
  active?: boolean
  onBack: () => void
  onSetStatus: (msg: string) => void
}

/**
 * Counts non-whitespace lines in a single pass. Duplicated from ToolShell's
 * FilePanel so this internal FileBox doesn't have to import the helper —
 * the two implementations are kept in sync intentionally.
 */
function countNonEmptyLines(s: string): number {
  let count = 0
  let seenNonWS = false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 10 || c === 13) {
      if (seenNonWS) count++
      seenNonWS = false
    } else if (c !== 32 && c !== 9) {
      seenNonWS = true
    }
  }
  if (seenNonWS) count++
  return count
}

type FileBoxProps = {
  label: string
  filePath: string | null
  initialContent?: string
  onPick: () => void
  onDropPath: (path: string) => void
  onUserEdit?: () => void
  onLineCountChange?: (n: number) => void
}

const FileBox = forwardRef<FilePanelHandle, FileBoxProps>(function FileBox(
  { label, filePath, initialContent = '', onPick, onDropPath, onUserEdit, onLineCountChange },
  ref
) {
  const [dragOver, setDragOver] = useState(false)
  const [lineCount, setLineCount] = useState(() => countNonEmptyLines(initialContent))
  const dropRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const updateLineCount = useCallback(
    (value: string) => {
      const n = countNonEmptyLines(value)
      setLineCount(n)
      onLineCountChange?.(n)
    },
    [onLineCountChange]
  )

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => textareaRef.current?.value ?? '',
      setValue: (s: string) => {
        if (textareaRef.current) {
          textareaRef.current.value = s
          updateLineCount(s)
        }
      }
    }),
    [updateLineCount]
  )

  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    return window.api.files.registerDropZone(el, {
      onDrop: (paths) => {
        setDragOver(false)
        if (paths[0]) onDropPath(paths[0])
      },
      onEnter: () => setDragOver(true),
      onLeave: () => setDragOver(false)
    })
  }, [onDropPath])

  return (
    <Card label={label} badge={lineCount.toLocaleString()} className="min-h-0 flex-1">
      <div
        ref={dropRef}
        className={`relative flex h-full min-h-0 flex-col transition ${
          dragOver ? 'bg-accent-soft' : ''
        }`}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-dashed border-accent" />
        )}
        <textarea
          ref={textareaRef}
          defaultValue={initialContent}
          onChange={(e) => {
            onUserEdit?.()
            updateLineCount(e.target.value)
          }}
          placeholder={`No ${label.toLowerCase()} loaded.\n\nDrop a file, click "Choose", or paste content here.`}
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
          spellCheck={false}
        />
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1 truncate text-[12px] text-text-muted">
            {filePath ?? ''}
          </span>
          <Button onClick={onPick} variant="ghost">
            <Icons.Folder />
            {filePath ? 'Change' : 'Choose'}
          </Button>
        </div>
      </div>
    </Card>
  )
})

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
    file1Label = 'File 1',
    file2Label = 'File 2',
    active = true,
    onBack,
    onSetStatus
  } = props

  const [path1, setPath1] = useState<string | null>(null)
  const [count1, setCount1] = useState(0)
  const [path2, setPath2] = useState<string | null>(null)
  const [count2, setCount2] = useState(0)
  const [results, setResults] = useState<string[] | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const ref1 = useRef<FilePanelHandle>(null)
  const ref2 = useRef<FilePanelHandle>(null)

  const totalLines = count1 + count2

  async function loadInto(which: 1 | 2, path: string) {
    const text = await window.api.files.read(path)
    if (which === 1) {
      setPath1(path)
      ref1.current?.setValue(text)
    } else {
      setPath2(path)
      ref2.current?.setValue(text)
    }
    setResults(null)
    setSavedTo(null)
    onSetStatus(`Loaded file ${which}: ${path}`)
  }

  async function pick(which: 1 | 2) {
    const title = which === 1 ? file1Label : file2Label
    const paths = await window.api.files.open({ title: `Select ${title}` })
    if (paths.length === 0) return
    await loadInto(which, paths[0]!)
  }

  // A file dropped on the Tools landing page lands in slot 1. Re-runs when
  // active toggles so a drop on a card you've already opened still loads.
  useEffect(() => {
    if (!active) return
    const pending = consumePendingFile()
    if (pending) void loadInto(1, pending)
  }, [active])

  function handleClear() {
    setPath1(null)
    setPath2(null)
    ref1.current?.setValue('')
    ref2.current?.setValue('')
    setResults(null)
    setSavedTo(null)
    onSetStatus('Ready')
  }

  async function handleRun() {
    const content1 = ref1.current?.getValue() ?? ''
    const content2 = ref2.current?.getValue() ?? ''
    if (!content1 || !content2) return
    const start = Date.now()
    setRunning(true)
    try {
      const out = transform(content1, content2)
      setResults(out)
      setSavedTo(null)
      onSetStatus(
        out.length === 0 ? emptyResultMessage : `${out.length.toLocaleString()} ${resultUnit}`
      )
    } finally {
      const elapsed = Date.now() - start
      const min = 500
      if (elapsed < min) await new Promise((r) => setTimeout(r, min - elapsed))
      setRunning(false)
    }
  }

  const canRun = count1 > 0 && count2 > 0 && !running
  const hasAny = count1 > 0 || count2 > 0

  const invalidateResults = () => {
    setResults(null)
    setSavedTo(null)
  }

  return (
    <ToolLayout
      title={title}
      onBack={onBack}
      onRun={handleRun}
      running={running}
      banner={
        hasAny ? (
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
          ref={ref1}
          label={file1Label}
          filePath={path1}
          onPick={() => pick(1)}
          onDropPath={(p) => loadInto(1, p)}
          onLineCountChange={setCount1}
          onUserEdit={invalidateResults}
        />
        <FileBox
          ref={ref2}
          label={file2Label}
          filePath={path2}
          onPick={() => pick(2)}
          onDropPath={(p) => loadInto(2, p)}
          onLineCountChange={setCount2}
          onUserEdit={invalidateResults}
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
