import { describe, it, expect } from 'vitest'
import { sortList } from './sortList'

describe('sortList', () => {
  it('sorts lines alphabetically ascending', () => {
    expect(sortList('banana\nApple\ncherry', 'asc')).toEqual(['Apple', 'banana', 'cherry'])
  })

  it('sorts lines descending', () => {
    expect(sortList('banana\nApple\ncherry', 'desc')).toEqual(['cherry', 'banana', 'Apple'])
  })

  it('defaults to ascending', () => {
    expect(sortList('b\na')).toEqual(['a', 'b'])
  })

  it('orders embedded numbers naturally, not lexically', () => {
    expect(sortList('item10\nitem2\nitem1', 'asc')).toEqual(['item1', 'item2', 'item10'])
  })

  it('ignores case when comparing', () => {
    expect(sortList('Banana\napple\nCherry', 'asc')).toEqual(['apple', 'Banana', 'Cherry'])
  })

  it('trims whitespace and drops blank lines', () => {
    expect(sortList('  b \n\n  a\n', 'asc')).toEqual(['a', 'b'])
  })

  it('returns an empty array for blank input', () => {
    expect(sortList('\n  \n', 'asc')).toEqual([])
  })
})
