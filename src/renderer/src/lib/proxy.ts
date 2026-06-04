// Proxy-list parsing and classification for the Proxy Cleaner tool.
//
// A proxy line is sorted into one of two buckets by the shape of its host:
//   - Residential: the host is a hostname/domain (residential/rotating
//     gateways are addressed this way, e.g. gate.smartproxy.com).
//   - ISP: the host is a raw numeric IPv4 address with a numeric port.
// Classification is fully offline — no network calls.

export type ParsedProxy = { scheme: string | null; host: string | null; port: string | null }

export type ProxyFilters = { residential: boolean; isp: boolean }

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const PORT_RE = /^\d{1,5}$/

/**
 * Pull the scheme, host, and port out of one proxy line. Accepts the formats
 * the Proxy Tester documents: `host:port`, `host:port:user:pass`,
 * `user:pass@host:port`, `user:pass:host:port` — each with an optional
 * `http://` / `https://` / `socks5://` prefix.
 */
export function parseProxyLine(raw: string): ParsedProxy {
  const line = raw.trim()
  if (!line) return { scheme: null, host: null, port: null }

  let scheme: string | null = null
  let rest = line
  const m = line.match(SCHEME_RE)
  if (m) {
    scheme = m[1]!.toLowerCase()
    rest = line.slice(m[0].length)
  }

  // Credentialed forms with an `@` put `host:port` right after the last `@`.
  const at = rest.lastIndexOf('@')
  if (at !== -1) {
    const seg = rest.slice(at + 1).split(':')
    return { scheme, host: seg[0]?.trim() || null, port: seg[1]?.trim() || null }
  }

  const parts = rest.split(':')
  if (parts.length <= 2) {
    return { scheme, host: parts[0]!.trim() || null, port: parts[1]?.trim() || null }
  }
  // 3+ parts is ambiguous: `host:port:user:pass` vs `user:pass:host:port`.
  // Pick the form where the field after the host is a numeric port.
  if (PORT_RE.test(parts[1]!.trim())) {
    return { scheme, host: parts[0]!.trim() || null, port: parts[1]!.trim() }
  }
  if (parts.length >= 4 && PORT_RE.test(parts[3]!.trim())) {
    return { scheme, host: parts[2]!.trim() || null, port: parts[3]!.trim() }
  }
  return { scheme, host: parts[0]!.trim() || null, port: parts[1]?.trim() || null }
}

/**
 * True when the host looks like a hostname/domain (residential gateway)
 * rather than a raw IPv4 address. IPv6/bracketed hosts are not residential.
 */
export function isResidentialHost(host: string | null): boolean {
  if (!host) return false
  if (host.includes(':')) return false
  if (IPV4_RE.test(host)) return false
  return /[a-z]/i.test(host)
}

/** True when the proxy is a raw numeric IPv4 address with a numeric port. */
export function isIspProxy(host: string | null, port: string | null): boolean {
  return !!host && IPV4_RE.test(host) && !!port && PORT_RE.test(port)
}

// Two-label public suffixes we must keep together when deriving the registrable
// domain, so x.proxies.co.uk -> proxies.co.uk rather than the meaningless co.uk.
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'net.uk', 'gov.uk', 'ac.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'co.kr', 'co.in', 'co.za', 'co.nz',
  'com.br', 'com.mx', 'com.tr', 'com.cn', 'com.sg', 'com.hk'
])

/**
 * Collapse a proxy host to its provider's registrable domain. Subdomains of one
 * provider collapse together (b2b-s10.liveproxies.io -> liveproxies.io). Returns
 * null when the host has no provider identity: raw IPv4, IPv6/bracketed, all-numeric,
 * or empty.
 */
export function providerOf(host: string | null): string | null {
  if (!host) return null
  if (host.includes(':')) return null // IPv6 / bracketed
  if (IPV4_RE.test(host)) return null
  if (!/[a-z]/i.test(host)) return null
  const labels = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  if (labels.length < 2) return labels[0] ?? null
  const lastTwo = labels.slice(-2).join('.')
  if (labels.length >= 3 && MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.')
  }
  return lastTwo
}

/**
 * Keep only the proxy lines matching the selected filters. A line is kept
 * when it matches ANY checked filter (residential OR isp). Original line
 * text and order are preserved; no deduplication.
 */
export function filterProxies(text: string, filters: ProxyFilters): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const { host, port } = parseProxyLine(line)
    if (
      (filters.residential && isResidentialHost(host)) ||
      (filters.isp && isIspProxy(host, port))
    ) {
      out.push(line)
    }
  }
  return out
}
