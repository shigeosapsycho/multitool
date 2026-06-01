import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  ToolLayout,
  FilePanel,
  Button,
  Icons,
  Stat,
  type FilePanelHandle
} from '../components/ToolShell'
import { Card } from '../components/Card'
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu'
import { consumePendingFile } from '../lib/pending'
import { shortOutputPath } from '../lib/paths'
import {
  parseToItems,
  itemsToText,
  setMark,
  deleteItems,
  moveItems,
  markCounts,
  type Item,
  type Mark
} from '../lib/listify'

type Props = { onBack: () => void; onSetStatus: (msg: string) => void; active?: boolean }

function markGlyph(mark: Mark) {
  switch (mark) {
    case 'star':
      return <span style={{ color: '#fbbf24' }}>★</span>
    case 'check':
      return <span style={{ color: '#34d399' }}>✓</span>
    case 'cross':
      return <span style={{ color: '#f87171' }}>✗</span>
    default:
      return null
  }
}

export function ListifyPage({ onBack, onSetStatus, active = true }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [filePath, setFilePath] = useState<string | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const [copied, setCopied] = useState(false)
  const panelRef = useRef<FilePanelHandle>(null)
  const idRef = useRef(0)
  const anchorRef = useRef<number | null>(null)

  function loadListFromText(text: string) {
    const parsed = parseToItems(text, idRef.current)
    if (parsed.length === 0) {
      onSetStatus('Nothing to load.')
      return
    }
    idRef.current += parsed.length
    setItems(parsed)
    setSelected(new Set())
    setSavedTo(null)
    anchorRef.current = null
    onSetStatus(`${parsed.length.toLocaleString()} items`)
  }

  async function loadFromPath(path: string) {
    const text = await window.api.files.read(path)
    setFilePath(path)
    panelRef.current?.setValue(text)
    loadListFromText(text)
  }

  // Pick up a file dropped on the Tools landing card.
  useEffect(() => {
    if (!active) return
    const pending = consumePendingFile()
    if (pending) void loadFromPath(pending)
  }, [active])

  // Keyboard: Delete removes selection, Esc clears it, Ctrl/Cmd+A selects all.
  // Ignored while typing in the input editor (textarea/input targets).
  useEffect(() => {
    if (!active) return
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected.size > 0) {
          e.preventDefault()
          handleDelete()
        }
      } else if (e.key === 'Escape') {
        setSelected(new Set())
        setMenu(null)
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (items.length > 0) {
          e.preventDefault()
          setSelected(new Set(items.map((it) => it.id)))
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active, items, selected])

  function handleLoad() {
    loadListFromText(panelRef.current?.getValue() ?? '')
  }

  function handleClear() {
    setFilePath(null)
    panelRef.current?.setValue('')
    setItems([])
    setSelected(new Set())
    setSavedTo(null)
    setMenu(null)
    anchorRef.current = null
    onSetStatus('Ready')
  }

  async function handlePick() {
    const paths = await window.api.files.open({ title: 'Select a text file' })
    if (paths.length === 0) return
    await loadFromPath(paths[0]!)
  }

  function handleRowClick(e: MouseEvent, id: number, index: number) {
    if (e.shiftKey && anchorRef.current !== null) {
      const a = Math.min(anchorRef.current, index)
      const b = Math.max(anchorRef.current, index)
      const next = new Set<number>()
      for (let i = a; i <= b; i++) next.add(items[i]!.id)
      setSelected(next)
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelected(next)
      anchorRef.current = index
    } else {
      setSelected(new Set([id]))
      anchorRef.current = index
    }
  }

  function handleRowContextMenu(e: MouseEvent, id: number, index: number) {
    e.preventDefault()
    if (!selected.has(id)) {
      setSelected(new Set([id]))
      anchorRef.current = index
    }
    setMenu({ x: e.clientX, y: e.clientY })
  }

  function applyMark(mark: Mark) {
    setItems((prev) => setMark(prev, selected, mark))
    setSavedTo(null)
  }

  function move(dir: 'up' | 'down' | 'top' | 'bottom') {
    setItems((prev) => moveItems(prev, selected, dir))
    setSavedTo(null)
  }

  function handleDelete() {
    setItems((prev) => deleteItems(prev, selected))
    setSelected(new Set())
    setSavedTo(null)
  }

  async function handleCopy() {
    if (items.length === 0) return
    try {
      await navigator.clipboard.writeText(itemsToText(items))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can reject if the window isn't focused; the user can retry.
    }
  }

  async function handleSave() {
    if (items.length === 0) return
    const path = await window.api.files.writeOutput('listify', itemsToText(items) + '\n')
    setSavedTo(path)
    onSetStatus(`Saved to ${shortOutputPath(path)}`)
  }

  const counts = markCounts(items)
  const hasItems = items.length > 0

  const menuItems: ContextMenuItem[] = [
    { label: 'Mark ★', icon: <span style={{ color: '#fbbf24' }}>★</span>, onClick: () => applyMark('star') },
    { label: 'Mark ✓', icon: <span style={{ color: '#34d399' }}>✓</span>, onClick: () => applyMark('check') },
    { label: 'Mark ✗', icon: <span style={{ color: '#f87171' }}>✗</span>, onClick: () => applyMark('cross') },
    { label: 'Clear mark', onClick: () => applyMark('none'), separatorAfter: true },
    { label: 'Move up', onClick: () => move('up') },
    { label: 'Move down', onClick: () => move('down') },
    { label: 'Move to top', onClick: () => move('top') },
    { label: 'Move to bottom', onClick: () => move('bottom'), separatorAfter: true },
    {
      label: selected.size > 1 ? `Delete ${selected.size} items` : 'Delete',
      onClick: handleDelete,
      danger: true
    }
  ]

  return (
    <ToolLayout
      title="Listify"
      onBack={onBack}
      banner={
        hasItems ? (
          <>
            <Stat value={items.length.toLocaleString()} label="items" />
            <Stat
              value={`★${counts.star} ✓${counts.check} ✗${counts.cross}`}
              label="marks"
              separator={false}
            />
          </>
        ) : (
          <span>Paste or load a list, then right-click rows to mark, reorder, or delete.</span>
        )
      }
      actions={
        <>
          <Button onClick={handleClear} variant="ghost">
            <Icons.Trash />
            Clear
          </Button>
          <Button onClick={handleLoad} variant="primary" disabled={lineCount === 0}>
            <Icons.Play />
            Load to list
          </Button>
        </>
      }
    >
      <FilePanel
        ref={panelRef}
        label="Input List"
        filePath={filePath}
        onPick={handlePick}
        onDropPath={loadFromPath}
        onLineCountChange={setLineCount}
        placeholder={'Paste your list here (one item per line),\nor drop / choose a text file.'}
      />

      <Card label="List" badge={hasItems ? items.length.toLocaleString() : '—'}>
        {!hasItems ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
            Load a list to start. Right-click rows to mark, reorder, or delete.
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div tabIndex={0} className="min-h-0 flex-1 overflow-auto py-1 outline-none">
              {items.map((it, i) => {
                const isSel = selected.has(it.id)
                return (
                  <div
                    key={it.id}
                    onClick={(e) => handleRowClick(e, it.id, i)}
                    onContextMenu={(e) => handleRowContextMenu(e, it.id, i)}
                    className={`flex cursor-default select-none items-center gap-3 px-4 py-1 font-mono text-[12.5px] ${
                      isSel ? 'bg-accent-soft text-accent' : 'text-text-primary hover:bg-surface-2'
                    }`}
                  >
                    <span className="w-10 shrink-0 text-right tabular-nums text-text-muted">{i + 1}</span>
                    <span className="flex w-4 shrink-0 justify-center">{markGlyph(it.mark)}</span>
                    <span className="flex-1 truncate">{it.text}</span>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-2 border-t border-border p-3">
              {savedTo ? (
                <span className="flex-1 truncate text-[12px] text-text-secondary">
                  Saved to <span className="text-text-primary">{shortOutputPath(savedTo)}</span>
                </span>
              ) : (
                <span className="flex-1 truncate text-[12px] text-text-muted">
                  {selected.size > 0 ? `${selected.size} selected` : ''}
                </span>
              )}
              <Button onClick={handleCopy} variant="ghost">
                <Icons.Copy />
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              {savedTo ? (
                <Button onClick={() => window.api.files.reveal(savedTo)} variant="ghost">
                  <Icons.Reveal />
                  Reveal
                </Button>
              ) : (
                <Button onClick={handleSave} variant="secondary">
                  <Icons.Save />
                  Save to Output
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </ToolLayout>
  )
}
