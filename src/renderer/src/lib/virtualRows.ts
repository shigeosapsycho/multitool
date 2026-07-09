/** Fixed pixel heights for the two row kinds in the virtualized group list. */
export const GROUP_ROW_H = 52
export const EMAIL_ROW_H = 31

/** Minimal structural shape VirtualGroupList needs from a sender group. */
export type RowGroup = { key: string; emails: readonly unknown[] }

export type VirtualRow<G extends RowGroup> =
  | { kind: 'group'; group: G; top: number }
  | {
      kind: 'email'
      group: G
      email: G['emails'][number]
      /** True for the final email of its group, that row draws the group's bottom border. */
      last: boolean
      top: number
    }

/**
 * Flatten sender groups into one absolutely-positionable row list: every group
 * contributes a group row, and an expanded group additionally contributes one
 * row per email. Each row knows its `top` offset so the scroll window can be
 * found by binary search. O(total rows); runs only when groups or expansion
 * change, never per scroll frame.
 */
export function flattenGroups<G extends RowGroup>(
  groups: readonly G[],
  expanded: ReadonlySet<string>
): { rows: VirtualRow<G>[]; totalHeight: number } {
  const rows: VirtualRow<G>[] = []
  let top = 0
  for (const g of groups) {
    rows.push({ kind: 'group', group: g, top })
    top += GROUP_ROW_H
    if (expanded.has(g.key)) {
      for (let i = 0; i < g.emails.length; i++) {
        rows.push({
          kind: 'email',
          group: g,
          email: g.emails[i],
          last: i === g.emails.length - 1,
          top
        })
        top += EMAIL_ROW_H
      }
    }
  }
  return { rows, totalHeight: top }
}

/**
 * The half-open row window [first, last) that covers the viewport plus
 * `overscan` rows on each side. Binary-searches the sorted `top` offsets, so
 * scrolling costs O(log rows) regardless of inbox size. Indices are clamped;
 * a scrollTop past the end yields the tail window rather than an empty one.
 */
export function visibleRowRange(
  rows: readonly { top: number }[],
  scrollTop: number,
  viewHeight: number,
  overscan = 8
): { first: number; last: number } {
  if (rows.length === 0) return { first: 0, last: 0 }

  // Rightmost row whose top edge is at or above the viewport's top edge -
  // the first row that can be (even partially) visible.
  let lo = 0
  let hi = rows.length - 1
  let first = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].top <= scrollTop) {
      first = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  // Leftmost row that starts at or below the viewport's bottom edge, the
  // exclusive end of the visible window.
  const bottom = scrollTop + viewHeight
  lo = first
  hi = rows.length - 1
  let last = rows.length
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].top >= bottom) {
      last = mid
      hi = mid - 1
    } else {
      lo = mid + 1
    }
  }

  return {
    first: Math.max(0, first - overscan),
    last: Math.min(rows.length, last + overscan)
  }
}
