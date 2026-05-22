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
  /** Pokémon set name, when recognized. Null for non-Pokémon / unknown. */
  set: string | null
  /** Pokémon era, when recognized. */
  era: PokemonEra | null
}

export type ExportFormat = 'shikari' | 'refract' | 'stellar'

/** Which export formats are implemented. */
export const FORMAT_ENABLED: Record<ExportFormat, boolean> = {
  shikari: true,
  refract: true,
  stellar: true
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

// ---------- Pokémon sets & eras ----------

/** The three Pokémon TCG eras, in release order. */
export const POKEMON_ERAS = [
  'Sword & Shield Era',
  'Scarlet & Violet Era',
  'Mega Evolution Era'
] as const
export type PokemonEra = (typeof POKEMON_ERAS)[number]

const SS: PokemonEra = 'Sword & Shield Era'
const SV: PokemonEra = 'Scarlet & Violet Era'
const ME: PokemonEra = 'Mega Evolution Era'

type PokemonSet = {
  name: string
  era: PokemonEra
  /** Lowercase substrings that identify the set in an item title. */
  keywords: string[]
  /** Era base set — matched only after the era's specific sets. */
  base?: boolean
  /**
   * Set that ships as two named variants (e.g. Black Bolt / White Flare). The
   * row label keeps the matched variant as a "[Variant]" tag instead of
   * stripping it, so the otherwise-identical rows stay distinguishable.
   */
  splitTag?: boolean
}

// Sets per era, in release order — drives both display order and matching.
const POKEMON_SETS: PokemonSet[] = [
  { name: 'Sword & Shield', era: SS, keywords: ['sword & shield'], base: true },
  { name: 'Rebel Clash', era: SS, keywords: ['rebel clash'] },
  { name: 'Darkness Ablaze', era: SS, keywords: ['darkness ablaze'] },
  { name: "Champion's Path", era: SS, keywords: ["champion's path", 'champions path'] },
  { name: 'Vivid Voltage', era: SS, keywords: ['vivid voltage'] },
  { name: 'Shining Fates', era: SS, keywords: ['shining fates'] },
  { name: 'Battle Styles', era: SS, keywords: ['battle styles'] },
  { name: 'Chilling Reign', era: SS, keywords: ['chilling reign'] },
  { name: 'Evolving Skies', era: SS, keywords: ['evolving skies'] },
  { name: 'Celebrations', era: SS, keywords: ['celebrations'] },
  { name: 'Fusion Strike', era: SS, keywords: ['fusion strike'] },
  { name: 'Brilliant Stars', era: SS, keywords: ['brilliant stars'] },
  { name: 'Astral Radiance', era: SS, keywords: ['astral radiance'] },
  { name: 'Pokémon GO', era: SS, keywords: ['pokémon go', 'pokemon go'] },
  { name: 'Lost Origin', era: SS, keywords: ['lost origin'] },
  { name: 'Silver Tempest', era: SS, keywords: ['silver tempest'] },
  { name: 'Crown Zenith', era: SS, keywords: ['crown zenith'] },
  { name: 'Scarlet & Violet', era: SV, keywords: ['scarlet & violet'], base: true },
  { name: 'Paldea Evolved', era: SV, keywords: ['paldea evolved'] },
  { name: 'Obsidian Flames', era: SV, keywords: ['obsidian flames'] },
  { name: '151', era: SV, keywords: ['151'] },
  { name: 'Paradox Rift', era: SV, keywords: ['paradox rift'] },
  { name: 'Paldean Fates', era: SV, keywords: ['paldean fates'] },
  { name: 'Temporal Forces', era: SV, keywords: ['temporal forces'] },
  { name: 'Twilight Masquerade', era: SV, keywords: ['twilight masquerade'] },
  { name: 'Shrouded Fable', era: SV, keywords: ['shrouded fable'] },
  { name: 'Stellar Crown', era: SV, keywords: ['stellar crown'] },
  { name: 'Surging Sparks', era: SV, keywords: ['surging sparks'] },
  { name: 'Prismatic Evolutions', era: SV, keywords: ['prismatic evolutions'] },
  { name: 'Journey Together', era: SV, keywords: ['journey together'] },
  { name: 'Destined Rivals', era: SV, keywords: ['destined rivals'] },
  {
    name: 'Black Bolt / White Flare',
    era: SV,
    keywords: ['black bolt', 'white flare'],
    splitTag: true
  },
  { name: 'Mega Evolution', era: ME, keywords: ['mega evolution'], base: true },
  { name: 'Phantasmal Flames', era: ME, keywords: ['phantasmal flames'] },
  { name: 'Ascended Heroes', era: ME, keywords: ['ascended heroes'] },
  { name: 'Perfect Order', era: ME, keywords: ['perfect order'] },
  { name: 'Chaos Rising', era: ME, keywords: ['chaos rising'] }
]

// Match specific sets before era base sets, so "Mega Evolution—Ascended Heroes"
// resolves to Ascended Heroes rather than the Mega Evolution base set.
const SET_MATCH_ORDER: PokemonSet[] = [
  ...POKEMON_SETS.filter((s) => !s.base),
  ...POKEMON_SETS.filter((s) => s.base)
]

// Lowercase set keyword(s) keyed by set name — drives row-label set stripping.
const SET_KEYWORDS: Record<string, string[]> = Object.fromEntries(
  POKEMON_SETS.map((s) => [s.name, s.keywords])
)

// Set names whose row label keeps the matched variant as a "[Variant]" tag
// instead of stripping it (see PokemonSet.splitTag).
const SPLIT_TAG_SETS = new Set(POKEMON_SETS.filter((s) => s.splitTag).map((s) => s.name))

/** Detect the Pokémon set from an item title, or null if none is recognized. */
export function detectSet(item: string): { set: string; era: PokemonEra } | null {
  const t = item.toLowerCase()
  for (const set of SET_MATCH_ORDER) {
    if (set.keywords.some((k) => t.includes(k))) return { set: set.name, era: set.era }
  }
  return null
}

// Item titles repeat the game name (e.g. "Pokémon Trading Card Game: ..."),
// which is redundant once the entry sits under its category group. Two passes:
// strip a "<game> Trading Card Game:" / "Card Game:" / "TCG:" / Magic prefix,
// then strip any leftover bare leading game name (e.g. "One Piece Devils Fruit
// Collection 1" -> "Devils Fruit Collection 1"). "Pokémon Day ..." is kept,
// since there "Pokémon" is part of the product name. The raw `item` is kept
// for categorization and as the GitHub source.
const TCG_PREFIX = /^.*?(?:Trading Card Game|Card Game|TCG|The Gathering)\s*:\s*/i
const GAME_PREFIX =
  /^(?:Bandai\s+)?(?:Pok[eé]mon(?!\s+Day)|One Piece|Magic(?::?\s*The Gathering)?)\s+/i

/** Cleaned item title for display — see TCG_PREFIX / GAME_PREFIX. */
export function displayName(item: string): string {
  return item.replace(TCG_PREFIX, '').replace(GAME_PREFIX, '').trim()
}

// Item titles also lead with the era name ("Scarlet & Violet—…", "Sword &
// Shield …"), which is redundant once the row sits under its era/set group.
// Target's punctuation is loose — em/en dash or hyphen separators, a missing
// "&", an optional set code like "S3.5" — so each era gets a permissive
// leading matcher that also eats the trailing code and separators.
const ERA_PREFIX: Record<PokemonEra, RegExp> = {
  'Sword & Shield Era': /^sword\s*&?\s*shield(?:\s+s\d+(?:\.\d+)?)?[\s:—–-]*/i,
  'Scarlet & Violet Era': /^scarlet\s*&?\s*violet(?:\s+s\d+(?:\.\d+)?)?[\s:—–-]*/i,
  'Mega Evolution Era': /^mega\s+evolution(?:\s+s\d+(?:\.\d+)?)?[\s:—–-]*/i
}

// Trailing run of separators Target puts between an era/set name and the rest
// of the title (space, colon, em/en dash, hyphen).
const NAME_SEP = '[\\s:—–-]*'

/** Title-case a lowercase keyword: "white flare" -> "White Flare". */
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/**
 * Display title for a checklist row. Like `displayName`, but drops the leading
 * Pokémon era name — the row already sits under its era/set group, so
 * repeating "Scarlet & Violet" on every line is just noise. When `stripSet` is
 * set (the row also sits under a set group), the leading set name is dropped
 * too — except for split-tag sets (Black Bolt / White Flare), where the
 * variant is kept as a "[Variant]" tag so the rows stay distinguishable.
 * Falls back to the full name if stripping would leave nothing.
 */
export function rowDisplayName(entry: SkuEntry, stripSet = false): string {
  const name = displayName(entry.item)
  if (!entry.era) return name
  let out = name.replace(ERA_PREFIX[entry.era], '').trim()
  if (stripSet && entry.set) {
    const tagged = SPLIT_TAG_SETS.has(entry.set)
    for (const kw of SET_KEYWORDS[entry.set] ?? []) {
      const re = new RegExp('^' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + NAME_SEP, 'i')
      const m = out.match(re)
      if (m) {
        const rest = out.slice(m[0].length).trim()
        out = tagged ? `[${titleCase(kw)}] ${rest}`.trim() : rest
        break
      }
    }
  }
  return out || name
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
    const category = categorize(item)
    const matched = category === 'Pokémon' ? detectSet(item) : null
    out.push({
      sku,
      item,
      category,
      set: matched?.set ?? null,
      era: matched?.era ?? null
    })
  }
  return out
}

