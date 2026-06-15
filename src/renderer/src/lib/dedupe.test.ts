import { describe, it, expect } from 'vitest'
import { findDuplicates, findNonDuplicates, dedupeKeepFirst } from './dedupe'

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
})
