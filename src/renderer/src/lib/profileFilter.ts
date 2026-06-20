import { parseCsvRow } from './transforms'

// Filters a profile export (Refract JSON or Shikari CSV) down to the rows whose
// `email` is in a user-supplied list. The output preserves the source format so
// it re-imports cleanly: a JSON array for Refract, header + rows for Shikari.

export type ProfileFormat = 'refract' | 'shikari' | 'unknown'

/** Canonical profile shape — the superset of fields both formats carry. */
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
  /** Matched profiles as canonical records, file order — drives format conversion. */
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

/** Lowercased lookup set + first-seen original-casing list, deduped. */
function parseEmailList(text: string): { set: Set<string>; ordered: string[] } {
  const set = new Set<string>()
  const ordered: string[] = []
  for (const token of stripBom(text).split(/[\s,;]+/)) {
    const t = token.trim()
    if (!t) continue
    const low = t.toLowerCase()
    if (set.has(low)) continue
    set.add(low)
    ordered.push(t)
  }
  return { set, ordered }
}

function computeMisses(requested: string[], fileEmailsLower: Set<string>): string[] {
  return requested.filter((e) => !fileEmailsLower.has(e.toLowerCase()))
}

export function detectProfileFormat(text: string): ProfileFormat {
  const t = stripBom(text).replace(/^\s+/, '')
  if (!t) return 'unknown'
  const c = t[0]
  return c === '[' || c === '{' ? 'refract' : 'shikari'
}

export function filterProfiles(emailsText: string, profileText: string): FilterResult {
  const { set: allowed, ordered: requested } = parseEmailList(emailsText)
  const format = detectProfileFormat(profileText)
  if (format === 'unknown') {
    return emptyResult('unknown', 'Paste or load a Refract JSON or Shikari CSV export.', requested)
  }
  return format === 'refract'
    ? filterRefract(profileText, allowed, requested)
    : filterShikari(profileText, allowed, requested)
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

function filterRefract(text: string, allowed: Set<string>, requested: string[]): FilterResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(text))
  } catch (e) {
    return emptyResult('refract', `Invalid JSON: ${(e as Error).message}`, requested)
  }
  const list = extractArray(parsed)
  if (!list) {
    return emptyResult('refract', 'Expected a JSON array of profiles.', requested)
  }

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
    if (allowed.has(low)) {
      kept.push(el)
      matched.push(refractToProfile(el, email))
      if (!seenMatched.has(low)) {
        seenMatched.add(low)
        matchedEmails.push(email)
      }
    }
  }

  return {
    format: 'refract',
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
    if (allowed.has(low)) {
      keptRows.push(raw)
      matched.push(shikariToProfile(cells, colIndex, email))
      if (!seenMatched.has(low)) {
        seenMatched.add(low)
        matchedEmails.push(email)
      }
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
