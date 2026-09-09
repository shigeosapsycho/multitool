import type { SenderGroup } from '../pages/EmailCleanerGroups'
import { formatSize } from '../pages/EmailCleanerGroups'

export type EmailExport = {
  /** Plain-text report, empty when nothing is selected. */
  text: string
  /** Number of emails written. */
  emails: number
  /** Number of sender groups written. */
  senders: number
}

/** Calendar date in UTC as YYYY-MM-DD, or "-" when the header had no date. */
function isoDate(ms: number): string {
  if (!ms) return '-'
  return new Date(ms).toISOString().slice(0, 10)
}

function pluralEmails(n: number): string {
  return `${n} ${n === 1 ? 'email' : 'emails'}`
}

/**
 * Render the selected emails as a plain-text report grouped by sender, so a
 * user can keep a record of what they picked (and what they are about to
 * delete) with each email listed under the sender it came from.
 *
 * Only groups with at least one selected email appear, in the same order as
 * the on-screen list. Groups that span several addresses show the count in
 * the header and the address per email row, since a single header line
 * cannot name them all.
 */
export function buildEmailExport(
  groups: readonly SenderGroup[],
  selected: ReadonlySet<number>
): EmailExport {
  const lines: string[] = []
  let emails = 0
  let senders = 0
  for (const g of groups) {
    const picked = g.emails.filter((e) => selected.has(e.uid))
    if (picked.length === 0) continue
    senders++
    emails += picked.length
    const multi = g.addrCount > 1
    const who = multi
      ? `${g.name} (${g.addrCount} addresses)`
      : g.addr && g.addr !== g.name
        ? `${g.name} <${g.addr}>`
        : g.name
    lines.push(`${who} (${pluralEmails(picked.length)})`)
    for (const e of picked) {
      const subject = e.subject || '(no subject)'
      const tail = multi && e.fromAddr ? `  <${e.fromAddr}>` : ''
      lines.push(`  ${isoDate(e.dateMs)}  ${subject}  [${formatSize(e.sizeBytes)}]${tail}`)
    }
    lines.push('')
  }
  return { text: lines.join('\n'), emails, senders }
}
