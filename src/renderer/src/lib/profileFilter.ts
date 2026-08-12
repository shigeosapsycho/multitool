import { parseCsvRow } from './transforms'

// Filters a profile export (Refract JSON, Stellar AIO JSON, or Shikari CSV)
// down to the rows whose `email` is in a user-supplied list. The output
// preserves the source format so it re-imports cleanly: a JSON array for
// Refract/Stellar, header + rows for Shikari.

export type ProfileFormat = 'refract' | 'stellar' | 'shikari' | 'unknown'

/** Canonical profile shape, the superset of fields both formats carry. */
export type Profile = {
  name: string
  email: string
  firstName: string
  lastName: string
  phone: string
  ccNumber: string
  ccMonth: string
  ccYear: string
  ccCvv: string
  shipStreet: string
  shipStreet2: string
  shipCity: string
  shipState: string
  shipZip: string
  shipCountry: string
  billFirstName: string
  billLastName: string
  billStreet: string
  billStreet2: string
  billCity: string
  billState: string
  billZip: string
  billCountry: string
}

export type FilterResult = {
  format: ProfileFormat
  /** Filtered file in the original format (JSON text | CSV text); '' on error. */
  fullOutput: string
  /** Matched profiles as canonical records, file order, drives format conversion. */
  matched: Profile[]
  /** Emails of the kept profiles, original file casing, file order, deduped. */
  matchedEmails: string[]
  /** Profiles/rows kept. */
  matchedCount: number
  /** Profiles/rows in the source file. */
  totalCount: number
  /** Requested emails with no profile in the file, original casing, deduped. */
  misses: string[]
  /** Distinct emails in the user's list. */
  emailsRequested: number
  /** Parse/format problem, else null. */
  error: string | null
}

// Header names (normalized: lowercased, separators stripped) that mark the email
// column in a Shikari CSV. Mirrors the set used by csvToEmailPass in transforms.
const EMAIL_HEADERS = new Set(['email', 'emailaddress', 'mail', 'username', 'user', 'login'])

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function emptyResult(format: ProfileFormat, error: string, requested: string[]): FilterResult {
  return {
    format,
    fullOutput: '',
    matched: [],
    matchedEmails: [],
    matchedCount: 0,
    totalCount: 0,
    misses: requested,
    emailsRequested: requested.length,
    error
  }
}

const UNKNOWN_FORMAT_ERROR = 'Paste or load a Refract JSON, Stellar JSON, or Shikari CSV export.'

// Pulls the address out of a decorated list line, `email:password`,
// `Name <email>`, quoted, etc., so those still match the bare profile email.
const EMAIL_RE = /[^\s,;:<>"']+@[^\s,;:<>"']+/

/** Lowercased lookup set + first-seen original-casing list, deduped. */
function parseEmailList(text: string): { set: Set<string>; ordered: string[] } {
  const set = new Set<string>()
  const ordered: string[] = []
  for (const token of stripBom(text).split(/[\s,;]+/)) {
    // Only count tokens that actually contain an address; a bare name from a
    // "Name <email>" line isn't a requested email and shouldn't become a miss.
    const email = token.match(EMAIL_RE)?.[0]
    if (!email) continue
    const low = email.toLowerCase()
    if (set.has(low)) continue
    set.add(low)
    ordered.push(email)
  }
  return { set, ordered }
}

function computeMisses(requested: string[], fileEmailsLower: Set<string>): string[] {
  return requested.filter((e) => !fileEmailsLower.has(e.toLowerCase()))
}

/** True for an element shaped like a Stellar AIO profile rather than a Refract one. */
function isStellarElement(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false
  const o = el as Record<string, unknown>
  if ('profileName' in o || 'billingAsShipping' in o) return true
  const pay = o.payment
  return !!pay && typeof pay === 'object' && 'cardNumber' in (pay as Record<string, unknown>)
}

export function detectProfileFormat(text: string): ProfileFormat {
  const t = stripBom(text).replace(/^\s+/, '')
  if (!t) return 'unknown'
  const c = t[0]
  if (c !== '[' && c !== '{') return 'shikari'
  // Refract and Stellar are both JSON arrays with a top-level `email`; telling
  // them apart needs the first profile's keys. Unparseable JSON stays 'refract'
  // so the JSON path reports the parse error.
  try {
    const list = extractArray(JSON.parse(t))
    const first = list?.find((el) => el && typeof el === 'object')
    if (first !== undefined && isStellarElement(first)) return 'stellar'
  } catch {
    // fall through
  }
  return 'refract'
}

export function filterProfiles(emailsText: string, profileText: string): FilterResult {
  const { set: allowed, ordered: requested } = parseEmailList(emailsText)
  const format = detectProfileFormat(profileText)
  if (format === 'unknown') {
    return emptyResult('unknown', UNKNOWN_FORMAT_ERROR, requested)
  }
  return format === 'shikari'
    ? filterShikari(profileText, allowed, requested)
    : filterJson(profileText, format, allowed, requested)
}

/** The profile array, whether the JSON is a bare array or a `{profiles:[…]}` wrapper. */
function extractArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    for (const key of ['profiles', 'data', 'items']) {
      const v = (parsed as Record<string, unknown>)[key]
      if (Array.isArray(v)) return v
    }
  }
  return null
}

