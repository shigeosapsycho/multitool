import { parseProxyLine, proxyCategoryOf } from './proxy'

// Weight given to a line whose category the user has not favored (and to lines
// with no category, e.g. malformed hosts). Boosted categories carry a higher
// weight and so cluster above these baseline lines.
const DEFAULT_WEIGHT = 1

/**
 * Shuffle a proxy list, biasing favored providers toward the top while keeping
 * every line exactly once (nothing dropped, nothing repeated).
 *
 * Each line is weighted by its category's value from `weights` (keyed by the
 * registrable domain for residential proxies, or ISP_CATEGORY for the pooled
 * raw-IP bucket); unfavored categories get DEFAULT_WEIGHT. The values are
 * relative, not required to sum to 100: 80 vs 20 favors the same as 8 vs 2.
 *
 * The ordering is an Efraimidis-Spirakis weighted random permutation: each line
 * draws a key of `rng()^(1/weight)` and the list sorts by key descending. A
 * larger weight pushes keys toward 1, so heavier providers land earlier on
 * average. Ties fall back to input order for a stable, testable result. `rng` is
 * injectable so tests can pin an exact ordering.
 */
export function weightedShuffleProxies(
  text: string,
  weights: Map<string, number>,
  rng: () => number = Math.random
): string[] {
  const ranked = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .map((line, i) => {
      const { host, port } = parseProxyLine(line)
      const category = proxyCategoryOf(host, port)
      const weight = (category && weights.get(category)) || DEFAULT_WEIGHT
      return { line, i, key: Math.pow(rng(), 1 / weight) }
    })

  ranked.sort((a, b) => b.key - a.key || a.i - b.i)
  return ranked.map((r) => r.line)
}
