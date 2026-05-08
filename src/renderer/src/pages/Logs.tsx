import { useEffect, useRef } from 'react'
import { PageHeader } from '../components/PageHeader'
import type { LogEntry } from '../types'

function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function colorFor(kind: LogEntry['kind']): string {
  switch (kind) {
    case 'success':
      return 'text-success'
    case 'error':
      return 'text-danger'
    default:
      return 'text-text-primary'
  }
}

export function LogsPage({ logs }: { logs: LogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Logs"
        subtitle={
          logs.length === 0
            ? 'No activity yet.'
            : `${logs.length} entr${logs.length === 1 ? 'y' : 'ies'}`
        }
      />
      <div className="px-8 pb-8">
        {logs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/50 p-10 text-center text-[14px] text-text-secondary">
            Log activity (auto-updater status, errors) will appear here.
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-surface p-4 font-mono text-[12.5px] leading-relaxed"
          >
            {logs.map((entry, i) => (
              <div key={i} className="flex gap-3">
                <span className="shrink-0 text-text-muted">
                  [{formatTime(entry.time)}]
                </span>
                <span className={`break-all ${colorFor(entry.kind)}`}>{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