function emailOf(el: unknown): string | null {
  if (el && typeof el === 'object') {
    const v = (el as Record<string, unknown>).email
    if (typeof v === 'string') return v
  }
  return null
}

function filterJson(
  text: string,
  format: 'refract' | 'stellar',
  allowed: Set<string>,
  requested: string[]
): FilterResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch (e) {
    return emptyResult(format, `Invalid JSON: ${(e as Error).message}`, requested)
  }
  const list = extractArray(parsed)
  if (!list) {
    return emptyResult(format, 'Expected a JSON array of profiles.', requested)
  }
  const toProfile = format === 'stellar' ? stellarToProfile : refractToProfile

  const fileEmailsLower = new Set<string>()
  const kept: unknown[] = []
  const matched: Profile[] = []
  const matchedEmails: string[] = []
  const seenMatched = new Set<string>()
  for (const el of list) {
    const email = emailOf(el)
    if (email === null) continue
    const low = email.trim().toLowerCase()
    fileEmailsLower.add(low)
    // Keep the first profile per email, a list of emails wants one match each,
    // even when the export repeats an email across rows.
    if (allowed.has(low) && !seenMatched.has(low)) {
      seenMatched.add(low)
      kept.push(el)
      matched.push(toProfile(el, email))
      matchedEmails.push(email)
    }
  }

  return {
    format,
    fullOutput: JSON.stringify(kept),
    matched,
    matchedEmails,
    matchedCount: kept.length,
    totalCount: list.length,
    misses: computeMisses(requested, fileEmailsLower),
    emailsRequested: requested.length,
    error: null
  }
}

function findEmailColumn(header: string[]): number {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''))
  return norm.findIndex((h) => EMAIL_HEADERS.has(h))
}

function filterShikari(text: string, allowed: Set<string>, requested: string[]): FilterResult {
  const rows = stripBom(text).split(/\r?\n/)
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.trim().length > 0) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    return emptyResult('shikari', 'The CSV is empty.', requested)
  }

  const headerCells = parseCsvRow(rows[headerIdx]!)
  const emailIdx = findEmailColumn(headerCells)
  if (emailIdx === -1) {
    return emptyResult('shikari', 'No email column found in the CSV header.', requested)
  }
  const colIndex = buildShikariColumnIndex(headerCells)

  const fileEmailsLower = new Set<string>()
  const keptRows: string[] = []
  const matched: Profile[] = []
  const matchedEmails: string[] = []
  const seenMatched = new Set<string>()
  let total = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const raw = rows[i]!
    if (!raw.trim()) continue
    total++
    const cells = parseCsvRow(raw)
    const email = (cells[emailIdx] ?? '').trim()
    if (!email) continue
    const low = email.toLowerCase()
    fileEmailsLower.add(low)
    // Keep the first row per email, one match per listed email, even when the
    // export repeats an email across rows.
    if (allowed.has(low) && !seenMatched.has(low)) {
      seenMatched.add(low)
      keptRows.push(raw)
      matched.push(shikariToProfile(cells, colIndex, email))
      matchedEmails.push(email)
    }
  }

  return {
    format: 'shikari',
    fullOutput: [rows[headerIdx]!, ...keptRows].join('\n'),
    matched,
    matchedEmails,
    matchedCount: keptRows.length,
    totalCount: total,
    misses: computeMisses(requested, fileEmailsLower),
    emailsRequested: requested.length,
    error: null
  }
}

