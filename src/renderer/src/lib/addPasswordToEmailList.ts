// Logic for the Add Passwords tool: turn a list of emails into `email:password`
// lines, using either one fixed password for all or a random password per email.

export type CharSets = {
  upper: boolean
  lower: boolean
  numbers: boolean
  symbols: boolean
}

export type PasswordMode =
  | { kind: 'fixed'; password: string }
  | { kind: 'random'; length: number; sets: CharSets }

export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const LOWER = 'abcdefghijklmnopqrstuvwxyz'
export const NUMBERS = '0123456789'
export const SYMBOLS = '!@#$%^&*()-_=+'

/**
 * Concatenated allowed characters for the selected sets, in a fixed
 * upper/lower/numbers/symbols order. Falls back to lowercase when nothing is
 * selected (defensive — the UI keeps at least one set on).
 */
export function buildAlphabet(sets: CharSets): string {
  let out = ''
  if (sets.upper) out += UPPER
  if (sets.lower) out += LOWER
  if (sets.numbers) out += NUMBERS
  if (sets.symbols) out += SYMBOLS
  return out || LOWER
}

/**
 * `count` unbiased integers in [0, max), drawn from crypto.getRandomValues with
 * rejection sampling — values in the biased tail are discarded so no character
 * is favored by the modulo.
 */
function secureRandomInts(count: number, max: number): number[] {
  const out: number[] = []
  if (max <= 0) return out
  // Largest multiple of `max` below 2^32; values at or above it would skew `% max`.
  const limit = Math.floor(0x1_0000_0000 / max) * max
  const buf = new Uint32Array(1)
  while (out.length < count) {
    crypto.getRandomValues(buf)
    const v = buf[0]!
    if (v < limit) out.push(v % max)
  }
  return out
}

/**
 * A password of `length` characters drawn uniformly from `alphabet`. `randInts`
 * is injectable so callers (and tests) can supply a deterministic source; it
 * defaults to the crypto-backed generator.
 */
export function generatePassword(
  length: number,
  alphabet: string,
  randInts: (count: number, max: number) => number[] = secureRandomInts
): string {
  if (length <= 0 || alphabet.length === 0) return ''
  return randInts(length, alphabet.length)
    .map((i) => alphabet[i])
    .join('')
}

/**
 * Parse one email per line (trim each, drop blanks) and append a password to
 * each as `email:password`. Fixed mode reuses one password for every email;
 * random mode generates a fresh password per email.
 */
export function addPasswordToEmailList(
  text: string,
  mode: PasswordMode,
  randInts?: (count: number, max: number) => number[]
): string[] {
  const emails = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (mode.kind === 'fixed') {
    return emails.map((e) => `${e}:${mode.password}`)
  }
  const alphabet = buildAlphabet(mode.sets)
  return emails.map((e) => `${e}:${generatePassword(mode.length, alphabet, randInts)}`)
}
