import { describe, it, expect } from 'vitest'
import { replaceProfileEmails } from './profileEmailReplace'
import { parseCsvRow } from './transforms'

const REFRACT = JSON.stringify([
  { name: 'A', email: 'Alice@Example.com', id: 'prf-1', payment: { num: '1' } },
  { name: 'B', email: 'bob@example.com', id: 'prf-2' },
  { name: 'C', email: 'carol@example.com', id: 'prf-3' }
])

const STELLAR = JSON.stringify([
  {
    profileName: 'S1',
    email: 'one@old.com',
    billingAsShipping: true,
    payment: { cardNumber: '4111', cardYear: '28' }
  },
  {
    profileName: 'S2',
    email: 'two@old.com',
    billingAsShipping: false,
    payment: { cardNumber: '5111', cardYear: '29' }
  }
])

const SHIKARI = [
  'profile_name,first_name,last_name,email,phone_num',
  'P1,A,T,Alice@Example.com,111',
  'P2,B,T,bob@example.com,222',
  'P3,C,T,carol@example.com,333'
].join('\n')

/** Emails of a JSON output, in order. */
function emailsOf(json: string): string[] {
  return (JSON.parse(json) as { email: string }[]).map((p) => p.email)
}

/** Email column of a Shikari CSV output, in row order (header skipped). */
function csvEmails(csv: string): string[] {
  const rows = csv.split('\n')
  const idx = parseCsvRow(rows[0]!).indexOf('email')
  return rows.slice(1).map((r) => parseCsvRow(r)[idx]!)
}

describe('replaceProfileEmails, pairing the two lists', () => {
  it('maps find[i] to replace[i] and swaps those profiles in refract', () => {
    const r = replaceProfileEmails(
      'alice@example.com\ncarol@example.com',
      'new1@x.com\nnew2@x.com',
      REFRACT
    )
    expect(r.error).toBeNull()
    expect(r.format).toBe('refract')
    expect(emailsOf(r.fullOutput)).toEqual(['new1@x.com', 'bob@example.com', 'new2@x.com'])
    expect(r.replacedCount).toBe(2)
    expect(r.totalCount).toBe(3)
  })

  it('swaps in stellar', () => {
    const r = replaceProfileEmails('two@old.com', 'fresh@x.com', STELLAR)
    expect(r.format).toBe('stellar')
    expect(emailsOf(r.fullOutput)).toEqual(['one@old.com', 'fresh@x.com'])
    expect(r.replacedCount).toBe(1)
  })

  it('swaps in shikari', () => {
    const r = replaceProfileEmails('bob@example.com', 'new@x.com', SHIKARI)
    expect(r.format).toBe('shikari')
    expect(csvEmails(r.fullOutput)).toEqual(['Alice@Example.com', 'new@x.com', 'carol@example.com'])
    expect(r.replacedCount).toBe(1)
    expect(r.totalCount).toBe(3)
  })

  it('keeps the shikari header row', () => {
    const r = replaceProfileEmails('bob@example.com', 'new@x.com', SHIKARI)
    expect(r.fullOutput.split('\n')[0]).toBe('profile_name,first_name,last_name,email,phone_num')
  })

  it('matches the file email case-insensitively', () => {
    const r = replaceProfileEmails('ALICE@EXAMPLE.COM', 'new@x.com', REFRACT)
    expect(emailsOf(r.fullOutput)[0]).toBe('new@x.com')
    expect(r.replacedCount).toBe(1)
  })

  it('writes the replacement with the casing the user typed', () => {
    const r = replaceProfileEmails('bob@example.com', 'New.Person@X.com', REFRACT)
    expect(emailsOf(r.fullOutput)[1]).toBe('New.Person@X.com')
  })
})

describe('replaceProfileEmails, list length mismatch', () => {
  it('leaves find emails past the end of the replace list alone', () => {
    const r = replaceProfileEmails(
      'alice@example.com\nbob@example.com\ncarol@example.com',
      'new1@x.com',
      REFRACT
    )
    expect(emailsOf(r.fullOutput)).toEqual(['new1@x.com', 'bob@example.com', 'carol@example.com'])
    expect(r.replacedCount).toBe(1)
  })

  it('ignores replacement emails that had no find email to pair with', () => {
    const r = replaceProfileEmails('bob@example.com', 'n1@x.com\nn2@x.com\nn3@x.com', REFRACT)
    expect(emailsOf(r.fullOutput)).toEqual(['Alice@Example.com', 'n1@x.com', 'carol@example.com'])
    expect(r.replacedCount).toBe(1)
  })

  it('passes the file through untouched when a paired find email matches no profile', () => {
    const r = replaceProfileEmails(
      'ghost@nowhere.com\nbob@example.com',
      'n1@x.com\nn2@x.com',
      REFRACT
    )
    expect(emailsOf(r.fullOutput)).toEqual(['Alice@Example.com', 'n2@x.com', 'carol@example.com'])
    expect(r.replacedCount).toBe(1)
  })
})