// ---------- dedupe ----------

export type DedupeResult = {
  format: ProfileFormat
  /** Deduped file in the original format (JSON text | CSV text); '' on error. */
  fullOutput: string
  /** Kept profiles as canonical records, file order, drives format conversion. */
  kept: Profile[]
  /** Emails of kept profiles, original casing, file order (email-less entries omitted). */
  keptEmails: string[]
  /** Entries kept (including email-less ones). */
  keptCount: number
  /** Entries dropped as duplicates. */
  removedCount: number
  /** Email of each dropped entry, original casing, file order (one per drop). */
  removedEmails: string[]
  /** Entries in the source file. */
  totalCount: number
  /** Parse/format problem, else null. */
  error: string | null
}

function emptyDedupe(format: ProfileFormat, error: string): DedupeResult {
  return {
    format,
    fullOutput: '',
    kept: [],
    keptEmails: [],
    keptCount: 0,
    removedCount: 0,
    removedEmails: [],
    totalCount: 0,
    error
  }
}

/**
 * Remove duplicate profiles from an export: same email (trimmed,
 * case-insensitive) means duplicate, the first occurrence wins, and entries
 * without an email are never dropped. Kept entries are preserved verbatim so
 * the output re-imports cleanly in the source format.
 */
export function dedupeProfiles(profileText: string): DedupeResult {
  if (!profileText) {
    // Completely empty, truly unknown
    return emptyDedupe('unknown', UNKNOWN_FORMAT_ERROR)
  }
  const normalized = stripBom(profileText).replace(/^\s+/, '')
  let format: ProfileFormat
  if (!normalized) {
    // Whitespace-only input, treat as shikari to get "empty CSV" error
    format = 'shikari'
  } else {
    format = detectProfileFormat(profileText)
  }
  if (format === 'unknown') {
    return emptyDedupe('unknown', UNKNOWN_FORMAT_ERROR)
  }
  return format === 'shikari' ? dedupeShikari(profileText) : dedupeJson(profileText, format)
}

function dedupeJson(text: string, format: 'refract' | 'stellar'): DedupeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch (e) {
    return emptyDedupe(format, `Invalid JSON: ${(e as Error).message}`)
  }
  const list = extractArray(parsed)
  if (!list) {
    return emptyDedupe(format, 'Expected a JSON array of profiles.')
  }
  const toProfile = format === 'stellar' ? stellarToProfile : refractToProfile

  const seen = new Set<string>()
  const keptElements: unknown[] = []
  const kept: Profile[] = []
  const keptEmails: string[] = []
  const removedEmails: string[] = []
  let removed = 0
  for (const el of list) {
    const email = emailOf(el)
    if (email === null) {
      // Nothing to key on, never a duplicate; keep verbatim.
      keptElements.push(el)
      continue
    }
    const low = email.trim().toLowerCase()
    if (seen.has(low)) {
      removed++
      removedEmails.push(email)
      continue
    }
    seen.add(low)
    keptElements.push(el)
    kept.push(toProfile(el, email))
    keptEmails.push(email)
  }

  return {
    format,
    fullOutput: JSON.stringify(keptElements),
    kept,
    keptEmails,
    keptCount: keptElements.length,
    removedCount: removed,
    removedEmails,
    totalCount: list.length,
    error: null
  }
}

function dedupeShikari(text: string): DedupeResult {
  const rows = stripBom(text).split(/\r?\n/)
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.trim().length > 0) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    return emptyDedupe('shikari', 'The CSV is empty.')
  }

  const headerCells = parseCsvRow(rows[headerIdx]!)
  const emailIdx = findEmailColumn(headerCells)
  if (emailIdx === -1) {
    return emptyDedupe('shikari', 'No email column found in the CSV header.')
  }
  const colIndex = buildShikariColumnIndex(headerCells)

  const seen = new Set<string>()
  const keptRows: string[] = []
  const kept: Profile[] = []
  const keptEmails: string[] = []
  const removedEmails: string[] = []
  let total = 0
  let removed = 0
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const raw = rows[i]!
    if (!raw.trim()) continue
    total++
    const cells = parseCsvRow(raw)
    const email = (cells[emailIdx] ?? '').trim()
    if (!email) {
      // Nothing to key on, never a duplicate; keep the raw row.
      keptRows.push(raw)
      continue
    }
    const low = email.toLowerCase()
    if (seen.has(low)) {
      removed++
      removedEmails.push(email)
      continue
    }
    seen.add(low)
    keptRows.push(raw)
    kept.push(shikariToProfile(cells, colIndex, email))
    keptEmails.push(email)
  }

  return {
    format: 'shikari',
    fullOutput: [rows[headerIdx]!, ...keptRows].join('\n'),
    kept,
    keptEmails,
    keptCount: keptRows.length,
    removedCount: removed,
    removedEmails,
    totalCount: total,
    error: null
  }
}

