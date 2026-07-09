// Proxy-list parsing and classification for the Proxy Cleaner tool.
//
// A proxy line is sorted into one of two buckets by the shape of its host:
//   - Residential: the host is a hostname/domain (residential/rotating
//     gateways are addressed this way, e.g. gate.smartproxy.com).
//   - ISP: the host is a raw numeric IPv4 address with a numeric port.
// Classification is fully offline, no network calls.

export type ParsedProxy = {
  scheme: string | null
  host: string | null
  port: string | null
  user: string | null
}

export type ProxyFilters = { residential: boolean; isp: boolean }

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const PORT_RE = /^\d{1,5}$/

/**
 * Pull the scheme, host, and port out of one proxy line. Accepts the formats
 * the Proxy Tester documents: `host:port`, `host:port:user:pass`,
 * `user:pass@host:port`, `user:pass:host:port`, each with an optional
 * `http://` / `https://` / `socks5://` prefix.
 */
export function parseProxyLine(raw: string): ParsedProxy {
  const line = raw.trim()
  if (!line) return { scheme: null, host: null, port: null, user: null }

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
    const user = rest.slice(0, at).split(':')[0]?.trim() || null
    return { scheme, host: seg[0]?.trim() || null, port: seg[1]?.trim() || null, user }
  }

  const parts = rest.split(':')
  if (parts.length <= 2) {
    return { scheme, host: parts[0]!.trim() || null, port: parts[1]?.trim() || null, user: null }
  }
  // 3+ parts is ambiguous: `host:port:user:pass` vs `user:pass:host:port`.
  // Pick the form where the field after the host is a numeric port.
  if (PORT_RE.test(parts[1]!.trim())) {
    return {
      scheme,
      host: parts[0]!.trim() || null,
      port: parts[1]!.trim(),
      user: parts[2]?.trim() || null
    }
  }
  if (parts.length >= 4 && PORT_RE.test(parts[3]!.trim())) {
    return {
      scheme,
      host: parts[2]!.trim() || null,
      port: parts[3]!.trim(),
      user: parts[0]!.trim() || null
    }
  }
  return { scheme, host: parts[0]!.trim() || null, port: parts[1]?.trim() || null, user: null }
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
// This is intentionally a small curated subset, not the full Public Suffix List
// (avoiding a PSL dependency). Extend it if providers with unlisted suffixes appear.
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
  if (labels.length < 2) return null // single label has no registrable domain / provider identity
  const lastTwo = labels.slice(-2).join('.')
  if (labels.length >= 3 && MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join('.')
  }
  return lastTwo
}

/**
 * Category key for the pooled ISP (raw-IPv4) bucket. Safe as a Map key alongside
 * residential providers because `providerOf` only ever returns registrable
 * domains, which always contain a dot; this key has none.
 */
export const ISP_CATEGORY = 'isp'

/**
 * The favor category a proxy line belongs to: its provider's registrable domain
 * when residential, the shared ISP bucket when a raw-IPv4 proxy, or null when it
 * is neither (so callers leave it at the baseline weight).
 */
export function proxyCategoryOf(host: string | null, port: string | null): string | null {
  return providerOf(host) ?? (isIspProxy(host, port) ? ISP_CATEGORY : null)
}

export type ProxyGroup = { key: string; label: string; count: number }

/**
 * Group a proxy list into favor categories: one per residential provider plus a
 * single pooled ISPs bucket. Residential providers come first, sorted by count
 * descending then name ascending (matching detectProviders); the ISPs bucket is
 * appended last and omitted when the list has no raw-IP proxies. Blank and
 * comment (#) lines are ignored.
 */
export function detectProxyGroups(text: string): ProxyGroup[] {
  const counts = new Map<string, number>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const { host, port } = parseProxyLine(line)
    const category = proxyCategoryOf(host, port)
    if (!category) continue
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  const groups: ProxyGroup[] = [...counts.entries()]
    .filter(([key]) => key !== ISP_CATEGORY)
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  const ispCount = counts.get(ISP_CATEGORY) ?? 0
  if (ispCount > 0) groups.push({ key: ISP_CATEGORY, label: 'ISPs', count: ispCount })
  return groups
}

/**
 * Collapse an ISP proxy username to its account stem. Providers issue username
 * batches that share an alpha prefix and vary only in a numeric (or separator +
 * numeric) tail, `xyz377`, `xyz6028`, `xyz1970` are all one purchase, `xyz`.
 * The stem is the lowercased username with that variable tail stripped. A
 * username with no alpha part (or none left after stripping) keeps its full
 * lowercased form so distinct numeric accounts don't collapse to ''.
 */
export function ispUserStemOf(user: string | null): string | null {
  if (!user) return null
  const u = user.trim().toLowerCase()
  if (!u) return null
  const stem = u.replace(/[\d\-_.]+$/, '')
  return stem || u
}

/**
 * Group ISP proxy lines (raw-IPv4 hosts) by username stem and count the lines
 * for each. Lines without a username, and residential/comment/blank lines, are
 * ignored. Result is sorted by count descending, then stem ascending.
 */
export function detectIspUsers(text: string): { user: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const { host, port, user } = parseProxyLine(line)
    if (!isIspProxy(host, port)) continue
    const stem = ispUserStemOf(user)
    if (!stem) continue
    counts.set(stem, (counts.get(stem) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([user, count]) => ({ user, count }))
    .sort((a, b) => b.count - a.count || a.user.localeCompare(b.user))
}

/**
 * Group a proxy list by provider (registrable domain of the host) and count the
 * lines for each. Blank, comment (#), and raw-IP lines are ignored. Result is
 * sorted by count descending, then provider name ascending.
 */
export function detectProviders(text: string): { provider: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const provider = providerOf(parseProxyLine(line).host)
    if (!provider) continue
    counts.set(provider, (counts.get(provider) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider))
}

/**
 * Keep only the proxy lines matching the selected filters. A line is kept when
 * it matches ANY checked type filter (residential OR isp), its provider is not
 * in `removed`, and, for ISP lines, its username stem is not in
 * `removedUsers`. `providerLimits` caps providers independently: a provider
 * mapped to N keeps only its first N surviving lines; unmapped providers are
 * uncapped, and lines with no provider name (raw IPs) are never counted.
 * Original line text and order are preserved; no deduplication.
 */
export function filterProxies(
  text: string,
  filters: ProxyFilters,
  removed?: Set<string>,
  removedUsers?: Set<string>,
  providerLimits?: Map<string, number> | null
): string[] {
  const out: string[] = []
  const keptPerProvider = new Map<string, number>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const { host, port, user } = parseProxyLine(line)
    const isIsp = isIspProxy(host, port)
    const typeMatch =
      (filters.residential && isResidentialHost(host)) || (filters.isp && isIsp)
    if (!typeMatch) continue
    const provider = providerOf(host)
    if (removed && removed.size > 0) {
      // null provider (raw IP, etc.) means there's nothing to match against, keep the line.
      if (provider && removed.has(provider)) continue
    }
    if (isIsp && removedUsers && removedUsers.size > 0) {
      // null stem (no username on the line) means nothing to match, keep the line.
      const stem = ispUserStemOf(user)
      if (stem && removedUsers.has(stem)) continue
    }
    if (provider && providerLimits && providerLimits.size > 0) {
      const limit = providerLimits.get(provider)
      if (limit != null) {
        const kept = keptPerProvider.get(provider) ?? 0
        if (kept >= limit) continue
        keptPerProvider.set(provider, kept + 1)
      }
    }
    out.push(line)
  }
  return out
}
