import { useEffect, useRef, useState } from 'react'
import type { Route, ToolMeta } from '../types'
import { PageHeader } from '../components/PageHeader'
import { setPendingFile } from '../lib/pending'

const tools: ToolMeta[] = [
  {
    id: 'csv-email-pass',
    title: 'CSV → Email:Password',
    description: 'Pull email & password columns from a CSV into an email:password list.',
    accent: '#60a5fa'
  },
  {
    id: 'email-cleaner',
    title: 'Email Cleaner',
    description: 'Scan an IMAP inbox by date and delete unwanted email.',
    accent: '#fb7185'
  },
  {
    id: 'email-filter',
    title: 'Email Filter',
    description: 'Remove emails from a master list that already appear in a success list.',
    accent: '#2dd4bf'
  },
  {
    id: 'email-unsubscribe',
    title: 'Email Unsubscribe',
    description: 'Scan an IMAP inbox and unsubscribe from unwanted mailing lists.',
    accent: '#a78bfa'
  },
  {
    id: 'find-duplicates',
    title: 'Find Duplicates',
    description: 'Lines that appear more than once — in one file or across two.',
    accent: '#7c5cff'
  },
  {
    id: 'find-non-duplicates',
    title: 'Find Non-Duplicates',
    description: 'Lines that appear only once — in one file or across two.',
    accent: '#f59e0b'
  },
  {
    id: 'match-email-pass',
    title: 'Match Email:Password',
    description: 'Keep email:password rows whose email appears in a separate emails list.',
    accent: '#10b981'
  },
  {
    id: 'proxy-cleaner',
    title: 'Proxy Cleaner',
    description: 'Filter a proxy list down to residential and/or ISP proxies.',
    accent: '#818cf8'
  },
  {
    id: 'proxy-tester',
    title: 'Proxy Tester',
    description: 'Ping a URL and report latency. Optional proxy.',
    accent: '#38bdf8'
  },
  {
    id: 'randomize',
    title: 'Randomize List',
    description: 'Shuffle the lines in random order.',
    accent: '#f472b6'
  },
  {
    id: 'remove-passwords',
    title: 'Remove Passwords',
    description: 'Strip the :password from a user:pass list.',
    accent: '#f87171'
  },
  {
    id: 'reverse-list',
    title: 'Reverse List',
    description: 'Reverse the order of lines in a file.',
    accent: '#c084fc'
  },
  {
    id: 'search-master',
    title: 'Search Master',
    description: 'Find items from a search list that also appear in a master list.',
    accent: '#34d399'
  },
  {
    id: 'split-by-n',
    title: 'Split by Number',
    description: 'Split a file into N evenly-sized parts.',
    accent: '#22d3ee'
  },
  {
    id: 'target-sku',
    title: 'Target SKUs',
    description: 'Pick Target trading-card SKUs and export them in a bot format.',
    accent: '#cc0000'
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

const FunnelIcon = () => (
  <svg {...SVG_PROPS}>
    <polygon points="3 4 21 4 14 13 14 20 10 18 10 13" />
  </svg>
)

const CsvEmailPassIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="3" width="14" height="18" rx="2" />
    <path d="M7 8h6M7 12h6M7 16h4" />
    <path d="M15 14l4 0M19 12l2 2-2 2" />
  </svg>
)

const ProxyTesterIcon = () => (
  <svg {...SVG_PROPS}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18" />
    <path d="M12 3a14 14 0 0 0 0 18" />
  </svg>
)

const ReverseListIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M7 4v16" />
    <polyline points="3 8 7 4 11 8" />
    <path d="M17 20V4" />
    <polyline points="13 16 17 20 21 16" />
  </svg>
)

const EmailCleanerIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
)

const ProxyCleanerIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M13 3 12 13" />
    <path d="M8.5 13h7l2 8h-11z" />
    <path d="M7.7 16.5h8.6" />
    <path d="M12 16.5V21M10 16.5 9.2 21M14 16.5l.8 4.5" />
  </svg>
)

const EmailUnsubscribeIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 8l9 6 9-6" />
    <path d="M8 17h8" />
  </svg>
)

const TargetIcon = () => (
  <svg {...SVG_PROPS}>
    <circle cx="12" cy="12" r="8.5" strokeWidth="3" />
    <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
  </svg>
)

const MatchEmailPassIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 8l9 6 9-6" />
    <path d="M15.5 15.5l2 2 3.5-3.5" />
  </svg>
)

const TOOL_ICONS: Record<ToolMeta['id'], () => JSX.Element> = {
  'csv-email-pass': CsvEmailPassIcon,
  'email-cleaner': EmailCleanerIcon,
  'email-filter': FunnelIcon,
  'email-unsubscribe': EmailUnsubscribeIcon,
  'find-duplicates': DuplicatesIcon,
  'find-non-duplicates': StarIcon,
  'match-email-pass': MatchEmailPassIcon,
  'proxy-cleaner': ProxyCleanerIcon,
  'proxy-tester': ProxyTesterIcon,
  'randomize': DiceIcon,
  'remove-passwords': KeyIcon,
  'reverse-list': ReverseListIcon,
  'search-master': SearchIcon,
  'split-by-n': SplitByNumberIcon,
  'target-sku': TargetIcon
}

function ToolCard({
  tool,
  onNavigate
}: {
  tool: ToolMeta
  onNavigate: (route: Route) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const dropRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = dropRef.current
    if (!el) return
    return window.api.files.registerDropZone(el, {
      onDrop: (paths) => {
        setDragOver(false)
        if (paths[0]) {
          setPendingFile(paths[0])
          onNavigate(tool.id)
        }
      },
      onEnter: () => setDragOver(true),
      onLeave: () => setDragOver(false)
    })
  }, [onNavigate, tool.id])

  return (
    <button
      ref={dropRef}
      onClick={() => onNavigate(tool.id)}
      className={`group relative flex flex-col items-start gap-1.5 rounded-xl border bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:bg-surface-2 ${
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
      <span className="text-[14px] font-semibold tracking-tight text-text-primary">
        {tool.title}
      </span>
      <span className="text-[12px] leading-snug text-text-secondary">
        {tool.description}
      </span>
      <span className="absolute right-3 top-4 text-text-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">
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
        subtitle="Drag and drop a file on a module or choose a module."
      />
      <div className="grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 px-8 pb-8">
        {tools.map((t) => (
          <ToolCard key={t.id} tool={t} onNavigate={onNavigate} />
        ))}
      </div>
    </div>
  )
}
