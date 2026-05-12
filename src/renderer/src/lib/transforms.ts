import { extractContent } from './parse'
import { findDuplicates, findNonDuplicates } from './dedupe'

export function duplicatesFromText(text: string): string[] {
  return findDuplicates(extractContent(text))
}

export function nonDuplicatesFromText(text: string): string[] {
  return findNonDuplicates(extractContent(text))
}

export function duplicatesFromTwoTexts(t1: string, t2: string): string[] {
  return findDuplicates([...extractContent(t1), ...extractContent(t2)])
}

export function nonDuplicatesFromTwoTexts(t1: string, t2: string): string[] {
  return findNonDuplicates([...extractContent(t1), ...extractContent(t2)])
}

export function stripPasswordsFromText(text: string): string[] {
  const items = extractContent(text)
  const out: string[] = []
  for (const item of items) {
    const colon = item.indexOf(':')
    out.push(colon === -1 ? item : item.slice(0, colon))
  }
  return out
}

// Items from `searchText` that also exist in `masterText`, deduplicated.
// Order matches first appearance in the search list (not master).
export function searchInMaster(masterText: string, searchText: string): string[] {
  const master = new Set(extractContent(masterText))
  const search = extractContent(searchText)
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of search) {
    if (master.has(item) && !seen.has(item)) {
      out.push(item)
      seen.add(item)
    }
  }
  return out
}

// Remove emails from `masterText` that also appear in `successText`
// (which is `email:password` format — we take just the email portion).
// Case-insensitive comparison; preserves the master list's original casing.
export function filterEmailsBySuccess(successText: string, masterText: string): string[] {
  const successEmails = new Set<string>()
  for (const line of successText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const email = trimmed.split(':')[0]!.toLowerCase()
    if (email) successEmails.add(email)
  }
  const out: string[] = []
  for (const line of masterText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (!successEmails.has(trimmed.toLowerCase())) out.push(trimmed)
  }
  return out
}

// Parse one CSV row into fields, honoring RFC 4180-style double-quoted fields
// where "" inside a quoted field is a literal quote. Trailing \r is stripped.
function parseCsvRow(row: string): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]!
    if (inQuotes) {
      if (c === '"') {
        if (row[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else {
      if (c === ',') {
        out.push(field)
        field = ''
      } else if (c === '"' && field.length === 0) {
        inQuotes = true
      } else if (c === '\r') {
        // skip
      } else {
        field += c
      }
    }
  }
  out.push(field)
  return out
}

export type CsvEmailPassResult = {
  lines: string[]
  emailHeader: string | null
  passwordHeader: string | null
}

// Pull `email:password` pairs out of a CSV. Header match is case-insensitive
// and accepts common variants (e.g. "e-mail", "pass", "pwd"). Rows missing
// either value are skipped.
export function csvToEmailPass(text: string): CsvEmailPassResult {
  const rows = text.split(/\n/).filter((r) => r.length > 0 || r === '')
  // Find first non-empty row as header.
  let headerIdx = -1
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.trim().length > 0) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) return { lines: [], emailHeader: null, passwordHeader: null }

  const header = parseCsvRow(rows[headerIdx]!).map((h) => h.trim())
  const norm = header.map((h) => h.toLowerCase().replace(/[\s_-]+/g, ''))
  const emailNames = new Set(['email', 'emailaddress', 'mail', 'username', 'user', 'login'])
  const passwordNames = new Set(['password', 'pass', 'pwd', 'passcode'])

  const emailIdx = norm.findIndex((h) => emailNames.has(h))
  const passwordIdx = norm.findIndex((h) => passwordNames.has(h))
  if (emailIdx === -1 || passwordIdx === -1) {
    return { lines: [], emailHeader: null, passwordHeader: null }
  }

  const out: string[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]!
    if (!row.trim()) continue
    const cells = parseCsvRow(row)
    const email = (cells[emailIdx] ?? '').trim()
    const password = (cells[passwordIdx] ?? '').trim()
    if (!email || !password) continue
    out.push(`${email}:${password}`)
  }
  return { lines: out, emailHeader: header[emailIdx]!, passwordHeader: header[passwordIdx]! }
}

export function shuffleLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
  // Fisher-Yates
  for (let i = lines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[lines[i], lines[j]] = [lines[j]!, lines[i]!]
  }
  return lines
}
