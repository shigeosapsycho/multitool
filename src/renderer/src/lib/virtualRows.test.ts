import { describe, expect, it } from 'vitest'
import {
  EMAIL_ROW_H,
  GROUP_ROW_H,
  flattenGroups,
  visibleRowRange
} from './virtualRows'

/** A minimal group shape — RowGroup only requires `key` and `emails`. */
const group = (key: string, count: number) => ({
  key,
  emails: Array.from({ length: count }, (_, i) => ({ uid: i }))
})

describe('flattenGroups', () => {
  it('returns no rows and zero height for an empty group list', () => {
    const { rows, totalHeight } = flattenGroups([], new Set())
    expect(rows).toEqual([])
    expect(totalHeight).toBe(0)
  })

  it('collapsed groups produce one group row each, stacked by GROUP_ROW_H', () => {
    const { rows, totalHeight } = flattenGroups(
      [group('a', 3), group('b', 1)],
      new Set()
    )
    expect(rows.map((r) => r.kind)).toEqual(['group', 'group'])
    expect(rows.map((r) => r.top)).toEqual([0, GROUP_ROW_H])
    expect(totalHeight).toBe(2 * GROUP_ROW_H)
  })

  it('an expanded group inserts its email rows below its group row', () => {
    const a = group('a', 2)
    const b = group('b', 1)
    const { rows, totalHeight } = flattenGroups([a, b], new Set(['a']))
    expect(rows.map((r) => r.kind)).toEqual(['group', 'email', 'email', 'group'])
    expect(rows.map((r) => r.top)).toEqual([
      0,
      GROUP_ROW_H,
      GROUP_ROW_H + EMAIL_ROW_H,
      GROUP_ROW_H + 2 * EMAIL_ROW_H
    ])
    expect(totalHeight).toBe(2 * GROUP_ROW_H + 2 * EMAIL_ROW_H)
    // Email rows carry their email and owning group.
    const emailRows = rows.filter((r) => r.kind === 'email')
    expect(emailRows.map((r) => (r.kind === 'email' ? r.email : null))).toEqual(a.emails)
    expect(emailRows.every((r) => r.kind === 'email' && r.group === a)).toBe(true)
  })

  it('marks only the final email row of an expanded group as last', () => {
    const { rows } = flattenGroups([group('a', 3)], new Set(['a']))
    const lasts = rows.flatMap((r) => (r.kind === 'email' ? [r.last] : []))
    expect(lasts).toEqual([false, false, true])
  })

  it('ignores expanded keys that are not in the group list (stale after search)', () => {
    const { rows, totalHeight } = flattenGroups([group('a', 2)], new Set(['gone']))
    expect(rows).toHaveLength(1)
    expect(totalHeight).toBe(GROUP_ROW_H)
  })
})

describe('visibleRowRange', () => {
  // 100 collapsed groups: rows at top = 0, 52, 104, … 5148; total 5200.
  const rows = flattenGroups(
    Array.from({ length: 100 }, (_, i) => group(`g${i}`, 1)),
    new Set()
  ).rows

  it('returns an empty range for no rows', () => {
    expect(visibleRowRange([], 0, 500)).toEqual({ first: 0, last: 0 })
  })

  it('windows the top of the list without going negative', () => {
    // Viewport shows exactly rows 0-9 (520px / 52px); overscan 0 for exactness.
    expect(visibleRowRange(rows, 0, 10 * GROUP_ROW_H, 0)).toEqual({ first: 0, last: 10 })
  })

  it('windows a mid-list scroll position', () => {
    // scrollTop lands exactly on row 50; ten rows fill the viewport.
    const r = visibleRowRange(rows, 50 * GROUP_ROW_H, 10 * GROUP_ROW_H, 0)
    expect(r).toEqual({ first: 50, last: 60 })
  })

  it('applies overscan on both sides, clamped to the list bounds', () => {
    const r = visibleRowRange(rows, 50 * GROUP_ROW_H, 10 * GROUP_ROW_H, 8)
    expect(r).toEqual({ first: 42, last: 68 })
    const top = visibleRowRange(rows, 0, 10 * GROUP_ROW_H, 8)
    expect(top).toEqual({ first: 0, last: 18 })
  })

  it('includes a row the viewport only partially overlaps', () => {
    // scrollTop 26 is halfway into row 0; bottom edge 546 is halfway into row 10.
    const r = visibleRowRange(rows, GROUP_ROW_H / 2, 10 * GROUP_ROW_H, 0)
    expect(r).toEqual({ first: 0, last: 11 })
  })

  it('clamps to the tail when scrolled past the end', () => {
    const r = visibleRowRange(rows, 1_000_000, 520, 8)
    expect(r.first).toBe(Math.max(0, 99 - 8))
    expect(r.last).toBe(100)
  })

  it('covers the whole list when the viewport is taller than the content', () => {
    expect(visibleRowRange(rows, 0, 1_000_000, 0)).toEqual({ first: 0, last: 100 })
  })
})
