import { describe, it, expect } from 'vitest'
import { findDuplicates, findNonDuplicates, dedupeKeepFirst, firstField } from './dedupe'
import { dedupeFromText, dedupeFromTwoTexts } from './transforms'

describe('findDuplicates', () => {
  it('returns one entry per value that appears more than once', () => {
    expect(findDuplicates(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b'])
  })
  it('returns nothing when every value is unique', () => {
    expect(findDuplicates(['a', 'b', 'c'])).toEqual([])
  })
  it('handles an empty list', () => {
    expect(findDuplicates([])).toEqual([])
  })
})

describe('findNonDuplicates', () => {
  it('returns only values that appear exactly once', () => {
    expect(findNonDuplicates(['a', 'b', 'a', 'c'])).toEqual(['b', 'c'])
  })
  it('returns everything when all values are unique', () => {
    expect(findNonDuplicates(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('dedupeKeepFirst', () => {
  it('keeps one copy of each value, dropping later repeats', () => {
    expect(dedupeKeepFirst(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b', 'c'])
  })
  it('preserves first-seen order, not sorted order', () => {
    expect(dedupeKeepFirst(['c', 'a', 'c', 'b', 'a'])).toEqual(['c', 'a', 'b'])
  })
  it('returns an all-unique list unchanged', () => {
    expect(dedupeKeepFirst(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })
  it('collapses a list that is entirely one repeated value to a single item', () => {
    expect(dedupeKeepFirst(['x', 'x', 'x'])).toEqual(['x'])
  })
  it('handles an empty list', () => {
    expect(dedupeKeepFirst([])).toEqual([])
  })
  it('treats values differing only by case as distinct', () => {
    expect(dedupeKeepFirst(['A', 'a', 'A'])).toEqual(['A', 'a'])
  })
  it("defaults to whole-line matching, so user:pass rows with different passwords stay", () => {
    expect(dedupeKeepFirst(['john:pw1', 'john:pw2'])).toEqual(['john:pw1', 'john:pw2'])
  })
})

describe('firstField', () => {
  it('returns the text before the first separator', () => {
    expect(firstField('john:pw1')).toBe('john')
    expect(firstField('a@x.com;pw')).toBe('a@x.com')
    expect(firstField('a@x.com,pw,extra')).toBe('a@x.com')
    expect(firstField('bob|pw')).toBe('bob')
    expect(firstField('bob\tpw')).toBe('bob')
  })
  it('returns the whole line when there is no separator', () => {
    expect(firstField('john')).toBe('john')
  })
  it('does not split on spaces', () => {
    expect(firstField('john doe:pw')).toBe('john doe')
  })
  it('trims spacing around the field', () => {
    expect(firstField(' john :pw')).toBe('john')
  })
  it('falls back to the whole line when the first field is empty', () => {
    expect(firstField(':pw1')).toBe(':pw1')
    expect(firstField('  :pw1')).toBe('  :pw1')
  })
})

describe("dedupeKeepFirst with 'first-field'", () => {
  it('keeps the first row for each username, dropping later rows with other passwords', () => {
    expect(dedupeKeepFirst(['john:pw1', 'bob:pw2', 'john:pw3', 'bob:pw4'], 'first-field')).toEqual([
      'john:pw1',
      'bob:pw2'
    ])
  })
  it('never merges different usernames that share a password', () => {
    expect(dedupeKeepFirst(['alice:hunter2', 'bob:hunter2'], 'first-field')).toEqual([
      'alice:hunter2',
      'bob:hunter2'
    ])
  })
  it('matches the whole first field, never a prefix of it', () => {
    expect(dedupeKeepFirst(['john:pw1', 'johnny:pw2'], 'first-field')).toEqual([
      'john:pw1',
      'johnny:pw2'
    ])
  })
  it('treats a bare username and a user:pass row for it as the same entry', () => {
    expect(dedupeKeepFirst(['john', 'john:pw1'], 'first-field')).toEqual(['john'])
  })
  it('keeps rows with an empty first field apart unless the whole line repeats', () => {
    expect(dedupeKeepFirst([':pw1', ':pw2', ':pw1'], 'first-field')).toEqual([':pw1', ':pw2'])
  })
  it('stays case-sensitive, like whole-line mode', () => {
    expect(dedupeKeepFirst(['John:pw1', 'john:pw2'], 'first-field')).toEqual([
      'John:pw1',
      'john:pw2'
    ])
  })
})

describe('dedupeFromTwoTexts', () => {
  it('lets the first file win a username both files share', () => {
    expect(dedupeFromTwoTexts('john:old\nbob:pw', 'john:new\ncarol:pw', 'first-field')).toEqual([
      'john:old',
      'bob:pw',
      'carol:pw'
    ])
  })
  it('keeps whole-line matching when no mode is given', () => {
    expect(dedupeFromTwoTexts('john:old', 'john:new')).toEqual(['john:old', 'john:new'])
  })
})

describe('dedupeFromText', () => {
  it("applies 'first-field' to a single list", () => {
    expect(dedupeFromText('a@x.com:1\nb@x.com:2\na@x.com:3', 'first-field')).toEqual([
      'a@x.com:1',
      'b@x.com:2'
    ])
  })
})
