import type { ToolMeta } from '../types'

/** Case-insensitive substring match over title + description. Empty query = all. */
export function filterTools(query: string, tools: ToolMeta[]): ToolMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return tools
  return tools.filter((t) => `${t.title} ${t.description}`.toLowerCase().includes(q))
}

/** Count grid tracks from a computed `grid-template-columns` string. Min 1. */
export function parseColumnCount(templateColumns: string): number {
  const tracks = templateColumns.trim().split(/\s+/).filter((s) => s && s !== 'none')
  return Math.max(1, tracks.length)
}

export type ArrowDirection = 'left' | 'right' | 'up' | 'down'

/** Next highlighted index for an arrow key, clamped to a `count`-item grid of `columns` wide. */
export function nextSelection(
  current: number,
  count: number,
  columns: number,
  direction: ArrowDirection
): number {
  if (count <= 0) return 0
  const cur = Math.min(Math.max(current, 0), count - 1)
  const cols = Math.max(1, columns)
  switch (direction) {
    case 'left':
      return Math.max(0, cur - 1)
    case 'right':
      return Math.min(count - 1, cur + 1)
    case 'up': {
      const i = cur - cols
      return i >= 0 ? i : cur
    }
    case 'down': {
      const i = cur + cols
      return i < count ? i : cur
    }
  }
}
