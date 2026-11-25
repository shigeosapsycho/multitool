import { describe, it, expect } from 'vitest'
import {
  FIRST_NAMES,
  LAST_NAMES,
  MAX_CATCHALL_COUNT,
  WORDS,
  generateCatchallEmails,
  normalizeDomain
} from './catchallEmails'

/** Deterministic stand-in for Math.random, so a failing case can be replayed. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('bundled name and word lists', () => {
  it('hold only lowercase letters, so every local part is a valid address', () => {
    for (const list of [FIRST_NAMES, LAST_NAMES, WORDS]) {
      expect(list.length).toBeGreaterThan(100)
      expect(list.filter((entry) => !/^[a-z]+$/.test(entry))).toEqual([])
    }
  })
})

describe('normalizeDomain', () => {
  it('accepts a bare domain and lowercases it', () => {
    expect(normalizeDomain('claude.ai')).toBe('claude.ai')
    expect(normalizeDomain('  Mail.Example.CO.UK ')).toBe('mail.example.co.uk')
  })

  it('drops a leading "@" or a whole pasted address', () => {
    expect(normalizeDomain('@claude.ai')).toBe('claude.ai')
    expect(normalizeDomain('someone@claude.ai')).toBe('claude.ai')
  })

  it('rejects text that is not a domain', () => {
    for (const bad of ['', 'claude', 'claude.', '.ai', 'cla ude.ai', '-a.com', 'a-.com', 'a..com'])
      expect(normalizeDomain(bad)).toBeNull()
  })
})

describe('generateCatchallEmails', () => {
  it('returns exactly the requested amount, all unique, all on the domain', () => {
    const emails = generateCatchallEmails('claude.ai', 5000, seeded(1))
    expect(emails).toHaveLength(5000)
    expect(new Set(emails).size).toBe(5000)
    expect(emails.filter((e) => !/^[a-z0-9]+(?:[._][a-z0-9]+)*@claude\.ai$/.test(e))).toEqual([])
  })

  it('uses the normalized domain', () => {
    const emails = generateCatchallEmails(' @Claude.AI ', 3, seeded(2))
    expect(emails.every((e) => e.endsWith('@claude.ai'))).toBe(true)
  })

  it('mixes name-only, word and numbered addresses', () => {
    const locals = generateCatchallEmails('claude.ai', 500, seeded(3)).map((e) => e.split('@')[0]!)
    expect(locals.some((l) => /^[a-z]+\.[a-z]+$/.test(l))).toBe(true)
    expect(locals.some((l) => /\d$/.test(l))).toBe(true)
    expect(locals.some((l) => WORDS.some((w) => l.startsWith(w)))).toBe(true)
  })

  it('stays unique and finishes when the random source keeps repeating', () => {
    const emails = generateCatchallEmails('claude.ai', 50, () => 0)
    expect(new Set(emails).size).toBe(50)
  })

  it('returns nothing for a bad domain or an amount outside 1..max', () => {
    expect(generateCatchallEmails('not a domain', 5)).toEqual([])
    expect(generateCatchallEmails('claude.ai', 0)).toEqual([])
    expect(generateCatchallEmails('claude.ai', -3)).toEqual([])
    expect(generateCatchallEmails('claude.ai', 2.5)).toEqual([])
    expect(generateCatchallEmails('claude.ai', MAX_CATCHALL_COUNT + 1)).toEqual([])
  })
})
