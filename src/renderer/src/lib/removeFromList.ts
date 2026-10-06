/**
 * How a remove-list entry has to line up with a master line to remove it.
 *  - line: the whole line equals the entry.
 *  - field: the whole line, or one field of it, equals the entry. Fields split
 *    on `:` `;` `,` `|` and tab, so "alice" removes "alice:hunter2" but never
 *    "alicia:hunter2".
 *  - contains: the entry appears anywhere in the line, so "john" removes
 *    "johnny:pw" too.
 */
export type MatchMode = 'line' | 'field' | 'contains'

export type RemoveFromListOptions = {
  /** When false, "Bob@X.com" and "bob@x.com" are the same entry. */
  caseSensitive: boolean
  /**
   * When true, every whitespace character is dropped before comparing, so
   * "john doe", " johndoe " and "john\tdoe" all match. When false, text is
   * compared exactly as typed, leading and trailing spaces included.
   */
  ignoreSpacing: boolean
  match: MatchMode
}

export type RemoveFromListResult = {
  /** Master lines that matched no entry, verbatim and in master order. */
  kept: string[]
  /**
   * Remove-list entries that matched no master line, one per distinct entry,
   * in the spelling of its first appearance. Never part of `kept`.
   */
  unused: string[]
}

const FIELD_SEPARATORS = /[:;,|\t]/

// Lines of `text` that carry content. The line ending and a leading BOM are
// stripped, blank and whitespace-only lines are dropped, and every other line
// is returned untouched so the caller decides what spacing means.
function contentLines(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  return body.split(/\r?\n/).filter((line) => line.trim().length > 0)
}

function matchKey(text: string, opts: RemoveFromListOptions): string {
  const spaced = opts.ignoreSpacing ? text.replace(/\s+/g, '') : text
  return opts.caseSensitive ? spaced : spaced.toLowerCase()
}

// The keys a master line can be matched on: the whole line, plus each of its
// fields in field mode. Field keys are built from the raw field, so the
// spacing rule applies per field ("alice " only equals "alice" when spacing is
// ignored).
function lineKeys(line: string, opts: RemoveFromListOptions): string[] {
  const keys = [matchKey(line, opts)]
  if (opts.match === 'field') {
    for (const field of line.split(FIELD_SEPARATORS)) keys.push(matchKey(field, opts))
  }
  return keys
}

// Master lines that match no remove-list entry, plus the entries nothing
// matched. Repeated master lines are judged one by one, so this never dedupes
// what it keeps.
export function removeFromList(
  masterText: string,
  removeText: string,
  opts: RemoveFromListOptions
): RemoveFromListResult {
  // One slot per distinct entry key, holding the first spelling seen. Map
  // iteration order keeps `unused` in remove-list order.
  const entries = new Map<string, { spelling: string; used: boolean }>()
  for (const line of contentLines(removeText)) {
    const key = matchKey(line, opts)
    if (!entries.has(key)) entries.set(key, { spelling: line, used: false })
  }

  const kept: string[] = []
  if (opts.match === 'contains') {
    // Substring search can't use the map lookup, so every entry is tried
    // against every line. Once a line is already removed, entries that are
    // already marked used are skipped: they can't change the outcome.
    const list = [...entries]
    for (const line of contentLines(masterText)) {
      const key = matchKey(line, opts)
      let removed = false
      for (const [entryKey, entry] of list) {
        if (removed && entry.used) continue
        if (key.includes(entryKey)) {
          entry.used = true
          removed = true
        }
      }
      if (!removed) kept.push(line)
    }
  } else {
    for (const line of contentLines(masterText)) {
      let removed = false
      for (const key of lineKeys(line, opts)) {
        const entry = entries.get(key)
        if (entry) {
          entry.used = true
          removed = true
        }
      }
      if (!removed) kept.push(line)
    }
  }

  const unused: string[] = []
  for (const entry of entries.values()) if (!entry.used) unused.push(entry.spelling)
  return { kept, unused }
}
