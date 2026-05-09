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
    accent: '#f87171'
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
  },
  {
    id: 'search-master',
    title: 'Search Master',
    description: 'Find items from a search list that also appear in a master list.',
    accent: '#34d399'
  }
]

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

const SVG_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'h-5 w-5'
}

const DuplicatesIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="3" width="13" height="13" rx="2" />
    <rect x="8" y="8" width="13" height="13" rx="2" />
  </svg>
)

const Duplicates2Icon = () => (
  <svg {...SVG_PROPS}>
    <rect x="2" y="4" width="8" height="16" rx="1.5" />
    <rect x="14" y="4" width="8" height="16" rx="1.5" />
    <circle cx="12" cy="12" r="2.2" />
  </svg>
)

const KeyIcon = () => (
  <svg {...SVG_PROPS}>
    <circle cx="12" cy="12" r="9" />
    <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" />
    <circle cx="9" cy="12" r="2" />
    <path d="M11 12 L17 12" />
    <path d="M15 12 L15 14" />
    <path d="M17 12 L17 14" />
  </svg>
)

const StarIcon = () => (
  <svg {...SVG_PROPS}>
    <polygon points="12 3 14.5 9 21 9.5 16 13.5 17.5 20 12 16.5 6.5 20 8 13.5 3 9.5 9.5 9" />
  </svg>
)

const NonDupes2Icon = () => (
  <svg {...SVG_PROPS}>
    <rect x="2" y="4" width="8" height="16" rx="1.5" />
    <rect x="14" y="4" width="8" height="16" rx="1.5" />
    <path d="M10.5 10.5 L13.5 13.5" />
    <path d="M13.5 10.5 L10.5 13.5" />
  </svg>
)

const SplitEvenlyIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="4" y="3" width="16" height="8" rx="1.5" />
    <rect x="4" y="13" width="16" height="8" rx="1.5" />
  </svg>
)

const SplitByNumberIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="3" width="18" height="3" rx="0.8" />
    <rect x="3" y="8" width="18" height="3" rx="0.8" />
    <rect x="3" y="13" width="18" height="3" rx="0.8" />
    <rect x="3" y="18" width="18" height="3" rx="0.8" />
  </svg>
)

const DiceIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="8" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="16" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="16" cy="16" r="1.1" fill="currentColor" stroke="none" />
  </svg>
)

const SearchIcon = () => (
  <svg {...SVG_PROPS}>
    <circle cx="11" cy="11" r="6.5" />
    <line x1="20" y1="20" x2="16" y2="16" />
  </svg>
)

const TOOL_ICONS: Record<ToolMeta['id'], () => JSX.Element> = {
  'find-duplicates': DuplicatesIcon,
  'find-duplicates-2': Duplicates2Icon,
  'remove-passwords': KeyIcon,
  'find-non-duplicates': StarIcon,
  'find-non-duplicates-2': NonDupes2Icon,
  'split-evenly': SplitEvenlyIcon,
  'split-by-n': SplitByNumberIcon,
  'randomize': DiceIcon,
  'search-master': SearchIcon
}

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
    const p = window.api.files.pathForFile(file)
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
        {(TOOL_ICONS[tool.id] ?? DuplicatesIcon)()}
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
      <div className="grid auto-rows-fr grid-cols-2 gap-4 px-8 pb-8 xl:grid-cols-3">
        {tools.map((t) => (
          <ToolCard key={t.id} tool={t} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}
