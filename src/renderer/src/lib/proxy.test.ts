import { describe, it, expect } from 'vitest'
import { providerOf, detectProviders, filterProxies, type ProxyFilters } from './proxy'

const BOTH: ProxyFilters = { residential: true, isp: true }

describe('providerOf', () => {
  it('collapses subdomains to the registrable domain', () => {
    expect(providerOf('b2b-s10.liveproxies.io')).toBe('liveproxies.io')
    expect(providerOf('mix.nexaproxies.com')).toBe('nexaproxies.com')
    expect(providerOf('gate.smartproxy.com')).toBe('smartproxy.com')
  })
  it('returns null for raw IPv4 hosts', () => {
    expect(providerOf('192.168.0.1')).toBeNull()
  })
  it('returns null for IPv6/bracketed and empty hosts', () => {
    expect(providerOf('2001:db8::1')).toBeNull()
    expect(providerOf(null)).toBeNull()
  })
  it('keeps two-label public suffixes together', () => {
    expect(providerOf('gate.proxies.co.uk')).toBe('proxies.co.uk')
  })
  it('returns null for a single-label host', () => {
    expect(providerOf('localhost')).toBeNull()
  })
})

describe('detectProviders', () => {
  const list = [
    'b2b-s10.liveproxies.io:7383:u:p',
    'b2b-s2.liveproxies.io:7383:u:p',
    'mix.nexaproxies.com:8888:u:p',
    '192.168.0.1:8080:u:p',
    '# a comment',
    ''
  ].join('\n')

  it('counts lines per provider and excludes raw-IP/comment/blank lines', () => {
    expect(detectProviders(list)).toEqual([
      { provider: 'liveproxies.io', count: 2 },
      { provider: 'nexaproxies.com', count: 1 }
    ])
  })
  it('sorts alphabetically when counts are equal', () => {
    const tie = ['a.bravo.com:80:u:p', 'a.alpha.com:80:u:p'].join('\n')
    expect(detectProviders(tie)).toEqual([
      { provider: 'alpha.com', count: 1 },
      { provider: 'bravo.com', count: 1 }
    ])
  })
})

describe('filterProxies with removed providers', () => {
  const list = ['b2b-s10.liveproxies.io:7383:u:p', 'mix.nexaproxies.com:8888:u:p'].join('\n')

  it('drops only the removed provider', () => {
    expect(filterProxies(list, BOTH, new Set(['liveproxies.io']))).toEqual([
      'mix.nexaproxies.com:8888:u:p'
    ])
  })
  it('is unchanged when the removed set is empty', () => {
    expect(filterProxies(list, BOTH, new Set())).toEqual([
      'b2b-s10.liveproxies.io:7383:u:p',
      'mix.nexaproxies.com:8888:u:p'
    ])
  })
  it('applies the type filter before the removed-provider check', () => {
    expect(
      filterProxies('gate.smartproxy.com:8080:u:p', { residential: false, isp: true }, new Set())
    ).toEqual([])
  })
})
