import { parseProxyLine, providerOf } from './proxy'

// Weight given to a line whose provider the user has not set a percentage for
// (and to lines with no provider identity, e.g. raw IPs). Boosted providers
// carry a higher weight and so cluster above these baseline lines.
const DEFAULT_WEIGHT = 1

/**
 * Shuffle a proxy list, biasing favored providers toward the top while keeping
 * every line exactly once (nothing dropped, nothing repeated).
 *
 * Each line is weighted by its provider's percentage from `weights` (keyed by
 * the registrable domain `providerOf` returns); unset providers get
 * DEFAULT_WEIGHT. The values are relative, not required to sum to 100: 80 vs 20
 * favors the same as 8 vs 2.
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
      const provider = providerOf(parseProxyLine(line).host)
      const weight = (provider && weights.get(provider)) || DEFAULT_WEIGHT
      return { line, i, key: Math.pow(rng(), 1 / weight) }
    })

  ranked.sort((a, b) => b.key - a.key || a.i - b.i)
  return ranked.map((r) => r.line)
}
