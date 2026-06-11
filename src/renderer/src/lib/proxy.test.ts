import { describe, it, expect } from 'vitest'
import {
  providerOf,
  detectProviders,
  detectIspUsers,
  filterProxies,
  ispUserStemOf,
  parseProxyLine,
  type ProxyFilters
} from './proxy'

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

describe('parseProxyLine username extraction', () => {
  it('host:port:user:pass', () => {
    expect(parseProxyLine('1.2.3.4:8080:alice:secret').user).toBe('alice')
  })
  it('user:pass@host:port', () => {
    expect(parseProxyLine('alice:secret@1.2.3.4:8080').user).toBe('alice')
  })
  it('user:pass:host:port', () => {
    expect(parseProxyLine('alice:secret:1.2.3.4:8080').user).toBe('alice')
  })
  it('host:port has no user', () => {
    expect(parseProxyLine('1.2.3.4:8080').user).toBeNull()
  })
})

describe('ispUserStemOf', () => {
  it('strips the numeric tail from a batch username', () => {
    expect(ispUserStemOf('xyz377')).toBe('xyz')
    expect(ispUserStemOf('xyz6028')).toBe('xyz')
    expect(ispUserStemOf('cust-8821')).toBe('cust')
    expect(ispUserStemOf('user_2')).toBe('user')
    expect(ispUserStemOf('alpinewekkprk6')).toBe('alpinewekkprk')
  })
  it('keeps a username with no numeric tail intact', () => {
    expect(ispUserStemOf('proxies')).toBe('proxies')
  })
  it('keeps an all-numeric username whole instead of collapsing to empty', () => {
    expect(ispUserStemOf('12345')).toBe('12345')
  })
  it('lowercases and handles null/blank', () => {
    expect(ispUserStemOf('XYZ377')).toBe('xyz')
    expect(ispUserStemOf(null)).toBeNull()
    expect(ispUserStemOf('  ')).toBeNull()
  })
})

describe('detectIspUsers', () => {
  const list = [
    '147.68.215.226:3128:xyz377:9xhnno828c02m0bx',
    '147.68.142.34:3128:xyz6028:7vuxtmgg6vxlqkvh',
    '151.246.69.173:3128:xyz1970:fsvsztoqru8v1e3u',
    '147.68.215.200:3128:xyz5835:f34v3dpu64oobt8x',
    '147.68.142.46:3128:xyz6028:7vuxtmgg6vxlqkvh',
    '64.205.47.232:3120:alpinewekkprk6:proxies',
    '64.205.47.216:3120:alpinewekkprk6:proxies',
    '151.246.69.247:3128:xyz6380:7urzmpp2pxgbh5r7',
    '151.246.69.73:3128:xyz8358:oj2qhrpkt9ymdh7t',
    '151.246.69.245:3128:xyz6380:7urzmpp2pxgbh5r7'
  ].join('\n')

  it('groups ISP usernames by stem', () => {
    expect(detectIspUsers(list)).toEqual([
      { user: 'xyz', count: 8 },
      { user: 'alpinewekkprk', count: 2 }
    ])
  })
  it('ignores residential lines, lines without a user, comments, and blanks', () => {
    const mixed = [
      'gate.smartproxy.com:8080:resuser:p',
      '1.2.3.4:8080',
      '# comment',
      '',
      '5.6.7.8:9000:abc12:pw'
    ].join('\n')
    expect(detectIspUsers(mixed)).toEqual([{ user: 'abc', count: 1 }])
  })
})

describe('filterProxies with removed ISP users', () => {
  const list = [
    '147.68.215.226:3128:xyz377:9xhnno828c02m0bx',
    '64.205.47.232:3120:alpinewekkprk6:proxies',
    '9.9.9.9:1080',
    'gate.smartproxy.com:8080:xyz999:p'
  ].join('\n')

  it('drops only ISP lines whose username stem is removed', () => {
    expect(filterProxies(list, BOTH, undefined, new Set(['xyz']))).toEqual([
      '64.205.47.232:3120:alpinewekkprk6:proxies',
      '9.9.9.9:1080',
      // Residential line shares the stem but is not an ISP line — kept.
      'gate.smartproxy.com:8080:xyz999:p'
    ])
  })
  it('keeps ISP lines without a username when stems are removed', () => {
    expect(filterProxies('9.9.9.9:1080', BOTH, undefined, new Set(['xyz']))).toEqual([
      '9.9.9.9:1080'
    ])
  })
  it('composes with removed providers', () => {
    expect(
      filterProxies(list, BOTH, new Set(['smartproxy.com']), new Set(['alpinewekkprk']))
    ).toEqual(['147.68.215.226:3128:xyz377:9xhnno828c02m0bx', '9.9.9.9:1080'])
  })
})

