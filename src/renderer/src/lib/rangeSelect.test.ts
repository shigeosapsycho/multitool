import { describe, expect, it } from 'vitest'
import { rangeBetween } from './rangeSelect'

const uids = [10, 20, 30, 40, 50]

describe('rangeBetween', () => {
  it('returns the inclusive forward range from anchor to target', () => {
    expect(rangeBetween(uids, 20, 40)).toEqual([20, 30, 40])
  })

  it('returns the same inclusive range when selecting backwards', () => {
    expect(rangeBetween(uids, 40, 20)).toEqual([20, 30, 40])
  })

  it('returns a single uid when anchor and target are the same row', () => {
    expect(rangeBetween(uids, 30, 30)).toEqual([30])
  })

  it('spans the whole list from first to last', () => {
    expect(rangeBetween(uids, 10, 50)).toEqual([10, 20, 30, 40, 50])
  })

  it('returns empty when there is no anchor yet', () => {
    expect(rangeBetween(uids, null, 30)).toEqual([])
  })

  it('returns empty when the anchor is no longer visible', () => {
    expect(rangeBetween(uids, 99, 30)).toEqual([])
  })

  it('returns empty when the target is not visible', () => {
    expect(rangeBetween(uids, 20, 99)).toEqual([])
  })

  it('returns empty for an empty list', () => {
    expect(rangeBetween([], 10, 20)).toEqual([])
  })
})
