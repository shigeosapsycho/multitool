import { useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
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
import { loadListifyCache, saveListifyCache } from '../lib/listifyCache'

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

/** Six-dot grip handle shown on draggable rows (matches the Target SKUs grip). */
const GripIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <circle cx="9" cy="6" r="1.4" />
    <circle cx="9" cy="12" r="1.4" />
    <circle cx="9" cy="18" r="1.4" />
    <circle cx="15" cy="6" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="15" cy="18" r="1.4" />
  </svg>
)

export function ListifyPage({ onBack, onSetStatus, active = true }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [filePath, setFilePath] = useState<string | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const [copied, setCopied] = useState<'all' | 'selected' | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const panelRef = useRef<FilePanelHandle>(null)
  const idRef = useRef(0)
  const anchorRef = useRef<number | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const saveTimer = useRef<number | null>(null)
  const firstItemsRun = useRef(true)
  const dragIdRef = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Persist input + list to webview localStorage (survives relaunch), the same
  // approach Target SKUs / Proxy Tester use. Selection is transient, not cached.
  function persist() {
    saveListifyCache({
      editorText: panelRef.current?.getValue() ?? '',
      items: itemsRef.current,
      idCounter: idRef.current
    })
  }

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

  // Restore the previous session's input + list once on mount.
  useEffect(() => {
    const cached = loadListifyCache()
    if (!cached) return
    if (cached.items.length > 0) {
      setItems(cached.items)
      idRef.current = Math.max(
        cached.idCounter,
        cached.items.reduce((m, it) => Math.max(m, it.id + 1), 0)
      )
    }
    if (cached.editorText) panelRef.current?.setValue(cached.editorText)
  }, [])

  // Persist whenever the list changes (load, mark, reorder, delete). Skips the
  // initial empty render so it never clobbers a freshly restored cache.
  useEffect(() => {
    if (firstItemsRun.current) {
      firstItemsRun.current = false
      return
    }
    persist()
  }, [items])

  // Flush any pending debounced editor save on unmount.
  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    },
    []
  )

  // Pick up a file dropped on the Tools landing card (overrides restored cache).
  useEffect(() => {
    if (!active) return
    const pending = consumePendingFile()
    if (pending) void loadFromPath(pending)
  }, [active])

  // Pointer-based drag reorder. HTML5 drag events don't fire under Tauri's
  // OS-level drag-drop, so we hold the dragged row and reorder live by pointer
  // position (same approach as the Target SKUs Order tab). Refs let the window
  // listeners read the latest list without re-subscribing on every move.
  useEffect(() => {
    if (dragId === null) return
    const onMove = (e: PointerEvent) => {
      const id = dragIdRef.current
      const container = listRef.current
      if (id === null || !container) return
      const rows = Array.from(container.children) as HTMLElement[]
      if (rows.length === 0) return
      // Insertion slot: first row whose midpoint sits below the pointer, else
      // rows.length (drop at the very end).
      let target = rows.length
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!.getBoundingClientRect()
        if (e.clientY < r.top + r.height / 2) {
          target = i
          break
        }
      }
      const cur = itemsRef.current
      const from = cur.findIndex((it) => it.id === id)
      if (from === -1) return
      const insertAt = from < target ? target - 1 : target
      if (insertAt === from) return
      const next = [...cur]
      const [moved] = next.splice(from, 1)
      next.splice(insertAt, 0, moved!)
      itemsRef.current = next
      setItems(next)
      setSavedTo(null)
    }
    const onUp = () => {
      dragIdRef.current = null
      setDragId(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragId])

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

  // Debounced save while typing/pasting into the editor (before "Load to list").
  function handleEditorEdit() {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => persist(), 400)
  }

  function handleLoad() {
    loadListFromText(panelRef.current?.getValue() ?? '')
  }

  function handleClear() {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
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

  function handleGripPointerDown(e: ReactPointerEvent, id: number) {
    e.preventDefault()
    dragIdRef.current = id
    setDragId(id)
  }

  // Toggle: if every selected row already has this mark, clear it; else set it.
  function toggleMark(mark: Mark) {
    if (selected.size === 0) return
    const allHave = items.every((it) => !selected.has(it.id) || it.mark === mark)
    setItems((prev) => setMark(prev, selected, allHave ? 'none' : mark))
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

  async function copyText(text: string, which: 'all' | 'selected') {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard can reject if the window isn't focused; the user can retry.
    }
  }

  function handleCopyAll() {
    void copyText(itemsToText(items), 'all')
  }

  function handleCopySelected() {
    void copyText(itemsToText(items.filter((it) => selected.has(it.id))), 'selected')
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
    {
      label: selected.size > 1 ? `Copy ${selected.size} items` : 'Copy',
      icon: <Icons.Copy />,
      onClick: handleCopySelected,
      separatorAfter: true
    },
    { label: 'Mark ★', icon: <span style={{ color: '#fbbf24' }}>★</span>, onClick: () => toggleMark('star') },
    { label: 'Mark ✓', icon: <span style={{ color: '#34d399' }}>✓</span>, onClick: () => toggleMark('check') },
    {
      label: 'Mark ✗',
      icon: <span style={{ color: '#f87171' }}>✗</span>,
      onClick: () => toggleMark('cross'),
      separatorAfter: true
    },
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
          <span>Paste or load a list, then drag the grip or right-click rows to reorder, mark, or delete.</span>
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
        onUserEdit={handleEditorEdit}
        onLineCountChange={setLineCount}
        placeholder={'Paste your list here (one item per line),\nor drop / choose a text file.'}
      />

      <Card label="List" badge={hasItems ? items.length.toLocaleString() : '—'}>
        {!hasItems ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
            Load a list to start. Drag the grip or right-click rows to reorder, mark, or delete.
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div ref={listRef} className="min-h-0 flex-1 overflow-auto py-1 outline-none">
              {items.map((it, i) => {
                const isSel = selected.has(it.id)
                const isDrag = dragId === it.id
                return (
                  <div
                    key={it.id}
                    onClick={(e) => handleRowClick(e, it.id, i)}
                    onContextMenu={(e) => handleRowContextMenu(e, it.id, i)}
                    className={`flex select-none items-center gap-2.5 px-4 py-1 font-mono text-[12.5px] transition-[transform,box-shadow,background-color] duration-150 ${
                      isDrag
                        ? 'relative z-10 scale-[1.01] bg-accent-soft text-accent shadow-lg'
                        : isSel
                          ? 'bg-accent-soft text-accent'
                          : 'text-text-primary hover:bg-surface-2'
                    }`}
                  >
                    <span
                      onPointerDown={(e) => handleGripPointerDown(e, it.id)}
                      className="shrink-0 cursor-grab touch-none text-text-muted active:cursor-grabbing"
                      title="Drag to reorder"
                    >
                      <GripIcon />
                    </span>
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
              {selected.size > 0 && (
                <Button onClick={handleCopySelected} variant="ghost">
                  <Icons.Copy />
                  {copied === 'selected' ? 'Copied!' : 'Copy selected'}
                </Button>
              )}
              <Button onClick={handleCopyAll} variant="ghost">
                <Icons.Copy />
                {copied === 'all' ? 'Copied!' : 'Copy'}
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
