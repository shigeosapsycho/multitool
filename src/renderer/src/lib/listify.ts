export type Mark = 'none' | 'star' | 'check' | 'cross'

export type Item = { id: number; text: string; mark: Mark }

// Parse editor text into list items: split on newlines, trim trailing
// whitespace, drop blank lines (same convention as reverseLines/shuffleLines).
// ids are assigned sequentially from `startId` so a reload never reuses an id.
export function parseToItems(text: string, startId: number): Item[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .map((line, i) => ({ id: startId + i, text: line, mark: 'none' as Mark }))
}

// Serialize items back to text in their current order. Marks are NOT included
// (visual triage only).
export function itemsToText(items: Item[]): string {
  return items.map((i) => i.text).join('\n')
}

export function setMark(items: Item[], ids: Set<number>, mark: Mark): Item[] {
  return items.map((it) => (ids.has(it.id) ? { ...it, mark } : it))
}

export function deleteItems(items: Item[], ids: Set<number>): Item[] {
  return items.filter((it) => !ids.has(it.id))
}

export function markCounts(items: Item[]): { star: number; check: number; cross: number } {
  let star = 0
  let check = 0
  let cross = 0
  for (const it of items) {
    if (it.mark === 'star') star++
    else if (it.mark === 'check') check++
    else if (it.mark === 'cross') cross++
  }
  return { star, check, cross }
}

// Move the selected items as a block in `dir`, preserving their relative order.
// Boundary moves (topmost selected already at index 0 for 'up', etc.) are
// no-ops. Selecting everything is a no-op.
export function moveItems(
  items: Item[],
  ids: Set<number>,
  dir: 'up' | 'down' | 'top' | 'bottom'
): Item[] {
  if (ids.size === 0 || ids.size >= items.length) return items
  const indices = items.reduce<number[]>((acc, it, i) => {
    if (ids.has(it.id)) acc.push(i)
    return acc
  }, [])
  if (indices.length === 0 || indices.length === items.length) return items

  if (dir === 'top') {
    const selected = indices.map((i) => items[i]!)
    const rest = items.filter((it) => !ids.has(it.id))
    return [...selected, ...rest]
  }
  if (dir === 'bottom') {
    const selected = indices.map((i) => items[i]!)
    const rest = items.filter((it) => !ids.has(it.id))
    return [...rest, ...selected]
  }

  const out = items.slice()
  if (dir === 'up') {
    if (indices[0] === 0) return items
    for (const i of indices) {
      const tmp = out[i - 1]!
      out[i - 1] = out[i]!
      out[i] = tmp
    }
    return out
  }
  // down
  if (indices[indices.length - 1] === items.length - 1) return items
  for (let k = indices.length - 1; k >= 0; k--) {
    const i = indices[k]!
    const tmp = out[i + 1]!
    out[i + 1] = out[i]!
    out[i] = tmp
  }
  return out
}

// Move the selected items as a block so they land at `targetIndex` (an index
// into the ORIGINAL array; items.length means "end"). Preserves the moved
// items' relative order. Used by drag-and-drop reordering.
export function moveItemsToIndex(items: Item[], ids: Set<number>, targetIndex: number): Item[] {
  if (ids.size === 0) return items
  const selected = items.filter((it) => ids.has(it.id))
  if (selected.length === 0 || selected.length === items.length) return items
  const rest = items.filter((it) => !ids.has(it.id))
  // Insertion point within `rest` = count of non-selected items before targetIndex.
  let insertAt = 0
  for (let i = 0; i < targetIndex && i < items.length; i++) {
    if (!ids.has(items[i]!.id)) insertAt++
  }
  return [...rest.slice(0, insertAt), ...selected, ...rest.slice(insertAt)]
}
