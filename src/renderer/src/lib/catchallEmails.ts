// Data layer for the Catchall Email Maker. Builds random, human-looking
// addresses on one domain out of the bundled first-name, last-name and word
// lists. A catchall domain accepts mail for any local part, so the addresses
// only have to be unique and look plausible.

import firstNamesTxt from '../data/firstNames.txt?raw'
import lastNamesTxt from '../data/lastNames.txt?raw'
import wordsTxt from '../data/words.txt?raw'

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

// One entry per line in src/renderer/src/data. Edit those files to change the
// vocabulary; entries must be plain letters to stay valid in an address.
export const FIRST_NAMES = lines(firstNamesTxt)
export const LAST_NAMES = lines(lastNamesTxt)
export const WORDS = lines(wordsTxt)

/** Largest list one run will build. Keeps a mistyped amount from freezing the UI. */
export const MAX_CATCHALL_COUNT = 100_000

// Dot-separated labels of letters, digits and inner hyphens, at least two of
// them. Written without lookbehind, which older macOS webviews cannot parse.
const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

/**
 * Clean up a typed domain: trims, lowercases, and drops a leading "@" or the
 * local part of a pasted address. Returns null when what is left is not a
 * domain.
 */
export function normalizeDomain(input: string): string | null {
  const domain = input.trim().toLowerCase().replace(/^.*@/, '')
  return DOMAIN.test(domain) ? domain : null
}

type Rand = () => number

function pick(list: string[], rand: Rand): string {
  return list[Math.floor(rand() * list.length)]!
}

/** A 2 to 4 digit number, the kind people tack onto a taken username. */
function digits(rand: Rand): string {
  // Length first, then the value, so 2 and 3 digit numbers are as common as
  // 4 digit ones instead of being a tenth of a flat 10..9999 draw.
  const min = 10 ** (1 + Math.floor(rand() * 3))
  return String(min + Math.floor(rand() * 9 * min))
}

// Local-part shapes, picked evenly at random per address.
const PATTERNS: ((rand: Rand) => string)[] = [
  (r) => `${pick(FIRST_NAMES, r)}.${pick(LAST_NAMES, r)}`,
  (r) => `${pick(FIRST_NAMES, r)}${pick(LAST_NAMES, r)}`,
  (r) => `${pick(FIRST_NAMES, r)}_${pick(LAST_NAMES, r)}`,
  (r) => `${pick(FIRST_NAMES, r)}${pick(LAST_NAMES, r)}${digits(r)}`,
  (r) => `${pick(FIRST_NAMES, r)[0]}${pick(LAST_NAMES, r)}${digits(r)}`,
  (r) => `${pick(WORDS, r)}${pick(WORDS, r)}`,
  (r) => `${pick(WORDS, r)}.${pick(FIRST_NAMES, r)}`,
  (r) => `${pick(FIRST_NAMES, r)}${pick(WORDS, r)}${digits(r)}`,
  (r) => `${pick(WORDS, r)}${digits(r)}`
]

/**
 * Generate `count` unique random addresses on `domain`. Returns an empty list
 * when the domain is not valid or `count` is not a whole number from 1 to
 * MAX_CATCHALL_COUNT. `rand` is injectable so tests can replay a sequence.
 */
export function generateCatchallEmails(
  domain: string,
  count: number,
  rand: Rand = Math.random
): string[] {
  const host = normalizeDomain(domain)
  if (!host || !Number.isInteger(count) || count < 1 || count > MAX_CATCHALL_COUNT) return []
  const locals = new Set<string>()
  while (locals.size < count) {
    const base = PATTERNS[Math.floor(rand() * PATTERNS.length)]!(rand)
    // A repeat gets a counter appended instead of a re-roll, so the loop ends
    // even when the random source keeps returning the same value.
    let local = base
    for (let n = locals.size; locals.has(local); n++) local = `${base}${n}`
    locals.add(local)
  }
  return [...locals].map((local) => `${local}@${host}`)
}