/** Build the export string for a list of SKUs in the requested format. */
export function formatSkus(skus: string[], format: ExportFormat): string {
  switch (format) {
    case 'shikari':
      // Shikari expects a comma+space separated SKU list.
      return skus.join(', ')
    case 'stellar':
      // Stellar expects one "SKU;;" per line.
      return skus.map((s) => `${s};;`).join('\n')
    case 'refract':
      // Refract expects one bare SKU per line.
      return skus.join('\n')
  }
}

/** Max SKUs allowed in a single Shikari Monitor list. */
export const SHIKARI_MONITOR_MAX = 30

/**
 * Split SKUs into the fewest lists possible with no list larger than
 * `maxSize`, keeping list sizes as even as possible (e.g. 70 with max 30 ->
 * 24, 23, 23 rather than 30, 30, 10).
 */
export function chunkEvenly(skus: string[], maxSize: number): string[][] {
  if (skus.length === 0) return []
  const count = Math.ceil(skus.length / maxSize)
  const base = Math.floor(skus.length / count)
  const remainder = skus.length % count
  const chunks: string[][] = []
  let i = 0
  for (let c = 0; c < count; c++) {
    const size = base + (c < remainder ? 1 : 0)
    chunks.push(skus.slice(i, i + size))
    i += size
  }
  return chunks
}

