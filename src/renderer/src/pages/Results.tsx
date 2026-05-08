import { useEffect, useState, useCallback } from 'react'
import { PageHeader, Button } from '../components/PageHeader'
import { Icons } from '../components/ToolShell'

type Entry = { path: string; name: string; size: number; mtime: number }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleString()
}

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)

export function ResultsPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.files.listOutput()
      setEntries(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Results"
        subtitle={
          loading
            ? 'Loading…'
            : entries.length === 0
              ? 'No output files yet.'
              : `${entries.length} file${entries.length === 1 ? '' : 's'} in output/`
        }
        actions={
          <>
            <Button onClick={() => void load()} variant="ghost">
              <RefreshIcon />
              Refresh
            </Button>
            <Button
              onClick={async () => {
                const result = await window.api.files.clearOutput()
                if (!result.canceled) await load()
              }}
              variant="ghost"
              disabled={entries.length === 0}
            >
              <Icons.Trash />
              Clear
            </Button>
            <Button onClick={() => window.api.files.openOutputDir()} variant="secondary">
              <Icons.Folder />
              Open Folder
            </Button>
          </>
        }
      />

      <div className="px-8 pb-8">
        {entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/50 p-10 text-center text-[14px] text-text-secondary">
            Run any tool and saved output will appear here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wider text-text-secondary">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Size</th>
                  <th className="px-4 py-3 font-semibold">Modified</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.path}
                    className="border-b border-border last:border-b-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-3 font-mono text-text-primary">{e.name}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatBytes(e.size)}</td>
                    <td className="px-4 py-3 text-text-secondary">{formatTime(e.mtime)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => window.api.files.reveal(e.path)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-text-secondary transition hover:bg-surface-3 hover:text-text-primary"
                      >
                        <Icons.Reveal />
                        Reveal
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
