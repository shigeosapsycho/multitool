import type { Route } from '../types'

type SidebarItem = {
  id: 'tools' | 'results' | 'settings' | 'logs'
  label: string
  icon: JSX.Element
}

const ToolsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
  </svg>
)

const ResultsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="14" y2="18" />
  </svg>
)

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)

const LogsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <polyline points="6 9 11 14 6 19" />
    <line x1="14" y1="19" x2="20" y2="19" />
  </svg>
)

const items: SidebarItem[] = [
  { id: 'tools', label: 'Tools', icon: <ToolsIcon /> },
  { id: 'results', label: 'Output', icon: <ResultsIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
  { id: 'logs', label: 'Logs', icon: <LogsIcon /> }
]

const TOOL_ROUTES = new Set<Route>([
  'csv-email-pass',
  'email-unsubscribe',
  'find-duplicates',
  'find-non-duplicates',
  'proxy-cleaner',
  'randomize',
  'remove-passwords',
  'split-by-n'
])

function topLevelOf(route: Route): SidebarItem['id'] {
  if (route === 'tools' || TOOL_ROUTES.has(route)) return 'tools'
  return route as SidebarItem['id']
}

type Props = {
  current: Route
  onNavigate: (route: Route) => void
}

export function Sidebar({ current, onNavigate }: Props) {
  const top = topLevelOf(current)

  return (
    <nav className="flex w-[88px] shrink-0 flex-col items-center gap-2 border-r border-border bg-bg py-4">
      {items.map((item) => {
        const active = top === item.id
        return (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`group relative flex h-[68px] w-[72px] flex-col items-center justify-center gap-1.5 rounded-lg transition ${
              active
                ? 'bg-accent-soft text-accent'
                : 'text-text-secondary hover:bg-surface hover:text-text-primary'
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-accent" />
            )}
            <span className="flex h-6 w-6 items-center justify-center">{item.icon}</span>
            <span className="text-[11px] font-medium tracking-tight">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