// ---------- combine ----------

/** One parsed profile plus the source element it came from (null for CSV rows). */
export type ParsedProfile = { profile: Profile; raw: unknown }

export type ParseResult = {
  format: ProfileFormat
  /** Every entry in the file, file order. Entries without an email carry `email: ''`. */
  profiles: ParsedProfile[]
  /** Parse/format problem, else null. */
  error: string | null
}

/**
 * Parse any supported export into canonical profiles.
 *
 * Unlike `filterProfiles` / `dedupeProfiles`, which keep source entries verbatim
 * so a same-format run round-trips losslessly, this drops down to the canonical
 * shape immediately: combining mixed formats has to go through it anyway. The
 * original element rides along in `raw` so an all-one-format combine can still
 * emit the untouched JSON.
 */
export function parseProfiles(text: string): ParseResult {
  // Blank sources report the same "which format?" hint as unrecognizable ones,
  // rather than dedupeProfiles' "The CSV is empty." guess at a format.
  if (!stripBom(text).trim()) {
    return { format: 'unknown', profiles: [], error: UNKNOWN_FORMAT_ERROR }
  }
  const format = detectProfileFormat(text)
  if (format === 'unknown') return { format, profiles: [], error: UNKNOWN_FORMAT_ERROR }
  return format === 'shikari' ? parseShikari(text) : parseJson(text, format)
}

function parseJson(text: string, format: 'refract' | 'stellar'): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch (e) {
    return { format, profiles: [], error: `Invalid JSON: ${(e as Error).message}` }
  }
  const list = extractArray(parsed)
  if (!list) return { format, profiles: [], error: 'Expected a JSON array of profiles.' }
  const toProfile = format === 'stellar' ? stellarToProfile : refractToProfile
  const profiles = list.map((el) => ({
    profile: toProfile(el, (emailOf(el) ?? '').trim()),
    raw: el
  }))
  return { format, profiles, error: null }
}

function parseShikari(text: string): ParseResult {
  const rows = stripBom(text).split(/\r?\n/)
  const headerIdx = rows.findIndex((r) => r.trim().length > 0)
  if (headerIdx === -1) return { format: 'shikari', profiles: [], error: 'The CSV is empty.' }

  const headerCells = parseCsvRow(rows[headerIdx]!)
  const emailIdx = findEmailColumn(headerCells)
  if (emailIdx === -1) {
    return { format: 'shikari', profiles: [], error: 'No email column found in the CSV header.' }
  }
  const colIndex = buildShikariColumnIndex(headerCells)

  const profiles: ParsedProfile[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const raw = rows[i]!
    if (!raw.trim()) continue
    const cells = parseCsvRow(raw)
    // Column order varies between Shikari exports, so a CSV row is never
    // replayed verbatim; the canonical record is the only safe carrier.
    profiles.push({
      profile: shikariToProfile(cells, colIndex, (cells[emailIdx] ?? '').trim()),
      raw: null
    })
  }
  return { format: 'shikari', profiles, error: null }
}

/** One file (or pasted blob) fed into a combine run. */
export type CombineInput = { name: string; text: string }

/** Per-source outcome, so the UI can show which file contributed what. */
export type CombineSourceStat = {
  name: string
  format: ProfileFormat
  /** Profiles read from this source. */
  total: number
  /** Profiles this source contributed to the combined output. */
  kept: number
  /** Parse/format problem for this source, else null. Errored sources contribute nothing. */
  error: string | null
}

