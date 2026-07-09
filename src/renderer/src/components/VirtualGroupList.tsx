import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  EMAIL_ROW_H,
  GROUP_ROW_H,
  flattenGroups,
  visibleRowRange,
  type RowGroup
} from '../lib/virtualRows'

type Props<G extends RowGroup> = {
  groups: readonly G[]
  /** Keys of groups whose email rows are shown. */
  expanded: ReadonlySet<string>
  /** Scrolls back to the top when this value changes (e.g. a fresh scan). */
  resetKey?: unknown
  renderGroupRow: (group: G) => ReactNode
  renderEmailRow: (email: G['emails'][number], group: G, last: boolean) => ReactNode
}

/**
 * Windowed sender-group list: only the rows inside the viewport (plus a small
 * overscan) exist in the DOM, so a 300k-email inbox scrolls as smoothly as a
 * 300-email one. Same technique as CsvTable, fixed row heights, a full-height
 * spacer, absolute-positioned rows, scrollTop + ResizeObserver.
 *
 * Row markup stays with the caller via render props; their roots render into a
 * wrapper that is exactly GROUP_ROW_H / EMAIL_ROW_H tall, so they should fill
 * with `h-full` + `items-center` instead of vertical padding.
 */
export function VirtualGroupList<G extends RowGroup>({
  groups,
  expanded,
  resetKey,
  renderGroupRow,
  renderEmailRow
}: Props<G>) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setViewH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A new scan result starts back at the top; search/expand changes don't.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [resetKey])

  const { rows, totalHeight } = useMemo(() => flattenGroups(groups, expanded), [groups, expanded])
  const { first, last } = visibleRowRange(rows, scrollTop, viewH)

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="min-h-0 flex-1 overflow-auto"
    >
      <div className="relative" style={{ height: totalHeight }}>
        {rows.slice(first, last).map((row, vi) => (
          <div
            key={first + vi}
            className="absolute inset-x-0"
            style={{ top: row.top, height: row.kind === 'group' ? GROUP_ROW_H : EMAIL_ROW_H }}
          >
            {row.kind === 'group'
              ? renderGroupRow(row.group)
              : renderEmailRow(row.email, row.group, row.last)}
          </div>
        ))}
      </div>
    </div>
  )
}
