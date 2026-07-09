import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { parseCsvRow } from '../lib/transforms'

const ROW_H = 30
const HEAD_H = 34
const NUM_W = 52
const COL_W = 152

/**
 * Renders CSV text as a scrollable table, sticky header, row numbers, zebra
 * rows, horizontal scroll for the many columns. Rows are virtualized (only the
 * visible window is in the DOM) so a few-thousand-row file stays smooth.
 * Display only; the caller still owns the raw text for Copy / Save.
 */
export function CsvTable({ text }: { text: string }) {
  const rows = useMemo(
    () =>
      text
        .replace(/\r?\n$/, '')
        .split('\n')
        .map((l) => parseCsvRow(l)),
    [text]
  )
  const header = rows[0] ?? []
  const body = rows.slice(1)
  const cols = header.length

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

  // Reset scroll when the content changes (new run / different file).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
    setScrollTop(0)
  }, [text])

  const overscan = 6
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - overscan)
  const last = Math.min(body.length, Math.ceil((scrollTop + viewH) / ROW_H) + overscan)
  const gridCols = `${NUM_W}px repeat(${cols}, ${COL_W}px)`
  const totalW = NUM_W + cols * COL_W

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="min-h-0 flex-1 overflow-auto"
    >
      <div className="relative" style={{ width: totalW, height: HEAD_H + body.length * ROW_H }}>
        <div
          className="sticky top-0 z-10 grid border-b border-border bg-surface-2 text-[10.5px] font-semibold uppercase tracking-wide text-text-secondary"
          style={{ gridTemplateColumns: gridCols, height: HEAD_H }}
        >
          <div
            className="truncate border-r border-border px-2 text-right text-text-muted"
            style={{ lineHeight: `${HEAD_H}px` }}
          >
            #
          </div>
          {header.map((h, i) => (
            <div
              key={i}
              className="truncate border-r border-border px-2"
              style={{ lineHeight: `${HEAD_H}px` }}
              title={h}
            >
              {h}
            </div>
          ))}
        </div>
        {body.slice(first, last).map((cells, vi) => {
          const i = first + vi
          return (
            <div
              key={i}
              className={`absolute grid border-b border-border/60 text-[12px] hover:bg-accent-soft ${
                i % 2 ? 'bg-surface' : ''
              }`}
              style={{ top: HEAD_H + i * ROW_H, height: ROW_H, width: totalW, gridTemplateColumns: gridCols }}
            >
              <div
                className="truncate border-r border-border px-2 text-right font-mono text-[11px] text-text-muted"
                style={{ lineHeight: `${ROW_H}px` }}
              >
                {i + 1}
              </div>
              {header.map((_, ci) => (
                <div
                  key={ci}
                  className="truncate border-r border-border px-2 font-mono text-text-primary"
                  style={{ lineHeight: `${ROW_H}px` }}
                  title={cells[ci] ?? ''}
                >
                  {cells[ci] ?? ''}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
