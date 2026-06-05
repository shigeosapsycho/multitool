import { describe, it, expect } from 'vitest'
import { filterTools, parseColumnCount, nextSelection } from './toolSearch'
import type { ToolMeta } from '../types'

const TOOLS: ToolMeta[] = [
  { id: 'proxy-cleaner', title: 'Proxy Cleaner', description: 'Filter a proxy list down to residential and/or ISP proxies.', accent: '#818cf8' },
  { id: 'proxy-tester', title: 'Proxy Tester', description: 'Ping a URL and report latency. Optional proxy.', accent: '#38bdf8' },
  { id: 'randomize', title: 'Randomize List', description: 'Shuffle the lines in random order.', accent: '#f472b6' }
]

describe('filterTools', () => {
  it('returns all tools for an empty or whitespace query', () => {
    expect(filterTools('', TOOLS)).toHaveLength(3)
    expect(filterTools('   ', TOOLS)).toHaveLength(3)
  })
  it('matches the title case-insensitively', () => {
    expect(filterTools('PROXY', TOOLS).map((t) => t.id)).toEqual(['proxy-cleaner', 'proxy-tester'])
  })
  it('matches words found only in the description', () => {
    expect(filterTools('shuffle', TOOLS).map((t) => t.id)).toEqual(['randomize'])
    expect(filterTools('latency', TOOLS).map((t) => t.id)).toEqual(['proxy-tester'])
  })
  it('returns an empty array when nothing matches', () => {
    expect(filterTools('zzz', TOOLS)).toEqual([])
  })
})

describe('parseColumnCount', () => {
  it('counts space-separated track sizes', () => {
    expect(parseColumnCount('200px 200px 200px')).toBe(3)
    expect(parseColumnCount('220px 220px')).toBe(2)
  })
  it('falls back to 1 for none/empty input', () => {
    expect(parseColumnCount('none')).toBe(1)
    expect(parseColumnCount('')).toBe(1)
  })
})

describe('nextSelection', () => {
  // 5 items, 3 columns: row0 = [0,1,2], row1 = [3,4]
  it('moves left and right with clamping', () => {
    expect(nextSelection(2, 5, 3, 'right')).toBe(3)
    expect(nextSelection(4, 5, 3, 'right')).toBe(4)
    expect(nextSelection(0, 5, 3, 'left')).toBe(0)
    expect(nextSelection(3, 5, 3, 'left')).toBe(2)
  })
  it('moves up and down by one row, staying in range', () => {
    expect(nextSelection(0, 5, 3, 'down')).toBe(3)
    expect(nextSelection(3, 5, 3, 'up')).toBe(0)
    expect(nextSelection(2, 5, 3, 'down')).toBe(2) // 2+3=5 out of range -> stay
    expect(nextSelection(1, 5, 3, 'up')).toBe(1)   // 1-3<0 -> stay
  })
  it('returns 0 when there are no items', () => {
    expect(nextSelection(0, 0, 3, 'right')).toBe(0)
  })
})
