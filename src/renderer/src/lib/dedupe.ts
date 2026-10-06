import { FIELD_SEPARATORS } from './parse'

export function findDuplicates(items: string[]): string[] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  const out: string[] = []
  for (const [item, count] of counts) {
    if (count > 1) out.push(item)
  }
  return out
}

export function findNonDuplicates(items: string[]): string[] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  const out: string[] = []
  for (const [item, count] of counts) {
    if (count === 1) out.push(item)
  }
  return out
}

/**
 * What makes two lines duplicates.
 *  - line: the whole line repeats.
 *  - first-field: the text before the first separator repeats, so
 *    "john:pw1" and "john:pw2" are one entry.
 */
export type DedupeMatch = 'line' | 'first-field'

// The text before the first field separator, trimmed. Keying on the first
// field only, not any field, keeps "alice:hunter2" and "bob:hunter2" apart: a
// shared password is not a shared account. A line whose first field is empty
// (":pw") falls back to the whole line, or every such row would collapse into
// one.
export function firstField(item: string): string {
  const field = item.split(FIELD_SEPARATORS, 1)[0]!.trim()
  return field.length > 0 ? field : item
}

// Collapse runs of repeats: keep the first occurrence of each distinct item and
// drop the rest. Unlike findDuplicates/findNonDuplicates this returns the whole
// list with duplicates removed (one copy of every value), in first-seen order.
// Kept items come back whole whatever `match` compared on.
export function dedupeKeepFirst(items: string[], match: DedupeMatch = 'line'): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const key = match === 'first-field' ? firstField(item) : item
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
