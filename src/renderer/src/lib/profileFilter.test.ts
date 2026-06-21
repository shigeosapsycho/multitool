import { describe, it, expect } from 'vitest'
import { detectProfileFormat, filterProfiles, serializeRefract, serializeShikari } from './profileFilter'
import { parseCsvRow } from './transforms'

const SHIKARI_HEADER =
  'profile_name,first_name,last_name,email,phone_num,cc_number,cc_exp_month,cc_exp_year,cc_cvv,' +
  'shipping_street,shipping_street_2,shipping_city,shipping_state,shipping_zip_code,shipping_country,' +
  'billing_first_name,billing_last_name,billing_street,billing_street_2,billing_city,billing_state,' +
  'billing_zip_code,billing_country'

const FULL_REFRACT = JSON.stringify([
  {
    name: 'P1',
    email: 't@x.com',
    oneTimeUse: false,
    shipping: {
      firstName: 'Jane',
      lastName: 'Doe',
      address1: '1 Main St',
      address2: 'Apt 2',
      city: 'Reno',
      province: 'NV',
      postalCode: '89501',
      country: 'US',
      phone: '5551234'
    },
    billing: { sameAsShipping: true, firstName: '', lastName: '', address1: '', address2: '', city: '', postalCode: '', phone: '' },
    payment: { name: 'Jane Doe', num: '4111111111111111', year: '2030', month: '08', cvv: '123' },
    id: 'prf-x',
    createdAt: 1,
    updatedAt: 2
  }
])

const FULL_SHIKARI = [
  SHIKARI_HEADER,
  'Profile 1,Alice,Smith,alice@example.com,5559999,4222222222222,11,2029,456,2 Oak Ave,,Austin,TX,73301,US,Alice,Smith,2 Oak Ave,,Austin,TX,73301,US'
].join('\n')

const REFRACT = JSON.stringify([
  { name: 'A', email: 'Alice@Example.com', payment: { num: '1' } },
  { name: 'B', email: 'bob@example.com' },
  { name: 'C', email: 'carol@example.com' }
])

const SHIKARI = [
  'profile_name,first_name,last_name,email,phone_num',
  'P1,A,T,Alice@Example.com,111',
  'P2,B,T,bob@example.com,222',
  'P3,C,T,carol@example.com,333'
].join('\n')

describe('detectProfileFormat', () => {
  it('detects a JSON array as refract', () => {
    expect(detectProfileFormat('[{"a":1}]')).toBe('refract')
  })
  it('detects a JSON object as refract', () => {
    expect(detectProfileFormat('{"profiles":[]}')).toBe('refract')
  })
  it('ignores leading whitespace and a BOM', () => {
    expect(detectProfileFormat('  \n [')).toBe('refract')
    expect(detectProfileFormat('﻿[')).toBe('refract')
  })
  it('detects a CSV header row as shikari', () => {
    expect(detectProfileFormat('profile_name,email\nx,y@z.com')).toBe('shikari')
  })
  it('returns unknown for empty or whitespace-only input', () => {
    expect(detectProfileFormat('')).toBe('unknown')
    expect(detectProfileFormat('   \n  ')).toBe('unknown')
  })
})

describe('filterProfiles — refract JSON', () => {
  it('keeps only profiles whose email is in the list, in file order', () => {
    const r = filterProfiles('alice@example.com\nbob@example.com', REFRACT)
    expect(r.format).toBe('refract')
    expect(r.matchedCount).toBe(2)
    expect(r.totalCount).toBe(3)
    expect(JSON.parse(r.fullOutput)).toEqual([
      { name: 'A', email: 'Alice@Example.com', payment: { num: '1' } },
      { name: 'B', email: 'bob@example.com' }
    ])
    expect(r.error).toBeNull()
  })

  it('matches emails case-insensitively but preserves the file casing in matchedEmails', () => {
    const r = filterProfiles('ALICE@EXAMPLE.COM', REFRACT)
    expect(r.matchedCount).toBe(1)
    expect(r.matchedEmails).toEqual(['Alice@Example.com'])
  })

  it('reports requested emails with no profile as misses (original casing)', () => {
    const r = filterProfiles('alice@example.com\nDave@example.com', REFRACT)
    expect(r.misses).toEqual(['Dave@example.com'])
    expect(r.emailsRequested).toBe(2)
  })

  it('accepts a wrapper object with a profiles array', () => {
    const wrapped = JSON.stringify({ profiles: JSON.parse(REFRACT) })
    const r = filterProfiles('bob@example.com', wrapped)
    expect(r.format).toBe('refract')
    expect(r.matchedCount).toBe(1)
    expect(JSON.parse(r.fullOutput)).toEqual([{ name: 'B', email: 'bob@example.com' }])
  })

  it('keeps every matching profile but dedupes matchedEmails', () => {
    const dupes = JSON.stringify([
      { name: 'A1', email: 'alice@example.com' },
      { name: 'A2', email: 'alice@example.com' }
    ])
    const r = filterProfiles('alice@example.com', dupes)
    expect(r.matchedCount).toBe(2)
    expect(r.matchedEmails).toEqual(['alice@example.com'])
  })

  it('treats a profile with no email as a non-match but still counts it in the total', () => {
    const r = filterProfiles('bob@example.com', JSON.stringify([{ name: 'X' }, { name: 'B', email: 'bob@example.com' }]))
    expect(r.totalCount).toBe(2)
    expect(r.matchedCount).toBe(1)
  })

  it('returns an error for malformed JSON', () => {
    const r = filterProfiles('alice@example.com', '[{bad json')
    expect(r.format).toBe('refract')
    expect(r.error).toBeTruthy()
    expect(r.matchedCount).toBe(0)
    expect(r.fullOutput).toBe('')
  })
})

