import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { filterTools, nextSelection, parseColumnCount, type ArrowDirection } from '../lib/toolSearch'
import type { Route, ToolMeta } from '../types'
import { PageHeader } from '../components/PageHeader'
import { OrderTrackerLogo } from '../components/OrderTrackerLogo'
import { dismissNewTool, getNewToolIds } from '../lib/newTools'
import { loadFavorites, saveFavorites, sortFavoritesFirst, toggleFavorite } from '../lib/favorites'
import { setPendingFile } from '../lib/pending'
import { useFlip } from '../lib/useFlip'

// Exit transition duration (matches `.tool-card` transition in globals.css, 150ms)
// plus a small buffer before the card unmounts.
const EXIT_MS = 170

const tools: ToolMeta[] = [
  {
    id: 'add-passwords',
    title: 'Add Passwords',
    description: 'Append a fixed or random password to each email, as email:password.',
    accent: '#4ade80'
  },
  {
    id: 'sort-list',
    title: 'Alphabetizer',
    description: 'Sort lines alphabetically, A → Z or Z → A.',
    accent: '#84cc16'
  },
  {
    id: 'csv-email-pass',
    title: 'CSV → Email:Password',
    description: 'Pull email & password columns from a CSV into an email:password list.',
    accent: '#60a5fa'
  },
  {
    id: 'csv-filter',
    title: 'CSV Filter',
    description: 'Keep only the CSV columns you pick, reorder them, and choose the separator.',
    accent: '#f97316'
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
    description: 'Lines that appear more than once, in one file or across two.',
    accent: '#7c5cff'
  },
  {
    id: 'find-non-duplicates',
    title: 'Find Non-Duplicates',
    description: 'Lines that appear only once, in one file or across two.',
    accent: '#f59e0b'
  },
  {
    id: 'listify',
    title: 'Listify',
    description: 'Paste a list, then select, mark, reorder, and delete rows.',
    accent: '#e879f9'
  },
  {
    id: 'match-email-pass',
    title: 'Match Email:Password',
    description: 'Keep email:password rows whose email appears in a separate emails list.',
    accent: '#10b981'
  },
  {
    id: 'multiply-lines',
    title: 'Multiply Lines',
    description: 'Repeat each line a set number of times.',
    accent: '#a3e635'
  },
  {
    id: 'numbered-list-generator',
    title: 'Numbered List Generator',
    description: 'Generate a sequential numbered list with a custom prefix.',
    accent: '#fb923c'
  },
  {
    id: 'order-email-by',
    title: 'Order Email By',
    description: 'Sort a list of emails by provider, drag icloud, gmail, yahoo… into your order.',
    accent: '#0ea5e9'
  },
  {
    id: 'order-tracker',
    title: 'Order Tracker',
    description: "Open Iroth's Order Tracker dashboard in your browser.",
    accent: '#E2B377'
  },
  {
    id: 'profile-filter',
    title: 'Profile Filter',
    description: 'Filter a Refract JSON or Shikari CSV export down to a list of emails.',
    accent: '#eab308'
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
    id: 'randomize-proxy-list',
    title: 'Randomize Proxy List',
    description: 'Shuffle a proxy list, favoring providers you weight higher toward the top.',
    accent: '#06b6d4'
  },
  {
    id: 'remove-duplicates',
    title: 'Remove Duplicates',
    description: 'Keep one copy of each line, drop the repeats, in one file or across two.',
    accent: '#14b8a6'
  },
  {
    id: 'remove-passwords',
    title: 'Remove Passwords',
    description: 'Strip the :password from a user:pass list.',
    accent: '#f87171'
  },
  {
    id: 'remove-profile-duplicates',
    title: 'Remove Profile Duplicates',
    description: 'Drop duplicate profiles from a Refract or Shikari export, first one wins.',
    accent: '#fbbf24'
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

// Resolved once per app launch, at import time. `getNewToolIds` also rewrites the
// stored seen-list here, so a badge never outlives the session that introduced it.
const NEW_TOOL_IDS = getNewToolIds(tools.map((t) => t.id))

const ClearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)

const SearchBarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <circle cx="11" cy="11" r="6.5" />
    <line x1="20" y1="20" x2="16" y2="16" />
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

const RemoveDuplicatesIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="3" width="11" height="11" rx="2" />
    <rect x="10" y="10" width="11" height="11" rx="2" />
    <path d="M5.5 8.5h6" />
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

const FavoriteStarIcon = ({ filled }: { filled: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinejoin="round"
    className="h-4 w-4"
  >
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

const CsvFilterIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16" />
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

const ListifyIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </svg>
)

const MultiplyLinesIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M4 6h10M4 12h10M4 18h7" />
    <path d="M16 9l5 5M21 9l-5 5" />
  </svg>
)

const MatchEmailPassIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 8l9 6 9-6" />
    <path d="M15.5 15.5l2 2 3.5-3.5" />
  </svg>
)

const OrderEmailByIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="5" width="13" height="11" rx="2" />
    <path d="M3 7l6.5 4.5L16 7" />
    <path d="M19 9v11" />
    <path d="M16.5 17.5 19 20l2.5-2.5" />
  </svg>
)

const ProfileFilterIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M4 4h16l-6 7v6l-4 2v-8z" />
    <path d="M14.5 14.8l1.7 1.7 3.3-3.4" />
  </svg>
)

const AddPasswordIcon = () => (
  <svg {...SVG_PROPS}>
    {/* plus */}
    <path d="M5.5 10.5v8M1.5 14.5h8" />
    {/* lock body + shackle + keyhole */}
    <rect x="12" y="12" width="9" height="9" rx="2" />
    <path d="M14 12v-1.5a2.5 2.5 0 0 1 5 0V12" />
    <circle cx="16.5" cy="16.5" r="1" />
  </svg>
)

const SortListIcon = () => (
  <svg {...SVG_PROPS}>
    <path d="M4 7h7M4 12h10M4 17h13" />
    <path d="M18 5v13" />
    <path d="M15 15l3 3 3-3" />
  </svg>
)

const ShuffleIcon = () => (
  <svg {...SVG_PROPS}>
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
)

const OrderTrackerIcon = () => <OrderTrackerLogo className="h-full w-full" />

const TOOL_ICONS: Record<ToolMeta['id'], () => JSX.Element> = {
  'add-passwords': AddPasswordIcon,
  'sort-list': SortListIcon,
  'csv-email-pass': CsvEmailPassIcon,
  'csv-filter': CsvFilterIcon,
  'email-cleaner': EmailCleanerIcon,
  'email-filter': FunnelIcon,
  'email-unsubscribe': EmailUnsubscribeIcon,
  'find-duplicates': DuplicatesIcon,
  'find-non-duplicates': StarIcon,
  'listify': ListifyIcon,
  'match-email-pass': MatchEmailPassIcon,
  'multiply-lines': MultiplyLinesIcon,
  'numbered-list-generator': SplitByNumberIcon,
  'order-email-by': OrderEmailByIcon,
  'order-tracker': OrderTrackerIcon,
  'profile-filter': ProfileFilterIcon,
  'proxy-cleaner': ProxyCleanerIcon,
  'proxy-tester': ProxyTesterIcon,
  'randomize': DiceIcon,
  'randomize-proxy-list': ShuffleIcon,
  'remove-duplicates': RemoveDuplicatesIcon,
  'remove-passwords': KeyIcon,
  'remove-profile-duplicates': RemoveDuplicatesIcon,
  'reverse-list': ReverseListIcon,
  'search-master': SearchIcon,
  'split-by-n': SplitByNumberIcon,
  'target-sku': TargetIcon
}

