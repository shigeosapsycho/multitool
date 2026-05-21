import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { PageHeader, Button } from './PageHeader'
import { StatusBanner, Stat } from './StatusBanner'
import { Card } from './Card'
import { shortOutputPath } from '../lib/paths'

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
)

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
    <polygon points="6 4 20 12 6 20" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
  </svg>
)

const SaveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
)

const RevealIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M14 3h7v7" />
    <path d="M21 3 12 12" />
    <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
  </svg>
)

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

export const Icons = {
  Folder: FolderIcon,
  Play: PlayIcon,
  Trash: TrashIcon,
  Save: SaveIcon,
  Reveal: RevealIcon,
  Copy: CopyIcon
}

export type FilePanelHandle = {
  getValue: () => string
  setValue: (s: string) => void
}

type FilePanelProps = {
  label: string
  filePath: string | null
  /**
   * Initial textarea content. Read once; subsequent updates go through the
   * imperative ref (parents call `setValue` after pick/drop/clear). The
   * textarea itself is uncontrolled so 20k-line pastes don't re-render
   * the parent on every keystroke.
   */
  initialContent?: string
  onPick: () => void
  onDropPath?: (path: string) => void
  /** Called once per user edit (typing, paste). Use to invalidate stale results. */
  onUserEdit?: () => void
  /** Called whenever the line count changes. Used for banner stats and Run-button gating. */
  onLineCountChange?: (n: number) => void
  placeholder?: string
  className?: string
}

/**
 * Counts non-whitespace lines in `s` in a single pass. ~10x faster than
 * `s.split(/\r?\n/).filter(...)` on multi-MB inputs because it avoids the
 * intermediate array allocation.
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

export const FilePanel = forwardRef<FilePanelHandle, FilePanelProps>(function FilePanel(
  {
    label,
    filePath,
    initialContent = '',
    onPick,
    onDropPath,
    onUserEdit,
    onLineCountChange,
    placeholder,
    className
  },
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
    if (!el || !onDropPath) return
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
    <Card label={label} badge={lineCount.toLocaleString()} className={className}>
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
          placeholder={
            placeholder ??
            'No file loaded.\n\nDrop a file, click "Choose File", or paste content here.'
          }
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
          spellCheck={false}
        />
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1 truncate text-[12px] text-text-muted">
            {filePath ?? ''}
          </span>
          <Button onClick={onPick} variant="ghost">
            <FolderIcon />
            {filePath ? 'Change' : 'Choose'}
          </Button>
        </div>
      </div>
    </Card>
  )
})

type ResultPanelProps = {
  label: string
  results: string[] | null
  emptyMessage: string
  initialMessage?: string
  taskName: string
  savedTo: string | null
  onSaved: (path: string) => void
  badgeOverride?: ReactNode
  emptyIsError?: boolean
  /** Extra action(s) rendered in the footer when there are results. */
  footerActions?: (results: string[]) => ReactNode
}

export function ResultPanel({
  label,
  results,
  emptyMessage,
  initialMessage = 'Run to populate.',
  taskName,
  savedTo,
  onSaved,
  footerActions
}: ResultPanelProps) {
  const [copied, setCopied] = useState(false)

  async function handleSave() {
    if (!results || results.length === 0) return
    const path = await window.api.files.writeOutput(taskName, results.join('\n') + '\n')
    onSaved(path)
  }

  async function handleCopy() {
    if (!results || results.length === 0) return
    try {
      await navigator.clipboard.writeText(results.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can reject if the window isn't focused; the user can retry.
    }
  }

  return (
    <Card
      label={label}
      badge={results !== null ? results.length.toLocaleString() : '—'}
    >
      {results === null ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
          {initialMessage}
        </div>
      ) : results.length === 0 ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-secondary">
          {emptyMessage}
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <textarea
            readOnly
            value={results.join('\n')}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none"
          />
          <div className="flex items-center gap-2 border-t border-border p-3">
            {savedTo ? (
              <span className="flex-1 truncate text-[12px] text-text-secondary">
                Saved to <span className="text-text-primary">{shortOutputPath(savedTo)}</span>
              </span>
            ) : (
              <span className="flex-1" />
            )}
            <Button onClick={handleCopy} variant="ghost">
              <CopyIcon />
              {copied ? 'Copied!' : 'Copy all'}
            </Button>
            {footerActions?.(results)}
            {savedTo ? (
              <Button onClick={() => window.api.files.reveal(savedTo)} variant="ghost">
                <RevealIcon />
                Reveal
              </Button>
            ) : (
              <Button onClick={handleSave} variant="secondary">
                <SaveIcon />
                Save to Output
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

type ToolLayoutProps = {
  title: string
  hint?: ReactNode
  banner?: ReactNode
  /** Optional control row rendered between the status banner and the panels. */
  toolbar?: ReactNode
  onBack: () => void
  onRun?: () => void
  running?: boolean
  actions: ReactNode
  children: ReactNode
}

export function ToolLayout({ title, hint, banner, toolbar, onBack, onRun, running, actions, children }: ToolLayoutProps) {
  useEffect(() => {
    if (!onRun) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        onRun()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onRun])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={title} onBack={onBack} actions={actions} />
      <StatusBanner spinning={running}>{banner ?? hint}</StatusBanner>
      {toolbar && <div className="px-8 pt-4">{toolbar}</div>}
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 px-8 pb-8 pt-4">{children}</div>
    </div>
  )
}

export { Stat, Button }
