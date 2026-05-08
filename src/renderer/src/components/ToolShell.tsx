import { useEffect, useState, type ReactNode, type DragEvent } from 'react'
import { PageHeader, Button } from './PageHeader'
import { StatusBanner, Stat } from './StatusBanner'
import { Card } from './Card'

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

export const Icons = {
  Folder: FolderIcon,
  Play: PlayIcon,
  Trash: TrashIcon,
  Save: SaveIcon,
  Reveal: RevealIcon
}

type FilePanelProps = {
  label: string
  filePath: string | null
  content: string
  onContentChange: (s: string) => void
  onPick: () => void
  onDropPath?: (path: string) => void
  placeholder?: string
  className?: string
}

export function FilePanel({
  label,
  filePath,
  content,
  onContentChange,
  onPick,
  onDropPath,
  placeholder,
  className
}: FilePanelProps) {
  const [dragOver, setDragOver] = useState(false)
  const lineCount = content
    ? content.split(/\r?\n/).filter((l) => l.trim().length > 0).length
    : 0

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const p = window.api.files.pathForFile(file)
    if (p && onDropPath) onDropPath(p)
  }

  return (
    <Card label={label} badge={lineCount.toLocaleString()} className={className}>
      <div
        className={`relative flex h-full min-h-0 flex-col transition ${
          dragOver ? 'bg-accent-soft' : ''
        }`}
        onDragOver={(e) => {
          if (!onDropPath) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-dashed border-accent" />
        )}
        <textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder={
            placeholder ??
            'No file loaded.\n\nDrop a file, click "Choose File", or paste content here.'
          }
          className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none placeholder:text-text-muted"
          spellCheck={false}
        />
        <div className="flex items-center gap-2 border-t border-border p-3">
          <span className="flex-1 truncate text-[12px] text-text-muted">
            {filePath ?? 'No file selected'}
          </span>
          <Button onClick={onPick} variant="ghost">
            <FolderIcon />
            {filePath ? 'Change' : 'Choose'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

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
}

export function ResultPanel({
  label,
  results,
  emptyMessage,
  initialMessage = 'Run to populate.',
  taskName,
  savedTo,
  onSaved
}: ResultPanelProps) {
  async function handleSave() {
    if (!results || results.length === 0) return
    const path = await window.api.files.writeOutput(taskName, results.join('\n') + '\n')
    onSaved(path)
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
          <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12.5px] leading-relaxed text-text-primary">
            {results.map((d, i) => (
              <div key={i} className="break-all">
                {d}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-border p-3">
            {savedTo ? (
              <>
                <span className="flex-1 truncate text-[12px] text-text-secondary">
                  Saved to <span className="text-text-primary">{savedTo}</span>
                </span>
                <Button onClick={() => window.api.files.reveal(savedTo)} variant="ghost">
                  <RevealIcon />
                  Reveal
                </Button>
              </>
            ) : (
              <Button onClick={handleSave} variant="secondary">
                <SaveIcon />
                Save to output/
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
  onBack: () => void
  onRun?: () => void
  running?: boolean
  actions: ReactNode
  children: ReactNode
}

export function ToolLayout({ title, hint, banner, onBack, onRun, running, actions, children }: ToolLayoutProps) {
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
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-1 gap-4 px-8 pb-8 pt-4">{children}</div>
    </div>
  )
}

export { Stat, Button }
