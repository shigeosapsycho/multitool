import { describe, it, expect } from 'vitest'
import { speedCategory, PROXY_SPEED_DEFAULTS } from './proxySpeed'

const d = PROXY_SPEED_DEFAULTS

describe('PROXY_SPEED_DEFAULTS', () => {
  it('is Good <= 1000 ms, Ok <= 2500 ms', () => {
    expect(PROXY_SPEED_DEFAULTS).toEqual({ goodMs: 1000, okMs: 2500 })
  })
})

describe('speedCategory', () => {
  it('classifies latency at or below goodMs as good', () => {
    expect(speedCategory(500, d)).toBe('good')
  })
  it('treats goodMs as the inclusive top of good', () => {
    expect(speedCategory(1000, d)).toBe('good')
  })
  it('classifies latency between goodMs and okMs as ok', () => {
    expect(speedCategory(1001, d)).toBe('ok')
  })
  it('treats okMs as the inclusive top of ok', () => {
    expect(speedCategory(2500, d)).toBe('ok')
  })
  it('classifies latency above okMs as slow', () => {
    expect(speedCategory(2501, d)).toBe('slow')
  })
  it('honors custom thresholds', () => {
    const t = { goodMs: 200, okMs: 500 }
    expect(speedCategory(150, t)).toBe('good')
    expect(speedCategory(350, t)).toBe('ok')
    expect(speedCategory(600, t)).toBe('slow')
  })
})
