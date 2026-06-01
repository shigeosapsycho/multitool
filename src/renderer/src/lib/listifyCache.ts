import type { Item, Mark } from './listify'

/** localStorage key for the persisted Listify input + list (survives relaunch). */
const KEY = 'listify:state'

export type ListifyCache = { editorText: string; items: Item[]; idCounter: number }

const MARKS: Mark[] = ['none', 'star', 'check', 'cross']

function isItem(v: unknown): v is Item {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'number' &&
    typeof o.text === 'string' &&
    typeof o.mark === 'string' &&
    (MARKS as string[]).includes(o.mark)
  )
}

/** Read the cached state; null when missing or unreadable. Best-effort. */
export function loadListifyCache(): ListifyCache | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const o = parsed as Record<string, unknown>
    const editorText = typeof o.editorText === 'string' ? o.editorText : ''
    const items = Array.isArray(o.items) ? o.items.filter(isItem) : []
    const idCounter = typeof o.idCounter === 'number' ? o.idCounter : 0
    return { editorText, items, idCounter }
  } catch {
    return null
  }
}

/** Persist the current state. Swallows quota / unavailable-storage errors. */
export function saveListifyCache(cache: ListifyCache): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    // Best-effort: a full or unavailable localStorage just means no caching.
  }
}
