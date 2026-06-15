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

// Collapse runs of repeats: keep the first occurrence of each distinct item and
// drop the rest. Unlike findDuplicates/findNonDuplicates this returns the whole
// list with duplicates removed (one copy of every value), in first-seen order.
export function dedupeKeepFirst(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}
