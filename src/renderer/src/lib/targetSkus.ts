// Data layer for the Target SKUs tool. Parses the bundled (or remote) SKU
// catalog CSV, auto-categorizes each entry by trading card game, and builds the
// export strings consumed by bot configs.

import { parseCsvRow } from './transforms'
import bundledCsv from '../data/skus.txt?raw'

export type SkuCategory = 'Pokémon' | 'One Piece' | 'Magic: The Gathering' | 'Other'

/** Display order for the category groups in the UI. */
export const CATEGORY_ORDER: SkuCategory[] = [
  'Pokémon',
  'One Piece',
  'Magic: The Gathering',
  'Other'
]

export type SkuEntry = {
  sku: string
  item: string
  category: SkuCategory
}

export type ExportFormat = 'shikari' | 'refract' | 'stellar'

/** Which export formats are implemented. Refract/Stellar are stubbed for now. */
export const FORMAT_ENABLED: Record<ExportFormat, boolean> = {
  shikari: true,
  refract: false,
  stellar: false
}

// Pokémon set names that appear without the word "Pokémon" in the item title.
// Keeps ambiguous products (e.g. "Chaos Rising Booster Box") out of "Other".
const POKEMON_SET_KEYWORDS = [
  'mega evolution',
  'ascended heroes',
  'chaos rising',
  'perfect order',
  'prismatic evolutions',
  'paldean fates'
]

/** Best-effort trading-card-game classification from the item name. */
export function categorize(item: string): SkuCategory {
  const t = item.toLowerCase()
  if (t.includes('one piece')) return 'One Piece'
  if (t.includes('magic') || t.includes('mtg')) return 'Magic: The Gathering'
  if (t.includes('pokémon') || t.includes('pokemon')) return 'Pokémon'
  if (POKEMON_SET_KEYWORDS.some((k) => t.includes(k))) return 'Pokémon'
  return 'Other'
}

// Item titles repeat the game name (e.g. "Pokémon Trading Card Game: ..."),
// which is redundant once the entry sits under its category group. This strips
// the leading "<game> Trading Card Game:" / "Card Game:" / "TCG:" / Magic
// prefix. The raw `item` is kept for categorization and as the GitHub source.
const TCG_PREFIX = /^.*?(?:Trading Card Game|Card Game|TCG|The Gathering)\s*:\s*/i

/** Cleaned item title for display — see TCG_PREFIX. */
export function displayName(item: string): string {
  return item.replace(TCG_PREFIX, '').trim()
}

/**
 * Parse a SKU catalog CSV (`SKU,ITEM` header) into entries. The header row is
 * skipped, blank rows ignored, and duplicate SKUs dropped (first wins).
 */
export function parseSkuCsv(text: string): SkuEntry[] {
  const rows = text.split(/\r?\n/)
  const out: SkuEntry[] = []
  const seen = new Set<string>()
  let headerSkipped = false
  for (const row of rows) {
    if (!row.trim()) continue
    if (!headerSkipped) {
      headerSkipped = true
      continue
    }
    const cells = parseCsvRow(row)
    const sku = (cells[0] ?? '').trim()
    if (!sku || seen.has(sku)) continue
    seen.add(sku)
    const item = (cells[1] ?? '').trim()
    out.push({ sku, item, category: categorize(item) })
  }
  return out
}

/** Build the export string for a list of SKUs in the requested format. */
export function formatSkus(skus: string[], format: ExportFormat): string {
  switch (format) {
    case 'shikari':
      // Shikari expects a comma+space separated SKU list.
      return skus.join(', ')
    case 'refract':
    case 'stellar':
      // Not implemented yet — the UI disables these selectors.
      return ''
  }
}

/**
 * Extract the SKU tokens from an export string. Splits on commas and any
 * whitespace so both the Shikari format and loosely pasted lists round-trip.
 * Format-specific parsing arrives when Refract/Stellar are imported.
 */
export function parseSkuList(text: string, _format: ExportFormat): string[] {
  return text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Guess the export format from a typed/pasted string. Only Shikari is
 * implemented, so this always returns 'shikari' until Refract and Stellar
 * are imported and given their own detection rules.
 */
export function detectFormat(_text: string): ExportFormat {
  return 'shikari'
}

/** SKUs parsed from the copy bundled into the app. Always available offline. */
export const BUNDLED_SKUS: SkuEntry[] = parseSkuCsv(bundledCsv)

// Raw GitHub URL for the live-updatable SKU catalog. Leave empty until the
// GitHub file exists, then paste its raw.githubusercontent.com URL here — the
// CSP allows the webview to fetch it directly, no rebuild of logic needed.
// e.g. 'https://raw.githubusercontent.com/<user>/<repo>/main/SKUs.txt'
export const SKUS_REMOTE_URL = ''

/**
 * Fetch and parse the remote SKU catalog. Rejects when no URL is configured,
 * the request fails, or the file yields no entries — callers fall back to
 * BUNDLED_SKUS on rejection.
 */
export async function fetchRemoteSkus(): Promise<SkuEntry[]> {
  if (!SKUS_REMOTE_URL) throw new Error('No remote SKU URL configured')
  const res = await fetch(SKUS_REMOTE_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const parsed = parseSkuCsv(await res.text())
  if (parsed.length === 0) throw new Error('Remote SKU file is empty')
  return parsed
}
