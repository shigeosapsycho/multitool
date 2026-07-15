import { describe, expect, it } from 'vitest'
import { parseFavorites, sortFavoritesFirst, toggleFavorite } from './favorites'

describe('parseFavorites', () => {
  it('parses a valid string array', () => {
    expect(parseFavorites('["a","b"]')).toEqual(['a', 'b'])
  })

  it('parses an empty array', () => {
    expect(parseFavorites('[]')).toEqual([])
  })

  it('returns null for missing values', () => {
    expect(parseFavorites(null)).toBeNull()
    expect(parseFavorites('')).toBeNull()
  })

  it('returns null for corrupt JSON', () => {
    expect(parseFavorites('{oops')).toBeNull()
  })

  it('returns null for non-array JSON', () => {
    expect(parseFavorites('{"a":1}')).toBeNull()
    expect(parseFavorites('"a"')).toBeNull()
  })

  it('returns null when entries are not all strings', () => {
    expect(parseFavorites('["a",1]')).toBeNull()
  })
})

describe('toggleFavorite', () => {
  it('adds an id that is not present', () => {
    const next = toggleFavorite(new Set(['a']), 'b')
    expect([...next].sort()).toEqual(['a', 'b'])
  })

  it('removes an id that is present', () => {
    const next = toggleFavorite(new Set(['a', 'b']), 'a')
    expect([...next]).toEqual(['b'])
  })

  it('does not mutate the input set', () => {
    const input = new Set(['a'])
    toggleFavorite(input, 'b')
    expect([...input]).toEqual(['a'])
  })
})

describe('sortFavoritesFirst', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  it('moves favorites to the front, keeping relative order in both groups', () => {
    const out = sortFavoritesFirst(items, new Set(['d', 'b']))
    expect(out.map((i) => i.id)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('returns the original order when nothing is favorited', () => {
    expect(sortFavoritesFirst(items, new Set()).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores favorite ids with no matching item', () => {
    const out = sortFavoritesFirst(items, new Set(['zzz', 'c']))
    expect(out.map((i) => i.id)).toEqual(['c', 'a', 'b', 'd'])
  })
})