/**
 * Extract the SKU tokens from an export string. Splits on commas, semicolons
 * and any whitespace, so Shikari ("SKU, SKU"), Stellar ("SKU;;" per line) and
 * loosely pasted lists all round-trip.
 */
export function parseSkuList(text: string, _format: ExportFormat): string[] {
  return text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Guess the export format from a typed/pasted string. Stellar uses a ";;"
 * suffix per line; Shikari is comma-separated; bare SKUs (one per line) are
 * treated as Refract.
 */
export function detectFormat(text: string): ExportFormat {
  if (text.includes(';;')) return 'stellar'
  if (text.includes(',')) return 'shikari'
  return 'refract'
}

/** SKUs parsed from the copy bundled into the app. Always available offline. */
export const BUNDLED_SKUS: SkuEntry[] = parseSkuCsv(bundledCsv)

// Raw GitHub URL for the live-updatable SKU catalog. The Target SKUs page
// re-fetches this every minute, so editing the file on the `SKUs` branch
// updates the catalog with no rebuild.
export const SKUS_REMOTE_URL =
  'https://raw.githubusercontent.com/shigeosapsycho/multitool/refs/heads/SKUs/SKUs.csv'

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

// ---------- checklist grouping ----------

export type GroupingMode = 'set' | 'era-set' | 'era'

/** A checklist group. Leaf groups carry `items`; parent groups carry `children`. */
export type SkuGroup = {
  key: string
  label: string
  items: SkuEntry[]
  children?: SkuGroup[]
}

/** Label for Pokémon entries that matched no known set. */
const POKEMON_OTHER = 'Pokémon — Other'

function byDisplayName(a: SkuEntry, b: SkuEntry): number {
  return displayName(a.item).localeCompare(displayName(b.item), undefined, {
    sensitivity: 'base'
  })
}

/**
 * Organize entries into checklist groups. Pokémon entries are sub-grouped by
 * the chosen mode; One Piece / Magic / Other always stay single groups. Empty
 * groups are omitted and leaf items are sorted by display name.
 */
export function buildGroups(entries: SkuEntry[], mode: GroupingMode): SkuGroup[] {
  const leaf = (key: string, label: string, items: SkuEntry[]): SkuGroup => ({
    key,
    label,
    items: [...items].sort(byDisplayName)
  })
  const pokemon = entries.filter((e) => e.category === 'Pokémon')
  const groups: SkuGroup[] = []

  if (mode === 'era-set') {
    for (const era of POKEMON_ERAS) {
      const eraItems = pokemon.filter((e) => e.era === era)
      if (eraItems.length === 0) continue
      const children: SkuGroup[] = []
      for (const set of POKEMON_SETS) {
        if (set.era !== era) continue
        const items = eraItems.filter((e) => e.set === set.name)
        if (items.length === 0) continue
        // The era's namesake base set would just repeat the era heading.
        const label = set.base ? 'Base Set' : set.name
        children.push(leaf(`set:${set.name}`, label, items))
      }
      groups.push({ key: `era:${era}`, label: era, items: [], children })
    }
  } else if (mode === 'era') {
    for (const era of POKEMON_ERAS) {
      const items = pokemon.filter((e) => e.era === era)
      if (items.length) groups.push(leaf(`era:${era}`, era, items))
    }
  } else {
    for (const set of POKEMON_SETS) {
      const items = pokemon.filter((e) => e.set === set.name)
      if (items.length) groups.push(leaf(`set:${set.name}`, set.name, items))
    }
  }
  // Pokémon entries with no recognized set.
  const unmatched = pokemon.filter((e) => e.set === null)
  if (unmatched.length) groups.push(leaf('pokemon:other', POKEMON_OTHER, unmatched))

  // Non-Pokémon categories — always a single group each.
  for (const category of ['One Piece', 'Magic: The Gathering', 'Other'] as const) {
    const items = entries.filter((e) => e.category === category)
    if (items.length) groups.push(leaf(`cat:${category}`, category, items))
  }
  return groups
}