describe('replaceProfileEmails, everything else survives', () => {
  it('leaves every other refract key untouched on a swapped profile', () => {
    const r = replaceProfileEmails('alice@example.com', 'new1@x.com', REFRACT)
    const out = JSON.parse(r.fullOutput) as Record<string, unknown>[]
    expect(out[0]).toEqual({ name: 'A', email: 'new1@x.com', id: 'prf-1', payment: { num: '1' } })
  })

  it('passes an unmatched refract profile through unchanged', () => {
    const r = replaceProfileEmails('alice@example.com', 'new1@x.com', REFRACT)
    const out = JSON.parse(r.fullOutput) as Record<string, unknown>[]
    expect(out[1]).toEqual({ name: 'B', email: 'bob@example.com', id: 'prf-2' })
  })

  it('leaves every other stellar key untouched on a swapped profile', () => {
    const r = replaceProfileEmails('two@old.com', 'fresh@x.com', STELLAR)
    const out = JSON.parse(r.fullOutput) as Record<string, unknown>[]
    expect(out[1]).toEqual({
      profileName: 'S2',
      email: 'fresh@x.com',
      billingAsShipping: false,
      payment: { cardNumber: '5111', cardYear: '29' }
    })
  })

  it('leaves the profile name alone even when it was the old email', () => {
    const src = JSON.stringify([{ name: 'old@x.com', email: 'old@x.com' }])
    const r = replaceProfileEmails('old@x.com', 'fresh@x.com', src)
    const out = JSON.parse(r.fullOutput) as { name: string; email: string }[]
    expect(out[0]).toEqual({ name: 'old@x.com', email: 'fresh@x.com' })
  })

  it('leaves every other shikari column untouched on a swapped row', () => {
    const r = replaceProfileEmails('bob@example.com', 'new@x.com', SHIKARI)
    expect(r.fullOutput.split('\n')[2]).toBe('P2,B,T,new@x.com,222')
  })

  it('replays an unmatched shikari row verbatim', () => {
    const src = ['profile_name,email,shipping_street', 'P1,old@x.com,"1 Main St, Apt 2"'].join('\n')
    const r = replaceProfileEmails('nobody@x.com', 'new@x.com', src)
    expect(r.fullOutput.split('\n')[1]).toBe('P1,old@x.com,"1 Main St, Apt 2"')
  })

  it('re-escapes a swapped shikari row that carries a quoted comma', () => {
    const src = ['profile_name,email,shipping_street', 'P1,old@x.com,"1 Main St, Apt 2"'].join('\n')
    const r = replaceProfileEmails('old@x.com', 'new@x.com', src)
    expect(r.fullOutput.split('\n')[1]).toBe('P1,new@x.com,"1 Main St, Apt 2"')
  })

  it('keeps a profile that has no email at all', () => {
    const src = JSON.stringify([{ name: 'A' }, { name: 'B', email: 'old@x.com' }])
    const r = replaceProfileEmails('old@x.com', 'new@x.com', src)
    const out = JSON.parse(r.fullOutput) as Record<string, unknown>[]
    expect(out).toEqual([{ name: 'A' }, { name: 'B', email: 'new@x.com' }])
  })

  it('keeps a blank shikari line out of the output but every data row in it', () => {
    const src = ['profile_name,email', 'P1,old@x.com', '', 'P2,keep@x.com'].join('\n')
    const r = replaceProfileEmails('old@x.com', 'new@x.com', src)
    expect(r.fullOutput.split('\n')).toEqual(['profile_name,email', 'P1,new@x.com', 'P2,keep@x.com'])
    expect(r.totalCount).toBe(2)
  })
})

