import { parseCsvRow } from './transforms'
import {
  csvField,
  detectProfileFormat,
  extractArray,
  findEmailColumn,
  parseEmailList,
  stripBom,
  UNKNOWN_FORMAT_ERROR,
  type ProfileFormat
} from './profileFilter'

// Swaps named emails in a profile export (Refract JSON, Stellar AIO JSON, or
// Shikari CSV) for new ones. The user supplies two lists: the emails to find
// and the emails to put in their place, paired 1:1 by position. Nothing else in
// the file changes, and the output keeps the source format so it re-imports
// cleanly.

export type ReplaceResult = {
  format: ProfileFormat
  /** Rewritten file in the original format (JSON text | CSV text); '' on error. */
  fullOutput: string
  /** Profiles whose email was swapped. */
  replacedCount: number
  /** Profiles in the output, which `dropUnmatched` narrows to `replacedCount`. */
  outputCount: number
  /** Profiles in the source file. */
  totalCount: number
  /** Parse/format problem, else null. */
  error: string | null
}

const NO_FIND_ERROR = 'Paste the emails you want to replace.'
const NO_REPLACE_ERROR = 'Paste the emails to replace them with.'

export type ReplaceOptions = {
  /** Keep only the profiles that took a new email. Off by default. */
  dropUnmatched?: boolean
}

function emptyResult(format: ProfileFormat, error: string): ReplaceResult {
  return { format, fullOutput: '', replacedCount: 0, outputCount: 0, totalCount: 0, error }
}

/**
 * Pair `findText[i]` with `replaceText[i]` and apply that mapping to every
 * profile in the file, matching on email case-insensitively.
 *
 * The two lists rarely line up, and neither overhang is an error: a find email
 * past the end of the replacement list has nothing to become, so its profile is
 * left alone, and a replacement past the end of the find list is simply never
 * used. Both lists are deduped first, so one replacement can never be handed to
 * two different find emails.
 *
 * By default every profile survives, swapped or not, keeping the export whole.
 * With `dropUnmatched`, the output narrows to the profiles that took a new
 * email.
 */
export function replaceProfileEmails(
  findText: string,
  replaceText: string,
  profileText: string,
  opts: ReplaceOptions = {}
): ReplaceResult {
  const { ordered: find } = parseEmailList(findText)
  const { ordered: replacements } = parseEmailList(replaceText)
  const format = detectProfileFormat(profileText)
  if (format === 'unknown') return emptyResult('unknown', UNKNOWN_FORMAT_ERROR)
  if (find.length === 0) return emptyResult(format, NO_FIND_ERROR)
  if (replacements.length === 0) return emptyResult(format, NO_REPLACE_ERROR)

  // Lowercased old email -> new email, as typed. Pairs stop at the shorter
  // list; anything past that end is the overhang the caller was told to expect.
  const swaps = new Map<string, string>()
  for (let i = 0; i < Math.min(find.length, replacements.length); i++) {
    swaps.set(find[i]!.toLowerCase(), replacements[i]!)
  }

  const drop = opts.dropUnmatched === true
  return format === 'shikari'
    ? replaceShikari(profileText, swaps, drop)
    : replaceJson(profileText, format, swaps, drop)
}

function replaceJson(
  text: string,
  format: 'refract' | 'stellar',
  swaps: Map<string, string>,
  drop: boolean
): ReplaceResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch (e) {
    return emptyResult(format, `Invalid JSON: ${(e as Error).message}`)
  }
  const list = extractArray(parsed)
  if (!list) return emptyResult(format, 'Expected a JSON array of profiles.')

  const kept: unknown[] = []
  let replaced = 0
  for (const el of list) {
    const o = el && typeof el === 'object' && !Array.isArray(el) ? (el as Record<string, unknown>) : null
    const email = typeof o?.email === 'string' ? o.email.trim().toLowerCase() : null
    const swap = email === null ? undefined : swaps.get(email)
    if (swap === undefined) {
      // Not named in the find list. Verbatim, or gone when the caller only
      // wants the profiles that changed.
      if (!drop) kept.push(el)
      continue
    }
    // Spread-then-overwrite keeps every sibling key, including ids and
    // timestamps the app never models, and leaves `email` in its key position.
    kept.push({ ...o, email: swap })
    replaced++
  }

  return {
    format,
    fullOutput: JSON.stringify(kept),
    replacedCount: replaced,
    outputCount: kept.length,
    totalCount: list.length,
    error: null
  }
}

function replaceShikari(text: string, swaps: Map<string, string>, drop: boolean): ReplaceResult {
  const rows = stripBom(text).split(/\r?\n/)
  const headerIdx = rows.findIndex((r) => r.trim().length > 0)
  if (headerIdx === -1) return emptyResult('shikari', 'The CSV is empty.')

  const headerCells = parseCsvRow(rows[headerIdx]!)
  const emailIdx = findEmailColumn(headerCells)
  if (emailIdx === -1) {
    return emptyResult('shikari', 'No email column found in the CSV header.')
  }

  const keptRows: string[] = []
  let total = 0
  let replaced = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const raw = rows[i]!
    if (!raw.trim()) continue
    total++
    const cells = parseCsvRow(raw)
    const swap = swaps.get((cells[emailIdx] ?? '').trim().toLowerCase())
    if (swap === undefined) {
      // Replayed raw rather than re-serialized, so an untouched row keeps
      // whatever quoting the source chose for it.
      if (!drop) keptRows.push(raw)
      continue
    }
    cells[emailIdx] = swap
    keptRows.push(cells.map(csvField).join(','))
    replaced++
  }

  return {
    format: 'shikari',
    // The header is replayed verbatim for the same reason: nothing in it changed.
    fullOutput: [rows[headerIdx]!, ...keptRows].join('\n'),
    replacedCount: replaced,
    outputCount: keptRows.length,
    totalCount: total,
    error: null
  }
}
