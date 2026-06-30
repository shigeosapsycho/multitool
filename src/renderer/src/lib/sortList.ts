// Logic for the Sort List tool: alphabetize a list of lines.

export type SortDirection = 'asc' | 'desc'

/**
 * Sort the lines of `text` alphabetically. Lines are trimmed and blank lines
 * dropped first. Comparison is case-insensitive and numeric-aware (natural
 * order), so "item2" sorts before "item10" and "Apple" sits next to "apple".
 */
export function sortList(text: string, direction: SortDirection = 'asc'): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const sign = direction === 'desc' ? -1 : 1
  return lines.sort(
    (a, b) => sign * a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  )
}