export type CombineResult = {
  sources: CombineSourceStat[]
  /** Every kept profile, source order then file order. */
  combined: Profile[]
  /** Emails of the kept profiles, original casing (email-less entries omitted). */
  emails: string[]
  /** Profiles read across all sources, before dedupe. */
  totalCount: number
  /** Profiles in the combined output. */
  keptCount: number
  /** Profiles dropped as duplicates (0 when dedupe is off). */
  duplicateCount: number
  /** Email of each dropped duplicate, original casing, in drop order. */
  duplicateEmails: string[]
  /**
   * Set when every contributing source is the same JSON format, letting that
   * format's output be the untouched source elements instead of a re-serialize.
   */
  nativeFormat: 'refract' | 'stellar' | null
  /** The verbatim JSON for `nativeFormat`; '' when there is no native path. */
  nativeOutput: string
  /** Whole-run problem (no sources at all), else null. Per-source problems live in `sources`. */
  error: string | null
}

/**
 * Merge several profile exports into one list, in the order the sources were
 * added. Formats can be mixed; every source is mapped through the canonical
 * profile, so the caller can serialize the result to any supported format.
 *
 * With `dedupe` (the default), the first profile per email wins and later
 * repeats are dropped, matching `dedupeProfiles`. Entries without an email are
 * never treated as duplicates. A source that fails to parse is reported in
 * `sources` and skipped; the rest of the run still combines.
 */
export function combineProfiles(
  inputs: CombineInput[],
  opts: { dedupe?: boolean } = {}
): CombineResult {
  const dedupe = opts.dedupe !== false
  const sources: CombineSourceStat[] = []
  const combined: Profile[] = []
  const rawElements: unknown[] = []
  const emails: string[] = []
  const duplicateEmails: string[] = []
  const seen = new Set<string>()
  let totalCount = 0
  // Verbatim JSON passthrough survives only while every contributing source is
  // the same JSON format; one Shikari or one mixed pair retires it.
  let nativeFormat: 'refract' | 'stellar' | null = null
  let nativeOk = true

  for (const input of inputs) {
    const parsed = parseProfiles(input.text)
    if (parsed.error) {
      sources.push({
        name: input.name,
        format: parsed.format,
        total: 0,
        kept: 0,
        error: parsed.error
      })
      continue
    }
    let kept = 0
    for (const { profile, raw } of parsed.profiles) {
      totalCount++
      const low = profile.email.toLowerCase()
      if (dedupe && low && seen.has(low)) {
        duplicateEmails.push(profile.email)
        continue
      }
      if (low) {
        seen.add(low)
        emails.push(profile.email)
      }
      combined.push(profile)
      rawElements.push(raw)
      kept++
    }
    sources.push({
      name: input.name,
      format: parsed.format,
      total: parsed.profiles.length,
      kept,
      error: null
    })
    if (parsed.profiles.length > 0) {
      if (parsed.format !== 'refract' && parsed.format !== 'stellar') nativeOk = false
      else if (nativeFormat === null) nativeFormat = parsed.format
      else if (nativeFormat !== parsed.format) nativeOk = false
    }
  }

  const native = nativeOk ? nativeFormat : null
  return {
    sources,
    combined,
    emails,
    totalCount,
    keptCount: combined.length,
    duplicateCount: duplicateEmails.length,
    duplicateEmails,
    nativeFormat: native,
    nativeOutput: native ? JSON.stringify(rawElements) : '',
    error: inputs.length === 0 ? 'Add at least one profile source.' : null
  }
}

// ---------- canonical mapping + format conversion ----------

// Canonical Profile field -> Shikari CSV column, in column order. Drives both
// parsing a Shikari row into a Profile and serializing a Profile back out.
const SHIKARI_COLUMNS: [keyof Profile, string][] = [
  ['name', 'profile_name'],
  ['firstName', 'first_name'],
  ['lastName', 'last_name'],
  ['email', 'email'],
  ['phone', 'phone_num'],
  ['ccNumber', 'cc_number'],
  ['ccMonth', 'cc_exp_month'],
  ['ccYear', 'cc_exp_year'],
  ['ccCvv', 'cc_cvv'],
  ['shipStreet', 'shipping_street'],
  ['shipStreet2', 'shipping_street_2'],
  ['shipCity', 'shipping_city'],
  ['shipState', 'shipping_state'],
  ['shipZip', 'shipping_zip_code'],
  ['shipCountry', 'shipping_country'],
  ['billFirstName', 'billing_first_name'],
  ['billLastName', 'billing_last_name'],
  ['billStreet', 'billing_street'],
  ['billStreet2', 'billing_street_2'],
  ['billCity', 'billing_city'],
  ['billState', 'billing_state'],
  ['billZip', 'billing_zip_code'],
  ['billCountry', 'billing_country']
]

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function buildShikariColumnIndex(header: string[]): Partial<Record<keyof Profile, number>> {
  const norm = header.map((h) => h.trim().toLowerCase())
  const idx: Partial<Record<keyof Profile, number>> = {}
  for (const [field, name] of SHIKARI_COLUMNS) {
    const i = norm.indexOf(name)
    if (i !== -1) idx[field] = i
  }
  return idx
}

