import {
  detectProfileFormat,
  extractArray,
  findEmailColumn,
  stripBom,
  UNKNOWN_FORMAT_ERROR,
  type ProfileFormat
} from './profileFilter'
import { parseCsvRow } from './transforms'

// Shuffles the profiles in an export (Refract JSON, Stellar AIO JSON, or
// Shikari CSV) into a random order. Every entry is kept verbatim and the output
// stays in the source format, so it re-imports exactly as the original did,
// only in a different order.

export type ShuffleResult = {
  format: ProfileFormat
  /** Shuffled file in the original format (JSON text | CSV text); '' on error. */
  fullOutput: string
  /** Profiles in the output. */
  count: number
  /** Parse/format problem, else null. */
  error: string | null
}

function emptyResult(format: ProfileFormat, error: string): ShuffleResult {
  return { format, fullOutput: '', count: 0, error }
}

/**
 * In-place Fisher-Yates. `rng` returns a uniform in [0, 1); it is injectable so
 * tests can pin an exact ordering. One draw per step, from the last index down.
 */
function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

/**
 * Shuffle every profile in the export into a random order.
 *
 * JSON elements are replayed untouched (ids, timestamps, and every other key
 * the app never models survive), and a `{profiles: [...]}` wrapper unwraps to a
 * bare array like the other same-format tools. Shikari keeps its header row
 * first and replays each data row raw, so the source's own quoting survives;
 * blank lines are dropped.
 */
export function shuffleProfiles(text: string, rng: () => number = Math.random): ShuffleResult {
  // Blank input reports the "which format?" hint rather than guessing a format.
  if (!stripBom(text).trim()) return emptyResult('unknown', UNKNOWN_FORMAT_ERROR)
  const format = detectProfileFormat(text)
  if (format === 'unknown') return emptyResult('unknown', UNKNOWN_FORMAT_ERROR)
  return format === 'shikari' ? shuffleShikari(text, rng) : shuffleJson(text, format, rng)
}

function shuffleJson(text: string, format: 'refract' | 'stellar', rng: () => number): ShuffleResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch (e) {
    return emptyResult(format, `Invalid JSON: ${(e as Error).message}`)
  }
  const list = extractArray(parsed)
  if (!list) return emptyResult(format, 'Expected a JSON array of profiles.')

  const shuffled = shuffleInPlace([...list], rng)
  return { format, fullOutput: JSON.stringify(shuffled), count: shuffled.length, error: null }
}

function shuffleShikari(text: string, rng: () => number): ShuffleResult {
  const rows = stripBom(text).split(/\r?\n/)
  const headerIdx = rows.findIndex((r) => r.trim().length > 0)
  if (headerIdx === -1) return emptyResult('shikari', 'The CSV is empty.')

  const headerCells = parseCsvRow(rows[headerIdx]!)
  if (findEmailColumn(headerCells) === -1) {
    return emptyResult('shikari', 'No email column found in the CSV header.')
  }

  const dataRows = rows.slice(headerIdx + 1).filter((r) => r.trim().length > 0)
  const shuffled = shuffleInPlace(dataRows, rng)
  return {
    format: 'shikari',
    // The header is replayed verbatim: nothing in it changed.
    fullOutput: [rows[headerIdx]!, ...shuffled].join('\n'),
    count: shuffled.length,
    error: null
  }
}