describe('filterProxies with per-provider limits', () => {
  const fleet = (sid: string) =>
    `mobile.fleetproxy.io:5000:m_8f71dd8a88-country-US-sid-${sid}-ttl-120m:5a3a74c5f2`
  const pizza = (port: number, sid: string) =>
    `us.pizzaproxy.pizza:${port}:1t7h3xrfrlclassicpizza_g-US_f-1559967787_sid-${sid}_l-30:197139gh29yg2g1g`
  const list = [
    fleet('ac272c84'),
    fleet('55912fe7'),
    fleet('d6066bcc'),
    fleet('d72808ce'),
    fleet('5263dcfb'),
    fleet('7b55d1d1'),
    fleet('62d0b510'),
    pizza(10004, '564724831'),
    pizza(10002, '624048005'),
    pizza(10002, '601944506'),
    pizza(10001, '693995594'),
    pizza(10001, '615452733'),
    pizza(10004, '800959506'),
    pizza(10002, '078530256')
  ].join('\n')

  it('caps each provider independently at its own max', () => {
    const limits = new Map([
      ['fleetproxy.io', 5],
      ['pizzaproxy.pizza', 6]
    ])
    const out = filterProxies(list, BOTH, undefined, undefined, limits)
    expect(out).toHaveLength(11)
    expect(out.filter((l) => l.includes('fleetproxy'))).toHaveLength(5)
    expect(out.filter((l) => l.includes('pizzaproxy'))).toHaveLength(6)
    // First N of each, original order.
    expect(out.slice(0, 5)).toEqual([
      fleet('ac272c84'),
      fleet('55912fe7'),
      fleet('d6066bcc'),
      fleet('d72808ce'),
      fleet('5263dcfb')
    ])
    expect(out[5]).toBe(pizza(10004, '564724831'))
  })
  it('leaves providers without a limit uncapped', () => {
    const out = filterProxies(list, BOTH, undefined, undefined, new Map([['fleetproxy.io', 2]]))
    expect(out.filter((l) => l.includes('fleetproxy'))).toHaveLength(2)
    expect(out.filter((l) => l.includes('pizzaproxy'))).toHaveLength(7)
  })
  it('never caps ISP (raw-IP) lines — they have no provider name', () => {
    const mixed = ['1.2.3.4:8080:u:p', '5.6.7.8:8080:u:p', 'a.fleetproxy.io:1:u:p'].join('\n')
    const out = filterProxies(mixed, BOTH, undefined, undefined, new Map([['fleetproxy.io', 0]]))
    expect(out).toEqual(['1.2.3.4:8080:u:p', '5.6.7.8:8080:u:p'])
  })
  it('applies no limits when the map is empty, null, or undefined', () => {
    expect(filterProxies(list, BOTH, undefined, undefined, new Map())).toEqual(
      filterProxies(list, BOTH)
    )
    expect(filterProxies(list, BOTH, undefined, undefined, null)).toEqual(
      filterProxies(list, BOTH)
    )
  })
  it('counts only lines that survive the other filters', () => {
    const two = ['x.fleetproxy.io:1:u:p', 'y.other.com:1:u:p', 'z.fleetproxy.io:1:u:p'].join('\n')
    // other.com removed; fleetproxy capped at 2 keeps both its lines.
    expect(
      filterProxies(two, BOTH, new Set(['other.com']), undefined, new Map([['fleetproxy.io', 2]]))
    ).toEqual(['x.fleetproxy.io:1:u:p', 'z.fleetproxy.io:1:u:p'])
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
