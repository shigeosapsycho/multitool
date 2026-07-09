import { describe, it, expect } from 'vitest'
import { computeNewToolIds } from './newTools'

describe('computeNewToolIds', () => {
  it('marks nothing new on a first run, when no seen list is stored', () => {
    expect(computeNewToolIds(['a', 'b', 'c'], null)).toEqual([])
  })

  it('marks an id the user has never seen', () => {
    expect(computeNewToolIds(['a', 'b', 'c'], ['a', 'b'])).toEqual(['c'])
  })

  it('does not mark an id the user has already seen', () => {
    expect(computeNewToolIds(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('ignores a seen id that no longer exists', () => {
    expect(computeNewToolIds(['a', 'c'], ['a', 'b'])).toEqual(['c'])
  })

  it('returns new ids in tools order, not seen-list order', () => {
    expect(computeNewToolIds(['a', 'b', 'c', 'd'], ['c'])).toEqual(['a', 'b', 'd'])
  })

  it('treats a stored-but-empty seen list as having seen nothing', () => {
    expect(computeNewToolIds(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('handles an empty tools list', () => {
    expect(computeNewToolIds([], ['a'])).toEqual([])
    expect(computeNewToolIds([], null)).toEqual([])
  })
})
