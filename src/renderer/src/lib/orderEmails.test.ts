import { describe, it, expect } from 'vitest'
import { domainOf, detectProviders, orderEmailsByProviders } from './orderEmails'

describe('domainOf', () => {
  it('returns the lowercased domain of a valid email', () => {
    expect(domainOf('user@Gmail.com')).toBe('gmail.com')
    expect(domainOf('  a.b+tag@icloud.com  ')).toBe('icloud.com')
  })
  it('returns null for invalid lines', () => {
    expect(domainOf('')).toBeNull()
    expect(domainOf('not-an-email')).toBeNull()
    expect(domainOf('a@b@c.com')).toBeNull()
    expect(domainOf('a@bcom')).toBeNull()
    expect(domainOf('a b@c.com')).toBeNull()
    expect(domainOf('@c.com')).toBeNull()
  })
})

describe('detectProviders', () => {
  const text = [
    'a@gmail.com',
    'b@gmail.com',
    'c@yahoo.com',
    'd@icloud.com',
    'e@icloud.com',
    'f@icloud.com',
    'junk',
    ''
  ].join('\n')
  it('counts domains and sorts by count desc then domain asc', () => {
    expect(detectProviders(text)).toEqual([
      { domain: 'icloud.com', count: 3 },
      { domain: 'gmail.com', count: 2 },
      { domain: 'yahoo.com', count: 1 }
    ])
  })
})

describe('orderEmailsByProviders', () => {
  const text = [
    'z@yahoo.com',
    'a@gmail.com',
    'b@icloud.com',
    'c@gmail.com',
    'd@proton.me',
    'bad-line',
    '',
    'e@yahoo.com'
  ].join('\n')

  it('groups by the given order, preserving input order within groups, Other last', () => {
    const { lines } = orderEmailsByProviders(text, ['gmail.com', 'yahoo.com'])
    expect(lines).toEqual([
      'a@gmail.com',
      'c@gmail.com',
      'z@yahoo.com',
      'e@yahoo.com',
      'b@icloud.com',
      'd@proton.me'
    ])
  })

  it('captures invalid lines and ignores blank lines', () => {
    const { invalid } = orderEmailsByProviders(text, ['gmail.com'])
    expect(invalid).toEqual(['bad-line'])
  })

  it('is case-insensitive on domain and preserves original casing', () => {
    const { lines } = orderEmailsByProviders('A@GMAIL.com\nb@gmail.COM', ['gmail.com'])
    expect(lines).toEqual(['A@GMAIL.com', 'b@gmail.COM'])
  })

  it('puts everything in Other when order is empty', () => {
    const { lines } = orderEmailsByProviders('a@gmail.com\nb@yahoo.com', [])
    expect(lines).toEqual(['a@gmail.com', 'b@yahoo.com'])
  })
})
