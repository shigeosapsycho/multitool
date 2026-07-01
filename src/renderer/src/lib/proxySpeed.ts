// Speed bucketing for the Proxy Tester: classify a working proxy's latency into
// Good / Ok / Slow using user-tunable thresholds (adjustable in Settings).

export type ProxySpeedThresholds = { goodMs: number; okMs: number }
export type ProxySpeedCategory = 'good' | 'ok' | 'slow'

/** Original defaults, also used by the Settings "Reset to defaults" button. */
export const PROXY_SPEED_DEFAULTS: ProxySpeedThresholds = { goodMs: 1000, okMs: 2500 }

/**
 * Bucket a latency (ms) into a speed category. `goodMs` and `okMs` are inclusive
 * upper bounds: <= goodMs is Good, <= okMs is Ok, anything higher is Slow.
 */
export function speedCategory(
  latencyMs: number,
  thresholds: ProxySpeedThresholds
): ProxySpeedCategory {
  if (latencyMs <= thresholds.goodMs) return 'good'
  if (latencyMs <= thresholds.okMs) return 'ok'
  return 'slow'
}
