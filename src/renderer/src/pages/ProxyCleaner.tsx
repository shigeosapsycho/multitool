import { useMemo, useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import { Button } from '../components/ToolShell'
import { filterProxies, detectProviders, detectIspUsers, type ProxyFilters } from '../lib/proxy'
import { setPendingProxies } from '../lib/pending'
import type { Route } from '../types'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  onNavigate: (route: Route) => void
  active?: boolean
}

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
)

/** A single on/off filter chip, styled to match ModeToggle's segments. */
function FilterChip({
  active,
  onToggle,
  children
}: {
  active: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition ${
        active ? 'bg-accent-soft text-accent' : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      <span className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border ${
        active ? 'border-accent bg-accent text-bg' : 'border-border'
      }`}>
        {active && <CheckIcon />}
      </span>
      {children}
    </button>
  )
}

export function ProxyCleanerPage({ onBack, onSetStatus, onNavigate, active }: Props) {
  const [filters, setFilters] = useState<ProxyFilters>({ residential: true, isp: true })
  const [content, setContent] = useState('')
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [removedUsers, setRemovedUsers] = useState<Set<string>>(() => new Set())

  const providers = useMemo(() => detectProviders(content), [content])
  const ispUsers = useMemo(() => detectIspUsers(content), [content])

  function toggleProvider(provider: string) {
    setRemoved((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  function toggleIspUser(user: string) {
    setRemovedUsers((prev) => {
      const next = new Set(prev)
      if (next.has(user)) next.delete(user)
      else next.add(user)
      return next
    })
  }

  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="inline-flex items-center gap-1 self-start rounded-lg border border-border bg-surface p-1">
        <FilterChip
          active={filters.residential}
          onToggle={() => setFilters((f) => ({ ...f, residential: !f.residential }))}
        >
          Residential
        </FilterChip>
        <FilterChip
          active={filters.isp}
          onToggle={() => setFilters((f) => ({ ...f, isp: !f.isp }))}
        >
          ISPs
        </FilterChip>
      </div>
      {providers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="pr-1 text-[12px] text-text-muted">Providers:</span>
          {providers.map(({ provider, count }) => (
            <FilterChip
              key={provider}
              active={!removed.has(provider)}
              onToggle={() => toggleProvider(provider)}
            >
              {provider} · {count.toLocaleString()}
            </FilterChip>
          ))}
        </div>
      )}
      {ispUsers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="pr-1 text-[12px] text-text-muted">ISP users:</span>
          {ispUsers.map(({ user, count }) => (
            <FilterChip
              key={user}
              active={!removedUsers.has(user)}
              onToggle={() => toggleIspUser(user)}
            >
              {user} · {count.toLocaleString()}
            </FilterChip>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <SingleFileTool
      title="Proxy Cleaner"
      hint="Keep only Residential and/or ISP proxies. Remove specific providers or ISP accounts with the chips in the header."
      taskName="filtered-proxies"
      inputLabel="Proxy List"
      resultLabel="Filtered Proxies"
      resultUnit="proxies"
      emptyResultMessage="No proxies matched the selected filters."
      runLabel="Filter Proxies"
      transform={(text) => filterProxies(text, filters, removed, removedUsers)}
      pickerTitle="Select a proxy list"
      toolbar={toolbar}
      onContentChange={setContent}
      resultActions={(results) => (
        <Button
          variant="secondary"
          onClick={() => {
            setPendingProxies(results.join('\n') + '\n')
            onNavigate('proxy-tester')
          }}
        >
          <SendIcon />
          Send to Proxy Tester
        </Button>
      )}
      active={active}
      onBack={onBack}
      onSetStatus={onSetStatus}
    />
  )
}