function ToolCard({
  tool,
  onNavigate,
  highlighted,
  isNew,
  favorite,
  onToggleFavorite
}: {
  tool: ToolMeta
  onNavigate: (route: Route) => void
  highlighted?: boolean
  isNew?: boolean
  favorite: boolean
  onToggleFavorite: (id: ToolMeta['id']) => void
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

  // A new card keeps its red border even while arrow-key highlighted; the ring is
  // single-valued, so the highlight takes it and the border carries the red box.
  const borderClass = dragOver
    ? 'border-accent shadow-glow-accent'
    : isNew
      ? 'border-danger'
      : 'border-border hover:border-border-strong'
  const ringClass = highlighted ? 'ring-2 ring-accent' : isNew ? 'ring-2 ring-danger' : ''

  return (
    <div className="group relative h-full transition hover:-translate-y-0.5">
      <button
        ref={dropRef}
        onClick={() => onNavigate(tool.id)}
        className={`relative flex h-full w-full flex-col items-start gap-1.5 rounded-xl border bg-surface p-4 text-left transition hover:bg-surface-2 ${borderClass} ${ringClass}`}
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
        {isNew && (
          <span className="absolute right-3 top-3 rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            New!
          </span>
        )}
        {dragOver && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-accent-soft text-[12px] font-semibold uppercase tracking-wider text-accent">
            Drop to open
          </span>
        )}
      </button>
      {/* Star lives outside the card button: nesting buttons is invalid HTML. */}
      {!isNew && !dragOver && (
        <button
          type="button"
          aria-label={favorite ? `Unfavorite ${tool.title}` : `Favorite ${tool.title}`}
          aria-pressed={favorite}
          onClick={() => onToggleFavorite(tool.id)}
          className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-3 ${
            favorite
              ? 'text-warning'
              : 'text-text-muted opacity-0 hover:text-text-primary focus-visible:opacity-100 group-hover:opacity-100'
          }`}
        >
          <FavoriteStarIcon filled={favorite} />
        </button>
      )}
    </div>
  )
}

type Props = {
  onNavigate: (route: Route) => void
}

export function ToolsPage({ onNavigate }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  // The highlight ring stays hidden until the user navigates with the arrow
  // keys, typing alone never highlights a card.
  const [highlightActive, setHighlightActive] = useState(false)
  // Re-seeded from the module-level set on every mount. Opening a tool unmounts
  // this page, so a dismissal kept only in state would reappear on the way back.
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set(NEW_TOOL_IDS))
  // Favorited tool ids; persisted so they survive relaunches. Favorites sort
  // to the front of the grid, keeping their relative order within each group.
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites())
  const inputRef = useRef<HTMLInputElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const handleToggleFavorite = useCallback((id: ToolMeta['id']) => {
    setFavorites((prev) => {
      const next = toggleFavorite(prev, id)
      saveFavorites(next)
      return next
    })
  }, [])

  const orderedTools = useMemo(() => sortFavoritesFirst(tools, favorites), [favorites])

  // Every route into a tool, card click, Enter from the search box, and
  // drop-a-file-on-a-card, funnels through here, so all three clear the badge.
  const openTool = useCallback(
    (route: Route) => {
      dismissNewTool(route)
      setNewIds(new Set(NEW_TOOL_IDS))
      onNavigate(route)
    },
    [onNavigate]
  )

  const matches = useMemo(() => filterTools(query, orderedTools), [query, orderedTools])

  // Reset the highlight to the first match (and hide it) whenever the query changes.
  useEffect(() => {
    setSelected(0)
    setHighlightActive(false)
  }, [query])

  // Cards kept in the DOM while they animate out (ids mid-exit).
  const [exiting, setExiting] = useState<Set<ToolMeta['id']>>(new Set())
  // Mirror of `exiting` so the effect can read it without listing it as a dep -
  // depending on the state the effect writes would tear down its own timers.
  const exitingRef = useRef(exiting)
  exitingRef.current = exiting
  const prevMatchIds = useRef<Set<ToolMeta['id']>>(new Set(matches.map((t) => t.id)))
  // Pending unmount timers, keyed by card id. Held in a ref so a re-render
  // never cancels them, only re-entry or page unmount does.
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const matchIds = new Set(matches.map((t) => t.id))
    const prev = prevMatchIds.current
    prevMatchIds.current = matchIds

    if (reducedMotion) {
      // No exit animation, drop any leaving cards immediately.
      if (exitingRef.current.size) setExiting(new Set())
      return
    }

    const current = exitingRef.current
    // Cards that just left the matched set start their exit animation.
    const justLeft = [...prev].filter((id) => !matchIds.has(id) && !current.has(id))
    // Cards that re-entered while still exiting: cancel their exit.
    const reentered = [...current].filter((id) => matchIds.has(id))

    if (reentered.length || justLeft.length) {
      setExiting((cur) => {
        const next = new Set(cur)
        reentered.forEach((id) => next.delete(id))
        justLeft.forEach((id) => next.add(id))
        return next
      })
    }

    // Cancel the pending unmount for any card that came back.
    reentered.forEach((id) => {
      const t = exitTimers.current.get(id)
      if (t) {
        clearTimeout(t)
        exitTimers.current.delete(id)
      }
    })

    // Schedule each newly-left card to unmount after its exit transition.
    justLeft.forEach((id) => {
      const timer = setTimeout(() => {
        exitTimers.current.delete(id)
        setExiting((cur) => {
          if (!cur.has(id)) return cur
          const next = new Set(cur)
          next.delete(id)
          return next
        })
      }, EXIT_MS)
      exitTimers.current.set(id, timer)
    })
  }, [matches, reducedMotion])

  // Clear any outstanding timers when the page unmounts.
  useEffect(() => {
    const timers = exitTimers.current
    return () => timers.forEach((t) => clearTimeout(t))
  }, [])

  // Cards to render: current matches, favorites first, plus any still exiting.
  const matchIdSet = new Set(matches.map((t) => t.id))
  const rendered = orderedTools.filter((t) => matchIdSet.has(t.id) || exiting.has(t.id))

  const { setRef } = useFlip(rendered.map((t) => t.id).join('|'), !reducedMotion)

  // Type-anywhere: a printable key (no modifier) routes into the search box,
  // even if focus drifted. Scoped to this page, it unmounts on navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.length !== 1) return
      const active = document.activeElement
      if (active === inputRef.current) return
      // Yield to other focused controls (e.g. Space/Enter on a Tab-focused card).
      if (
        active instanceof HTMLElement &&
        ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)
      )
        return
      e.preventDefault()
      setQuery((q) => q + e.key)
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const readColumnCount = () => {
    const grid = gridRef.current
    if (!grid) return 1
    return parseColumnCount(getComputedStyle(grid).gridTemplateColumns)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const target = matches[selected] ?? matches[0]
      if (target) openTool(target.id)
      return
    }
    if (e.key === 'Escape') {
      setQuery('')
      setSelected(0)
      setHighlightActive(false)
      return
    }
    const arrows: Record<string, ArrowDirection> = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down'
    }
    const dir = arrows[e.key]
    if (dir) {
      // Left/Right only drive grid nav when the caret sits at the matching
      // edge with no selection, so mid-string caret editing still works.
      const input = e.currentTarget
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0
      const atEnd =
        input.selectionStart === query.length && input.selectionEnd === query.length
      if (dir === 'left' && !atStart) return
      if (dir === 'right' && !atEnd) return
      e.preventDefault()
      setHighlightActive(true)
      setSelected((s) => nextSelection(s, matches.length, readColumnCount(), dir))
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tools"
        subtitle="Drag and drop a file on a module or choose a module."
      />

      <div className="px-8 pb-4">
        <div className="relative max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            <SearchBarIcon />
          </span>
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search tools…"
            aria-label="Search tools"
            className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-9 text-[13px] text-text-primary placeholder:text-text-muted outline-none transition focus:border-accent"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-text-muted transition hover:bg-surface-2 hover:text-text-primary"
            >
              <ClearIcon />
            </button>
          )}
        </div>
      </div>

      {rendered.length === 0 ? (
        <div role="status" className="px-8 pb-8 text-[13px] text-text-muted">
          No tools match &ldquo;{query}&rdquo;
        </div>
      ) : (
        <div
          ref={gridRef}
          className="grid auto-rows-[160px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 px-8 pb-8"
        >
          {rendered.map((t) => {
            const matchIndex = matches.findIndex((m) => m.id === t.id)
            const isExiting = exiting.has(t.id) && matchIndex === -1
            return (
              <div
                key={t.id}
                ref={setRef(t.id)}
                className={`tool-card h-full${isExiting ? ' tool-card--exit' : ''}`}
                style={{ animationDelay: `${Math.min(matchIndex < 0 ? 0 : matchIndex * 15, 90)}ms` }}
              >
                <ToolCard
                  tool={t}
                  onNavigate={openTool}
                  highlighted={highlightActive && matchIndex === selected && matchIndex !== -1}
                  isNew={newIds.has(t.id)}
                  favorite={favorites.has(t.id)}
                  onToggleFavorite={handleToggleFavorite}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
