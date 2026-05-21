import { useState } from 'react'
import { SingleFileTool } from './SingleFileTool'
import { Button } from '../components/ToolShell'
import { filterProxies, type ProxyFilters } from '../lib/proxy'
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

export function ResiCleanerPage({ onBack, onSetStatus, onNavigate, active }: Props) {
  const [filters, setFilters] = useState<ProxyFilters>({ residential: true, isp: true })

  const toolbar = (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
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
  )

  return (
    <SingleFileTool
      title="Resi Cleaner"
      hint="Keep only Residential and/or ISP proxies. Toggle filters in the header."
      taskName="filtered-proxies"
      inputLabel="Proxy List"
      resultLabel="Filtered Proxies"
      resultUnit="proxies"
      emptyResultMessage="No proxies matched the selected filters."
      runLabel="Filter Proxies"
      transform={(text) => filterProxies(text, filters)}
      pickerTitle="Select a proxy list"
      toolbar={toolbar}
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
