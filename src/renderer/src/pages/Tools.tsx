import { useState, type DragEvent } from 'react'
import type { Route, ToolMeta } from '../types'
import { PageHeader } from '../components/PageHeader'
import { setPendingFile } from '../lib/pending'

const tools: ToolMeta[] = [
  {
    id: 'find-duplicates',
    title: 'Find Duplicates',
    description: 'Identify lines that appear more than once in a file.',
    accent: '#7c5cff'
  },
  {
    id: 'find-duplicates-2',
    title: 'Duplicates Across 2 Files',
    description: 'Compare two files and report lines that overlap.',
    accent: '#a78bfa'
  },
  {
    id: 'remove-passwords',
    title: 'Remove Passwords',
    description: 'Strip the :password from a user:pass list.',
    accent: '#34d399'
  },
  {
    id: 'find-non-duplicates',
    title: 'Find Non-Duplicates',
    description: 'Lines that appear only once in a file.',
    accent: '#f59e0b'
  },
  {
    id: 'find-non-duplicates-2',
    title: 'Non-Dupes Across 2 Files',
    description: 'Lines unique within the union of two files.',
    accent: '#fbbf24'
  },
  {
    id: 'split-evenly',
    title: 'Split File Evenly',
    description: 'Halve a file into two parts, line-aligned.',
    accent: '#60a5fa'
  },
  {
    id: 'split-by-n',
    title: 'Split by Number',
    description: 'Split a file into N evenly-sized parts.',
    accent: '#22d3ee'
  },
  {
    id: 'randomize',
    title: 'Randomize List',
    description: 'Shuffle the lines in random order.',
    accent: '#f472b6'
  }
]

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

function ToolCard({
  tool,
  onNavigate
}: {
  tool: ToolMeta
  onNavigate: (route: Route) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const p = (file as unknown as { path?: string }).path
    if (p) {
      setPendingFile(p)
      onNavigate(tool.id)
    }
  }

  return (
    <button
      onClick={() => onNavigate(tool.id)}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`group relative flex flex-col items-start gap-2 rounded-xl border bg-surface p-5 text-left transition hover:-translate-y-0.5 hover:bg-surface-2 ${
        dragOver
          ? 'border-accent shadow-glow-accent'
          : 'border-border hover:border-border-strong'
      }`}
    >
      <span
        className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-lg"
        style={{
          backgroundColor: `${tool.accent}1f`,
          color: tool.accent
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-text-primary">
        {tool.title}
      </span>
      <span className="text-[12.5px] leading-relaxed text-text-secondary">
        {tool.description}
      </span>
      <span className="absolute right-4 top-5 text-text-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">
        <ChevronIcon />
      </span>
      {dragOver && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent-soft text-[12px] font-semibold uppercase tracking-wider text-accent">
          Drop to open
        </span>
      )}
    </button>
  )
}

type Props = {
  onNavigate: (route: Route) => void
}

export function ToolsPage({ onNavigate }: Props) {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tools"
        subtitle="Pick a utility to get started — or drop a file onto one."
      />
      <div className="grid grid-cols-2 gap-4 px-8 pb-8 xl:grid-cols-3">
        {tools.map((t) => (
          <ToolCard key={t.id} tool={t} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}
