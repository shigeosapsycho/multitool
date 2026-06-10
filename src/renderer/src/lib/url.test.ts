import { describe, it, expect } from 'vitest'
import { normalizeTargetUrl } from './url'

describe('normalizeTargetUrl', () => {
  it('prepends https:// to a bare host', () => {
    expect(normalizeTargetUrl('google.com')).toBe('https://google.com')
  })
  it('prepends https:// to a host with port and path', () => {
    expect(normalizeTargetUrl('localhost:8080/health')).toBe('https://localhost:8080/health')
  })
  it('leaves an existing scheme untouched', () => {
    expect(normalizeTargetUrl('https://google.com')).toBe('https://google.com')
    expect(normalizeTargetUrl('http://google.com')).toBe('http://google.com')
    expect(normalizeTargetUrl('HTTP://google.com')).toBe('HTTP://google.com')
  })
  it('still prefixes when :// only appears later in the string', () => {
    expect(normalizeTargetUrl('google.com/?next=https://x')).toBe('https://google.com/?next=https://x')
  })
})
