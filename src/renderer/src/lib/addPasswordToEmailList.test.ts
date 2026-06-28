import { describe, it, expect } from 'vitest'
import {
  buildAlphabet,
  generatePassword,
  addPasswordToEmailList,
  UPPER,
  LOWER,
  NUMBERS,
  SYMBOLS,
  type CharSets
} from './addPasswordToEmailList'

const sets = (over: Partial<CharSets> = {}): CharSets => ({
  upper: false,
  lower: false,
  numbers: false,
  symbols: false,
  ...over
})

describe('buildAlphabet', () => {
  it('returns uppercase letters for the upper set', () => {
    expect(buildAlphabet(sets({ upper: true }))).toBe(UPPER)
  })
  it('returns lowercase letters for the lower set', () => {
    expect(buildAlphabet(sets({ lower: true }))).toBe(LOWER)
  })
  it('returns digits for the numbers set', () => {
    expect(buildAlphabet(sets({ numbers: true }))).toBe(NUMBERS)
  })
  it('returns symbols for the symbols set', () => {
    expect(buildAlphabet(sets({ symbols: true }))).toBe(SYMBOLS)
  })
  it('concatenates selected sets in upper/lower/numbers/symbols order', () => {
    expect(buildAlphabet(sets({ upper: true, lower: true, numbers: true, symbols: true }))).toBe(
      UPPER + LOWER + NUMBERS + SYMBOLS
    )
  })
  it('concatenates a partial combination in order', () => {
    expect(buildAlphabet(sets({ upper: true, numbers: true }))).toBe(UPPER + NUMBERS)
  })
  it('falls back to lowercase when no set is selected', () => {
    expect(buildAlphabet(sets())).toBe(LOWER)
  })
})

describe('generatePassword', () => {
  it('produces a string of the requested length', () => {
    expect(generatePassword(12, LOWER)).toHaveLength(12)
  })
  it('maps injected indices onto the alphabet', () => {
    const randInts = () => [0, 1, 2, 0, 1]
    expect(generatePassword(5, 'xyz', randInts)).toBe('xyzxy')
  })
  it('only emits characters from the alphabet', () => {
    const out = generatePassword(200, 'abc')
    expect([...out].every((c) => 'abc'.includes(c))).toBe(true)
  })
})

describe('addPasswordToEmailList', () => {
  it('appends the same fixed password to every email', () => {
    expect(
      addPasswordToEmailList('a@x.com\nb@y.com', { kind: 'fixed', password: 'Pw1' })
    ).toEqual(['a@x.com:Pw1', 'b@y.com:Pw1'])
  })
  it('trims whitespace and drops blank lines', () => {
    expect(
      addPasswordToEmailList('  a@x.com  \n\n b@y.com\n', { kind: 'fixed', password: 'Pw1' })
    ).toEqual(['a@x.com:Pw1', 'b@y.com:Pw1'])
  })
  it('allows an empty fixed password, yielding "email:"', () => {
    expect(addPasswordToEmailList('a@x.com', { kind: 'fixed', password: '' })).toEqual([
      'a@x.com:'
    ])
  })
  it('uses a generated password per email in random mode', () => {
    const randInts = () => [0, 0, 0]
    expect(
      addPasswordToEmailList(
        'a@x.com\nb@y.com',
        { kind: 'random', length: 3, sets: sets({ lower: true }) },
        randInts
      )
    ).toEqual(['a@x.com:aaa', 'b@y.com:aaa'])
  })
  it('honors the random length and selected character set', () => {
    const [line] = addPasswordToEmailList('a@x.com', {
      kind: 'random',
      length: 20,
      sets: sets({ numbers: true })
    })
    expect(line!.split(':')[1]).toMatch(/^[0-9]{20}$/)
  })
  it('generates a distinct password for each email in random mode', () => {
    let n = 0
    const randInts = (count: number, max: number) =>
      Array.from({ length: count }, () => n++ % max)
    const out = addPasswordToEmailList(
      'a@x.com\nb@y.com',
      { kind: 'random', length: 4, sets: sets({ lower: true }) },
      randInts
    )
    const p1 = out[0]!.split(':')[1]
    const p2 = out[1]!.split(':')[1]
    expect(p1).not.toEqual(p2)
  })
})
