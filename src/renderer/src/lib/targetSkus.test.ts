import { describe, it, expect } from 'vitest'
import { moveSkuToIndex } from './targetSkus'

describe('moveSkuToIndex', () => {
  const base = () => ['a', 'b', 'c', 'd', 'e']

  it('moves a SKU to the top (position 1)', () => {
    expect(moveSkuToIndex(base(), 'c', 1)).toEqual(['c', 'a', 'b', 'd', 'e'])
  })

  it('moves a SKU to the bottom (position = length)', () => {
    expect(moveSkuToIndex(base(), 'c', 5)).toEqual(['a', 'b', 'd', 'e', 'c'])
  })

  it('moves a SKU forward to a middle position', () => {
    expect(moveSkuToIndex(base(), 'a', 3)).toEqual(['b', 'c', 'a', 'd', 'e'])
  })

  it('moves a SKU backward to a middle position', () => {
    expect(moveSkuToIndex(base(), 'e', 2)).toEqual(['a', 'e', 'b', 'c', 'd'])
  })

  it('clamps a position past the end to the last slot', () => {
    expect(moveSkuToIndex(base(), 'b', 99)).toEqual(['a', 'c', 'd', 'e', 'b'])
  })

  it('is a no-op when the SKU is already at the target position', () => {
    expect(moveSkuToIndex(base(), 'b', 2)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns the list unchanged for a position below 1', () => {
    expect(moveSkuToIndex(base(), 'b', 0)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns the list unchanged for a non-numeric position', () => {
    expect(moveSkuToIndex(base(), 'b', NaN)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns the list unchanged when the SKU is not present', () => {
    expect(moveSkuToIndex(base(), 'z', 2)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('does not mutate the input array', () => {
    const input = base()
    moveSkuToIndex(input, 'a', 4)
    expect(input).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