function shikariToProfile(
  cells: string[],
  idx: Partial<Record<keyof Profile, number>>,
  email: string
): Profile {
  const get = (field: keyof Profile): string => {
    const i = idx[field]
    return i === undefined ? '' : (cells[i] ?? '').trim()
  }
  return {
    name: get('name'),
    email,
    firstName: get('firstName'),
    lastName: get('lastName'),
    phone: get('phone'),
    ccNumber: get('ccNumber'),
    ccMonth: get('ccMonth'),
    ccYear: get('ccYear'),
    ccCvv: get('ccCvv'),
    shipStreet: get('shipStreet'),
    shipStreet2: get('shipStreet2'),
    shipCity: get('shipCity'),
    shipState: get('shipState'),
    shipZip: get('shipZip'),
    shipCountry: get('shipCountry'),
    billFirstName: get('billFirstName'),
    billLastName: get('billLastName'),
    billStreet: get('billStreet'),
    billStreet2: get('billStreet2'),
    billCity: get('billCity'),
    billState: get('billState'),
    billZip: get('billZip'),
    billCountry: get('billCountry')
  }
}

function refractToProfile(el: unknown, email: string): Profile {
  const o = asObject(el)
  const ship = asObject(o.shipping)
  const bill = asObject(o.billing)
  const pay = asObject(o.payment)
  // Refract leaves billing blank when it mirrors shipping; fill it for formats
  // (like Shikari) that always carry explicit billing columns.
  const sameAs = bill.sameAsShipping === true
  const billOr = (billKey: string, shipKey: string): string =>
    sameAs ? str(ship[shipKey]) : str(bill[billKey])
  return {
    name: str(o.name),
    email,
    firstName: str(ship.firstName),
    lastName: str(ship.lastName),
    phone: str(ship.phone),
    ccNumber: str(pay.num),
    ccMonth: str(pay.month),
    ccYear: str(pay.year),
    ccCvv: str(pay.cvv),
    shipStreet: str(ship.address1),
    shipStreet2: str(ship.address2),
    shipCity: str(ship.city),
    shipState: str(ship.province),
    shipZip: str(ship.postalCode),
    shipCountry: str(ship.country),
    billFirstName: billOr('firstName', 'firstName'),
    billLastName: billOr('lastName', 'lastName'),
    billStreet: billOr('address1', 'address1'),
    billStreet2: billOr('address2', 'address2'),
    billCity: billOr('city', 'city'),
    billState: sameAs ? str(ship.province) : str(bill.province),
    billZip: billOr('postalCode', 'postalCode'),
    billCountry: sameAs ? str(ship.country) : str(bill.country)
  }
}

// Stellar's cardYear is 2-digit ("28"); the canonical Profile carries 4-digit
// years like Refract, so expand on parse and compress back on serialize.
function expandYear(y: string): string {
  return /^\d{2}$/.test(y) ? `20${y}` : y
}

function stellarToProfile(el: unknown, email: string): Profile {
  const o = asObject(el)
  const ship = asObject(o.shipping)
  const bill = asObject(o.billing)
  const pay = asObject(o.payment)
  // Stellar leaves billing meaningless when billingAsShipping is set; fill it
  // for formats (like Shikari) that always carry explicit billing columns.
  const sameAs = o.billingAsShipping === true
  const billOr = (key: string): string => (sameAs ? str(ship[key]) : str(bill[key]))
  return {
    name: str(o.profileName),
    email,
    firstName: str(ship.firstName),
    lastName: str(ship.lastName),
    phone: str(o.phone),
    ccNumber: str(pay.cardNumber),
    ccMonth: str(pay.cardMonth),
    ccYear: expandYear(str(pay.cardYear)),
    ccCvv: str(pay.cardCvv),
    shipStreet: str(ship.address),
    shipStreet2: str(ship.address2),
    shipCity: str(ship.city),
    shipState: str(ship.state),
    shipZip: str(ship.zipcode),
    shipCountry: str(ship.country),
    billFirstName: billOr('firstName'),
    billLastName: billOr('lastName'),
    billStreet: billOr('address'),
    billStreet2: billOr('address2'),
    billCity: billOr('city'),
    billState: billOr('state'),
    billZip: billOr('zipcode'),
    billCountry: billOr('country')
  }
}

