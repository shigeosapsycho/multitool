import { describe, it, expect } from 'vitest'
import { weightedShuffleProxies } from './proxyShuffle'

// A tiny deterministic PRNG so tests pin an exact ordering without Math.random.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// Feed an exact sequence of uniforms, one per line, in line order.
function queued(values: number[]): () => number {
  let i = 0
  return () => values[i++] ?? 0
}

describe('weightedShuffleProxies', () => {
  it('keeps every non-blank line exactly once (a permutation)', () => {
    const input = ['1.1.1.1:1', '2.2.2.2:2', 'a.foo.com:3', 'b.bar.com:4', '3.3.3.3:5'].join('\n')
    const out = weightedShuffleProxies(input, new Map(), lcg(7))
    expect([...out].sort()).toEqual(
      ['1.1.1.1:1', '2.2.2.2:2', '3.3.3.3:5', 'a.foo.com:3', 'b.bar.com:4'].sort()
    )
  })

  it('with equal weights, orders by the drawn uniform descending', () => {
    // Three raw-IP lines (no provider -> default weight 1). key = U^(1/1) = U.
    const input = '1.1.1.1:1000\n2.2.2.2:2000\n3.3.3.3:3000'
    const out = weightedShuffleProxies(input, new Map(), queued([0.1, 0.9, 0.5]))
    expect(out).toEqual(['2.2.2.2:2000', '3.3.3.3:3000', '1.1.1.1:1000'])
  })

  it('lifts a heavily-weighted provider above a lighter one even on a lower draw', () => {
    const input = 'a.smartproxy.com:1\nb.iproyal.com:1'
    const weights = new Map([['smartproxy.com', 100]])
    // smartproxy draws 0.5, iproyal draws 0.9. key = 0.5^(1/100) ~= 0.993 > 0.9.
    const out = weightedShuffleProxies(input, weights, queued([0.5, 0.9]))
    expect(out[0]).toBe('a.smartproxy.com:1')
  })

  it('gives an unassigned provider the default weight of 1', () => {
    // iproyal unassigned (weight 1) vs smartproxy weight 1 too -> pure U order.
    const input = 'a.smartproxy.com:1\nb.iproyal.com:1'
    const out = weightedShuffleProxies(input, new Map(), queued([0.2, 0.8]))
    expect(out).toEqual(['b.iproyal.com:1', 'a.smartproxy.com:1'])
  })

  it('is deterministic for a given rng sequence', () => {
    const input = 'a.foo.com:1\nb.bar.com:2\nc.foo.com:3\n4.4.4.4:4'
    const weights = new Map([['foo.com', 50]])
    const a = weightedShuffleProxies(input, weights, lcg(42))
    const b = weightedShuffleProxies(input, weights, lcg(42))
    expect(a).toEqual(b)
  })

  it('drops blank lines, trims trailing whitespace, and breaks ties by input order', () => {
    // Constant rng -> equal keys -> stable order preserved via index tie-break.
    const input = 'a.foo.com:1   \n\n   \nb.bar.com:2\n'
    const out = weightedShuffleProxies(input, new Map(), () => 0.5)
    expect(out).toEqual(['a.foo.com:1', 'b.bar.com:2'])
  })

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(weightedShuffleProxies('', new Map(), () => 0.5)).toEqual([])
    expect(weightedShuffleProxies('   \n\t\n', new Map(), () => 0.5)).toEqual([])
  })
})
