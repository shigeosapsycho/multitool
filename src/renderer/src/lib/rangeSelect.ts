/**
 * Inclusive span of `visibleUids` between the anchor and the target, in
 * either direction, the uids Shift+click selects. Empty when there is no
 * anchor or when either end is not in the visible list (collapsed group or
 * filtered out); the caller falls back to a single toggle in that case.
 */
export function rangeBetween(
  visibleUids: readonly number[],
  anchorUid: number | null,
  targetUid: number
): number[] {
  if (anchorUid === null) return []
  const a = visibleUids.indexOf(anchorUid)
  const b = visibleUids.indexOf(targetUid)
  if (a === -1 || b === -1) return []
  const [lo, hi] = a <= b ? [a, b] : [b, a]
  return visibleUids.slice(lo, hi + 1)
}
