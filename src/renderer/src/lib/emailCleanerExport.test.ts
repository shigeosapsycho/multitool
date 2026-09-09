import { describe, expect, it } from 'vitest'
import { buildEmailExport } from './emailCleanerExport'
import { groupBySender } from '../pages/EmailCleanerGroups'
import type { EmailHeader } from './api'

const D1 = Date.UTC(2026, 7, 1, 12) // 2026-08-01
const D2 = Date.UTC(2026, 7, 3, 12) // 2026-08-03
const D3 = Date.UTC(2026, 7, 5, 12) // 2026-08-05

const emails: EmailHeader[] = [
  { uid: 1, fromName: 'Best Buy', fromAddr: 'noreply@bestbuy.com', subject: 'Order shipped', dateMs: D1, sizeBytes: 12_600, toAddr: 'shop1@catchall.com' },
  { uid: 2, fromName: 'Best Buy', fromAddr: 'noreply@bestbuy.com', subject: 'Order delivered', dateMs: D2, sizeBytes: 500, toAddr: 'shop1@catchall.com' },
  { uid: 3, fromName: 'Best Buy', fromAddr: 'noreply@bestbuy.com', subject: 'Rate your purchase', dateMs: D3, sizeBytes: 2_048, toAddr: 'shop2@catchall.com' },
  { uid: 4, fromName: '', fromAddr: 'alerts@bank.com', subject: 'Statement ready', dateMs: D1, sizeBytes: 1_024, toAddr: 'bank@catchall.com' },
  { uid: 5, fromName: 'Newsletter', fromAddr: 'news@site.com', subject: '', dateMs: D2, sizeBytes: 3_000, toAddr: '' }
]

const groups = groupBySender(emails)

describe('buildEmailExport', () => {
  it('lists only selected emails under their sender, in group order', () => {
    const out = buildEmailExport(groups, new Set([1, 3, 4]))
    expect(out.text).toBe(
      [
        'Best Buy <noreply@bestbuy.com> (2 emails)',
        '  2026-08-01  Order shipped  [12.3 KB]  to: shop1@catchall.com',
        '  2026-08-05  Rate your purchase  [2.0 KB]  to: shop2@catchall.com',
        '',
        'alerts@bank.com (1 email)',
        '  2026-08-01  Statement ready  [1.0 KB]  to: bank@catchall.com',
        ''
      ].join('\n')
    )
    expect(out.emails).toBe(3)
    expect(out.senders).toBe(2)
  })

  it('skips senders with nothing selected', () => {
    const out = buildEmailExport(groups, new Set([5]))
    expect(out.text).not.toContain('Best Buy')
    expect(out.text).toContain('Newsletter <news@site.com> (1 email)')
    expect(out.senders).toBe(1)
  })

  it('labels an empty subject and omits the recipient when unknown', () => {
    const out = buildEmailExport(groups, new Set([5]))
    expect(out.text).toContain('  2026-08-03  (no subject)  [2.9 KB]\n')
    expect(out.text).not.toContain('to:')
  })

  it('shows the address count when a sender spans several addresses', () => {
    const relay = groupBySender([
      { uid: 7, fromName: 'Shop', fromAddr: 'a@relay.com', subject: 'x', dateMs: D1, sizeBytes: 10, toAddr: 'r1@catchall.com' },
      { uid: 8, fromName: 'Shop', fromAddr: 'b@relay.com', subject: 'y', dateMs: D1, sizeBytes: 10, toAddr: '' }
    ])
    const out = buildEmailExport(relay, new Set([7, 8]))
    expect(out.text.split('\n')[0]).toBe('Shop (2 addresses) (2 emails)')
    expect(out.text).toContain('  2026-08-01  x  [10 B]  <a@relay.com>  to: r1@catchall.com')
    expect(out.text).toContain('  2026-08-01  y  [10 B]  <b@relay.com>')
  })

  it('returns empty output when nothing is selected', () => {
    const out = buildEmailExport(groups, new Set())
    expect(out).toEqual({ text: '', emails: 0, senders: 0 })
  })
})
