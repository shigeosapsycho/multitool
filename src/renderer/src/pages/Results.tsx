import { useEffect, useState, useCallback } from 'react'
import { PageHeader, Button } from '../components/PageHeader'
import { Icons } from '../components/ToolShell'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { ConfirmDialog } from '../components/ConfirmDialog'

type Entry = { path: string; name: string; size: number; mtime: number }

type ConfirmConfig = {
  title: string
  message: string
  detail?: string
  confirmLabel: string
  onConfirm: () => Promise<void> | void
}

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

type Props = {
  filePreview: boolean
}

export function ResultsPage({ filePreview }: Props) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; entry: Entry } | null>(null)
  const [confirm, setConfirm] = useState<ConfirmConfig | null>(null)
  const [selected, setSelected] = useState<Entry | null>(null)
  const [previewText, setPreviewText] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.files.listOutput()
      setEntries(list)
      // Drop selection if the file disappeared.
      setSelected((prev) => (prev && list.some((e) => e.path === prev.path) ? prev : null))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh when files appear or disappear in the output folder.
  useEffect(() => {
    return window.api.files.onOutputChanged(() => {
      void load()
    })
  }, [load])

  // Reload preview content when selection changes (only in preview mode).
  useEffect(() => {
    if (!filePreview || !selected) {
      setPreviewText('')
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    void (async () => {
      try {
        const text = await window.api.files.read(selected.path)
        if (cancelled) return
        setPreviewText(text)
      } catch {
        if (!cancelled) setPreviewText('(failed to read file)')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filePreview, selected])

  function handleSelect(entry: Entry) {
    if (!filePreview) return
    setSelected((prev) => (prev?.path === entry.path ? prev : entry))
  }

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
              onClick={() => {
                setConfirm({
                  title: 'Clear output folder',
                  message: 'Delete all .txt files in the output folder?',
                  detail: 'This cannot be undone.',
                  confirmLabel: 'Delete All',
                  onConfirm: async () => {
                    await window.api.files.clearOutput()
                    await load()
                  }
                })
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

      <div className="min-h-0 flex-1 px-8 pb-8">
        {entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface/50 p-10 text-center text-[14px] text-text-secondary">
            Run any tool and saved output will appear here.
          </div>
        ) : filePreview ? (
          <div className="grid h-full min-h-0 grid-cols-[minmax(320px,2fr)_3fr] gap-4">
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="h-full overflow-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 z-10 bg-surface-2 text-[11px] uppercase tracking-wider text-text-secondary shadow-[inset_0_-1px_0_var(--tw-shadow-color)] shadow-border">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Name</th>
                      <th className="px-4 py-3 font-semibold">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const isSelected = selected?.path === e.path
                      return (
                        <tr
                          key={e.path}
                          onClick={() => handleSelect(e)}
                          onContextMenu={(ev) => {
                            ev.preventDefault()
                            setMenu({ x: ev.clientX, y: ev.clientY, entry: e })
                          }}
                          className={`cursor-pointer border-b border-border last:border-b-0 transition ${
                            isSelected
                              ? 'bg-accent-soft text-text-primary'
                              : 'hover:bg-surface-2'
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono text-text-primary">{e.name}</td>
                          <td className="px-4 py-2.5 text-text-secondary">{formatBytes(e.size)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              {!selected ? (
                <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-text-muted">
                  Select a file to preview its contents.
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[12.5px] text-text-primary">
                        {selected.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-text-muted">
                        {formatBytes(selected.size)} · {formatTime(selected.mtime)}
                      </div>
                    </div>
                    <button
                      onClick={() => window.api.files.reveal(selected.path)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-text-secondary transition hover:bg-surface-2 hover:text-text-primary"
                    >
                      <Icons.Reveal />
                      Reveal
                    </button>
                  </div>
                  {previewLoading ? (
                    <div className="flex min-h-0 flex-1 items-start p-4 font-mono text-[12.5px] leading-relaxed text-text-muted">
                      Loading…
                    </div>
                  ) : (
                    <textarea
                      readOnly
                      value={previewText}
                      spellCheck={false}
                      className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12.5px] leading-relaxed text-text-primary outline-none"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 z-10 bg-surface-2 text-[11px] uppercase tracking-wider text-text-secondary shadow-[inset_0_-1px_0_var(--tw-shadow-color)] shadow-border">
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
                    onContextMenu={(ev) => {
                      ev.preventDefault()
                      setMenu({ x: ev.clientX, y: ev.clientY, entry: e })
                    }}
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

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        detail={confirm?.detail}
        confirmLabel={confirm?.confirmLabel ?? 'Confirm'}
        cancelLabel="Cancel"
        danger
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const c = confirm
          setConfirm(null)
          if (c) await c.onConfirm()
        }}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            [
              {
                label: 'Reveal in Explorer',
                icon: <Icons.Reveal />,
                onClick: () => window.api.files.reveal(menu.entry.path),
                separatorAfter: true
              },
              {
                label: 'Delete',
                icon: <Icons.Trash />,
                danger: true,
                onClick: () => {
                  const target = menu.entry
                  setConfirm({
                    title: 'Delete file',
                    message: `Delete ${target.name}?`,
                    detail: 'This cannot be undone.',
                    confirmLabel: 'Delete',
                    onConfirm: async () => {
                      const result = await window.api.files.deleteOutput(target.path)
                      if (result.ok) {
                        if (selected?.path === target.path) setSelected(null)
                        await load()
                      }
                    }
                  })
                }
              }
            ] as ContextMenuItem[]
          }
        />
      )}
    </div>
  )
}
