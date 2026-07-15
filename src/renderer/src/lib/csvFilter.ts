// CSV Filter: parse a whole CSV (first row = headers), then rebuild it with
// only the chosen columns, in a chosen order, joined by a chosen separator.

export type ParsedCsv = {
  headers: string[]
  rows: string[][]
}

/**
 * Parse a full CSV document, honoring RFC 4180-style double-quoted fields:
 * "" inside a quoted field is a literal quote, and quoted fields may contain
 * commas and newlines. Same lenient quote handling as `parseCsvRow` (a quote
 * only opens a field when it is the first character). CRLF and LF both end
 * rows; rows whose every field is empty (blank lines) are dropped.
 *
 * The first row becomes `headers`; everything after is `rows`.
 */
export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"' && field.length === 0) {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else if (c === '\r') {
      // CRLF row ends are handled by the \n; a bare \r is skipped.
    } else {
      field += c
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''))
  const [headers, ...rest] = nonEmpty
  return { headers: headers ?? [], rows: rest }
}

/** Display label for a header cell; blank headers fall back to their position. */
export function csvColumnLabel(header: string, index: number): string {
  const trimmed = header.trim()
  return trimmed || `Column ${index + 1}`
}

/**
 * Quote `value` if it contains the output separator, a quote, or a newline,
 * doubling any embedded quotes — so the output stays parseable whatever
 * separator the user picked.
 */
export function escapeCsvField(value: string, separator: string): string {
  const needsQuotes =
    (separator !== '' && value.includes(separator)) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * Rebuild the CSV keeping only the columns in `order` (indices into the
 * original header row), in that order, joined by `separator`. The header
 * row is included as the first line; cells missing from short rows become
 * empty fields. An empty `order` produces no output.
 */
export function buildFilteredCsv(
  parsed: ParsedCsv,
  order: readonly number[],
  separator: string
): string[] {
  if (order.length === 0 || parsed.headers.length === 0) return []
  const lines: string[] = []
  for (const cells of [parsed.headers, ...parsed.rows]) {
    lines.push(order.map((i) => escapeCsvField(cells[i] ?? '', separator)).join(separator))
  }
  return lines
}