// Rough card network from the leading digits, for Stellar's cardType field,
// which the canonical Profile does not carry.
function cardTypeOf(num: string): string {
  if (/^4/.test(num)) return 'Visa'
  if (/^(5[1-5]|2[2-7])/.test(num)) return 'Mastercard'
  if (/^3[47]/.test(num)) return 'Amex'
  if (/^6/.test(num)) return 'Discover'
  return ''
}

/** Serialize canonical profiles to a Stellar AIO JSON array (2-space pretty, like its exporter). */
export function serializeStellar(profiles: Profile[]): string {
  return JSON.stringify(
    profiles.map((p) => ({
      profileName: p.name,
      email: p.email,
      phone: p.phone,
      shipping: {
        firstName: p.firstName,
        lastName: p.lastName,
        country: p.shipCountry,
        address: p.shipStreet,
        address2: p.shipStreet2,
        state: p.shipState,
        city: p.shipCity,
        zipcode: p.shipZip
      },
      billingAsShipping: false,
      oneCheckoutPerProfile: false,
      billing: {
        firstName: p.billFirstName,
        lastName: p.billLastName,
        country: p.billCountry,
        address: p.billStreet,
        address2: p.billStreet2,
        state: p.billState,
        city: p.billCity,
        zipcode: p.billZip
      },
      payment: {
        cardName: `${p.firstName} ${p.lastName}`.trim(),
        cardType: cardTypeOf(p.ccNumber),
        cardNumber: p.ccNumber,
        cardMonth: p.ccMonth,
        cardYear: /^\d{4}$/.test(p.ccYear) ? p.ccYear.slice(2) : p.ccYear,
        cardCvv: p.ccCvv
      }
    })),
    null,
    2
  )
}

function csvField(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialize canonical profiles to a Shikari CSV (header + one row each). */
export function serializeShikari(profiles: Profile[]): string {
  const header = SHIKARI_COLUMNS.map(([, name]) => name).join(',')
  const rows = profiles.map((p) => SHIKARI_COLUMNS.map(([field]) => csvField(p[field])).join(','))
  return [header, ...rows].join('\n')
}

/** A refract-style profile id: `prf-` + a random UUID-shaped hex string. */
function genId(): string {
  let s = 'prf-'
  for (let i = 0; i < 32; i++) {
    if (i === 8 || i === 12 || i === 16 || i === 20) s += '-'
    s += Math.floor(Math.random() * 16).toString(16)
  }
  return s
}

/** Serialize canonical profiles to a Refract JSON array (minified). */
export function serializeRefract(profiles: Profile[]): string {
  const now = Date.now()
  return JSON.stringify(
    profiles.map((p) => ({
      name: p.name,
      email: p.email,
      oneTimeUse: false,
      shipping: {
        firstName: p.firstName,
        lastName: p.lastName,
        address1: p.shipStreet,
        address2: p.shipStreet2,
        city: p.shipCity,
        province: p.shipState,
        postalCode: p.shipZip,
        country: p.shipCountry,
        phone: p.phone
      },
      billing: {
        sameAsShipping: false,
        firstName: p.billFirstName,
        lastName: p.billLastName,
        address1: p.billStreet,
        address2: p.billStreet2,
        city: p.billCity,
        province: p.billState,
        postalCode: p.billZip,
        country: p.billCountry,
        phone: ''
      },
      payment: {
        name: `${p.firstName} ${p.lastName}`.trim(),
        num: p.ccNumber,
        year: p.ccYear,
        month: p.ccMonth,
        cvv: p.ccCvv
      },
      id: genId(),
      createdAt: now,
      updatedAt: now
    }))
  )
}