describe('filterProfiles — shikari CSV', () => {
  it('keeps the header plus matching rows verbatim, in file order', () => {
    const r = filterProfiles('alice@example.com bob@example.com', SHIKARI)
    expect(r.format).toBe('shikari')
    expect(r.matchedCount).toBe(2)
    expect(r.totalCount).toBe(3)
    expect(r.fullOutput).toBe(
      [
        'profile_name,first_name,last_name,email,phone_num',
        'P1,A,T,Alice@Example.com,111',
        'P2,B,T,bob@example.com,222'
      ].join('\n')
    )
  })

  it('reports matched emails and misses', () => {
    const r = filterProfiles('alice@example.com, dave@example.com', SHIKARI)
    expect(r.matchedEmails).toEqual(['Alice@Example.com'])
    expect(r.misses).toEqual(['dave@example.com'])
  })

  it('normalizes CRLF line endings to LF in the output', () => {
    const crlf = SHIKARI.replace(/\n/g, '\r\n')
    const r = filterProfiles('bob@example.com', crlf)
    expect(r.fullOutput).not.toContain('\r')
    expect(r.matchedCount).toBe(1)
  })

  it('returns an error when no email column is present', () => {
    const r = filterProfiles('alice@example.com', 'name,phone\nP1,111')
    expect(r.format).toBe('shikari')
    expect(r.error).toBeTruthy()
    expect(r.matchedCount).toBe(0)
  })
})

describe('filterProfiles — email list parsing', () => {
  it('splits on commas, semicolons, and whitespace, deduping case-insensitively', () => {
    const r = filterProfiles('Alice@example.com; alice@example.com\n  BOB@example.com , dave@example.com', REFRACT)
    expect(r.emailsRequested).toBe(3)
    expect(r.matchedCount).toBe(2)
    expect(r.misses).toEqual(['dave@example.com'])
  })

  it('returns unknown format and an error when the profile input is empty', () => {
    const r = filterProfiles('alice@example.com', '   ')
    expect(r.format).toBe('unknown')
    expect(r.error).toBeTruthy()
    expect(r.matchedCount).toBe(0)
  })

  it('matches when the list is in email:password format, keeping those profiles', () => {
    const r = filterProfiles('alice@example.com:hunter2\nbob@example.com:pw', REFRACT)
    expect(r.matchedCount).toBe(2)
    expect(r.misses).toEqual([])
    expect(r.matchedEmails).toEqual(['Alice@Example.com', 'bob@example.com'])
  })

  it('extracts the address from "Name <email>" list lines', () => {
    const r = filterProfiles('Alice <alice@example.com>', REFRACT)
    expect(r.matchedCount).toBe(1)
    expect(r.misses).toEqual([])
  })
})

describe('cross-format conversion', () => {
  it('exposes matched profiles as canonical records', () => {
    const r = filterProfiles('t@x.com', FULL_REFRACT)
    expect(r.matched).toHaveLength(1)
    expect(r.matched[0]!.email).toBe('t@x.com')
    expect(r.matched[0]!.shipStreet).toBe('1 Main St')
  })

  it('converts refract-sourced matches to a Shikari CSV with mapped columns', () => {
    const r = filterProfiles('t@x.com', FULL_REFRACT)
    const rows = serializeShikari(r.matched).split('\n')
    expect(rows[0]).toBe(SHIKARI_HEADER)
    const c = parseCsvRow(rows[1]!)
    expect(c[0]).toBe('P1') // profile_name <- name
    expect(c[1]).toBe('Jane') // first_name <- shipping.firstName
    expect(c[3]).toBe('t@x.com') // email
    expect(c[4]).toBe('5551234') // phone_num <- shipping.phone
    expect(c[5]).toBe('4111111111111111') // cc_number <- payment.num
    expect(c[9]).toBe('1 Main St') // shipping_street <- shipping.address1
    expect(c[12]).toBe('NV') // shipping_state <- shipping.province
    expect(c[15]).toBe('Jane') // billing_first_name (sameAsShipping copies shipping)
    expect(c[17]).toBe('1 Main St') // billing_street
  })

  it('converts shikari-sourced matches to Refract JSON with the nested shape', () => {
    const r = filterProfiles('alice@example.com', FULL_SHIKARI)
    const out = JSON.parse(serializeRefract(r.matched))
    expect(out).toHaveLength(1)
    expect(out[0].email).toBe('alice@example.com')
    expect(out[0].shipping.address1).toBe('2 Oak Ave')
    expect(out[0].shipping.province).toBe('TX')
    expect(out[0].shipping.phone).toBe('5559999')
    expect(out[0].payment.num).toBe('4222222222222')
    expect(out[0].payment.month).toBe('11')
    expect(out[0].billing.firstName).toBe('Alice')
  })

  it('quotes CSV fields that contain commas when serializing to Shikari', () => {
    const r = filterProfiles('t@x.com', FULL_REFRACT.replace('1 Main St', '1 Main St, Suite 5'))
    const c = parseCsvRow(serializeShikari(r.matched).split('\n')[1]!)
    expect(c[9]).toBe('1 Main St, Suite 5')
  })

  it('round-trips refract -> shikari -> refract preserving core fields', () => {
    const a = filterProfiles('t@x.com', FULL_REFRACT)
    const csv = SHIKARI_HEADER // header kept; build a shikari doc from the conversion
    const shikariDoc = serializeShikari(a.matched)
    expect(shikariDoc.startsWith(csv)).toBe(true)
    const b = filterProfiles('t@x.com', shikariDoc)
    const out = JSON.parse(serializeRefract(b.matched))
    expect(out[0].email).toBe('t@x.com')
    expect(out[0].shipping.address1).toBe('1 Main St')
    expect(out[0].payment.num).toBe('4111111111111111')
  })
})
