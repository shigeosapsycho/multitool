// A line is a valid email when (trimmed) it is local@domain.tld with one '@',
// non-empty local part, and a dotted domain, no whitespace anywhere.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Lowercased domain of a valid email line, or null if the line isn't a valid email. */
export function domainOf(line: string): string | null {
  const t = line.trim()
  if (!EMAIL_RE.test(t)) return null
  return t.slice(t.lastIndexOf('@') + 1).toLowerCase()
}

export type ProviderCount = { domain: string; count: number }

/** Unique domains present in the text, with counts, sorted by count desc then domain A→Z. */
export function detectProviders(text: string): ProviderCount[] {
  const counts = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const d = domainOf(line)
    if (!d) continue
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain))
}

export type OrderResult = { lines: string[]; invalid: string[] }

/**
 * Sort emails into ranked provider groups (the `order` array, compared lowercased),
 * each preserving input order, followed by a single "Other" block (valid emails whose
 * domain is not in `order`, input order). `invalid` collects the trimmed non-email lines.
 * Blank lines are ignored entirely (neither output nor counted invalid).
 */
export function orderEmailsByProviders(text: string, order: string[]): OrderResult {
  const rank = new Map<string, number>()
  order.forEach((d, i) => rank.set(d.toLowerCase(), i))
  const buckets: string[][] = order.map(() => [])
  const other: string[] = []
  const invalid: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (!t) continue
    const d = domainOf(t)
    if (!d) {
      invalid.push(t)
      continue
    }
    const idx = rank.get(d)
    if (idx === undefined) other.push(t)
    else buckets[idx]!.push(t)
  }
  return { lines: ([] as string[]).concat(...buckets, other), invalid }
}
