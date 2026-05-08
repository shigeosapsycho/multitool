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