describe('replaceProfileEmails, dropUnmatched', () => {
  it('keeps only the swapped profiles in refract', () => {
    const r = replaceProfileEmails('carol@example.com', 'new@x.com', REFRACT, {
      dropUnmatched: true
    })
    expect(emailsOf(r.fullOutput)).toEqual(['new@x.com'])
    expect(r.replacedCount).toBe(1)
    expect(r.totalCount).toBe(3)
  })

  it('keeps only the swapped rows in shikari, header included', () => {
    const r = replaceProfileEmails('bob@example.com', 'new@x.com', SHIKARI, { dropUnmatched: true })
    expect(r.fullOutput.split('\n')).toEqual([
      'profile_name,first_name,last_name,email,phone_num',
      'P2,B,T,new@x.com,222'
    ])
  })

  it('drops a profile that has no email at all', () => {
    const src = JSON.stringify([{ name: 'A' }, { name: 'B', email: 'old@x.com' }])
    const r = replaceProfileEmails('old@x.com', 'new@x.com', src, { dropUnmatched: true })
    const out = JSON.parse(r.fullOutput) as Record<string, unknown>[]
    expect(out).toEqual([{ name: 'B', email: 'new@x.com' }])
  })

  it('keeps the untouched profiles by default', () => {
    const r = replaceProfileEmails('carol@example.com', 'new@x.com', REFRACT)
    expect(emailsOf(r.fullOutput)).toEqual(['Alice@Example.com', 'bob@example.com', 'new@x.com'])
  })

  it('counts the whole file as output when untouched profiles are kept', () => {
    const r = replaceProfileEmails('carol@example.com', 'new@x.com', REFRACT)
    expect(r.outputCount).toBe(3)
  })

  it('counts only the swapped profiles as output when they are dropped', () => {
    const r = replaceProfileEmails('carol@example.com', 'new@x.com', REFRACT, {
      dropUnmatched: true
    })
    expect(r.outputCount).toBe(1)
  })

  it('counts shikari output rows in both modes', () => {
    expect(replaceProfileEmails('bob@example.com', 'new@x.com', SHIKARI).outputCount).toBe(3)
    expect(
      replaceProfileEmails('bob@example.com', 'new@x.com', SHIKARI, { dropUnmatched: true })
        .outputCount
    ).toBe(1)
  })
})

describe('replaceProfileEmails, repeated emails', () => {
  it('swaps every profile sharing a find email', () => {
    const src = JSON.stringify([
      { name: 'A', email: 'dup@x.com' },
      { name: 'B', email: 'DUP@x.com' }
    ])
    const r = replaceProfileEmails('dup@x.com', 'new@x.com', src)
    expect(emailsOf(r.fullOutput)).toEqual(['new@x.com', 'new@x.com'])
    expect(r.replacedCount).toBe(2)
  })

  it('dedupes the find list, first occurrence wins the pairing', () => {
    const r = replaceProfileEmails(
      'alice@example.com\nALICE@example.com\nbob@example.com',
      'n1@x.com\nn2@x.com',
      REFRACT
    )
    expect(emailsOf(r.fullOutput)).toEqual(['n1@x.com', 'n2@x.com', 'carol@example.com'])
  })

  it('dedupes the replace list so two find emails never share a replacement', () => {
    const r = replaceProfileEmails(
      'alice@example.com\nbob@example.com',
      'same@x.com\nSAME@x.com',
      REFRACT
    )
    expect(emailsOf(r.fullOutput)).toEqual(['same@x.com', 'bob@example.com', 'carol@example.com'])
  })
})

describe('replaceProfileEmails, email list parsing', () => {
  it('pulls the address out of email:password lines in both lists', () => {
    const r = replaceProfileEmails('bob@example.com:hunter2', 'new@x.com:pw', REFRACT)
    expect(emailsOf(r.fullOutput)[1]).toBe('new@x.com')
  })

  it('ignores list lines that carry no address', () => {
    const r = replaceProfileEmails('# a comment\n\nbob@example.com', 'new@x.com', REFRACT)
    expect(emailsOf(r.fullOutput)[1]).toBe('new@x.com')
  })
})

describe('replaceProfileEmails, errors', () => {
  it('reports an empty find list', () => {
    const r = replaceProfileEmails('', 'new@x.com', REFRACT)
    expect(r.error).toBe('Paste the emails you want to replace.')
    expect(r.fullOutput).toBe('')
  })

  it('reports an empty replace list', () => {
    const r = replaceProfileEmails('old@x.com', '', REFRACT)
    expect(r.error).toBe('Paste the emails to replace them with.')
    expect(r.fullOutput).toBe('')
  })

  it('reports invalid JSON', () => {
    const r = replaceProfileEmails('old@x.com', 'new@x.com', '[{"email": ')
    expect(r.error).toMatch(/^Invalid JSON: /)
    expect(r.fullOutput).toBe('')
  })

  it('reports a JSON payload that is not an array of profiles', () => {
    const r = replaceProfileEmails('old@x.com', 'new@x.com', '{"nope": 1}')
    expect(r.error).toBe('Expected a JSON array of profiles.')
  })

  it('reports a CSV with no email column', () => {
    const r = replaceProfileEmails('old@x.com', 'new@x.com', 'profile_name,phone_num\nP1,111')
    expect(r.error).toBe('No email column found in the CSV header.')
  })

  it('reports an unrecognizable profile file', () => {
    const r = replaceProfileEmails('old@x.com', 'new@x.com', '   ')
    expect(r.format).toBe('unknown')
    expect(r.error).toBe('Paste or load a Refract JSON, Stellar JSON, or Shikari CSV export.')
  })
})
