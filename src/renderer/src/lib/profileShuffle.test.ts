import { describe, it, expect } from 'vitest'
import { shuffleProfiles } from './profileShuffle'
import { UNKNOWN_FORMAT_ERROR } from './profileFilter'

const REFRACT = JSON.stringify([
  { name: 'A', email: 'alice@example.com', id: 'prf-1', payment: { num: '1' } },
  { name: 'B', email: 'bob@example.com', id: 'prf-2' },
  { name: 'C', email: 'carol@example.com', id: 'prf-3' }
])

const STELLAR = JSON.stringify([
  { profileName: 'S1', email: 'one@x.com', billingAsShipping: true, payment: { cardNumber: '4111' } },
  { profileName: 'S2', email: 'two@x.com', billingAsShipping: false, payment: { cardNumber: '5111' } },
  { profileName: 'S3', email: 'three@x.com', billingAsShipping: true, payment: { cardNumber: '6111' } }
])

const SHIKARI_HEADER = 'profile_name,first_name,last_name,email,phone_num'
const SHIKARI_ROWS = [
  'P1,A,T,alice@example.com,111',
  '"P2, quoted",B,T,bob@example.com,222',
  'P3,C,T,carol@example.com,333'
]
const SHIKARI = [SHIKARI_HEADER, ...SHIKARI_ROWS].join('\n')

// A tiny deterministic PRNG so tests pin an exact ordering without Math.random.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// Feed an exact sequence of uniforms, one per Fisher-Yates step (n-1 draws).
function queued(values: number[]): () => number {
  let i = 0
  return () => values[i++] ?? 0
}

/** `name` of each JSON output element, in order. */
function namesOf(json: string): string[] {
  return (JSON.parse(json) as { name?: string; profileName?: string }[]).map(
    (p) => p.name ?? p.profileName ?? ''
  )
}

// Fisher-Yates over [A, B, C] with draws [0, 0.5]:
//   i=2: j=floor(0*3)=0   -> swap(2,0) -> [C, B, A]
//   i=1: j=floor(0.5*2)=1 -> swap(1,1) -> [C, B, A]
const DRAWS_CBA = [0, 0.5]
// Draws [0.4, 0]:
//   i=2: j=floor(0.4*3)=1 -> swap(2,1) -> [A, C, B]
//   i=1: j=floor(0*2)=0   -> swap(1,0) -> [C, A, B]
const DRAWS_CAB = [0.4, 0]

describe('shuffleProfiles, refract', () => {
  it('reorders the elements by the drawn uniforms', () => {
    const r = shuffleProfiles(REFRACT, queued(DRAWS_CBA))
    expect(r.error).toBeNull()
    expect(r.format).toBe('refract')
    expect(namesOf(r.fullOutput)).toEqual(['C', 'B', 'A'])
    expect(r.count).toBe(3)
  })

  it('keeps every element verbatim, extra keys included', () => {
    const r = shuffleProfiles(REFRACT, queued(DRAWS_CAB))
    const out = JSON.parse(r.fullOutput) as unknown[]
    const src = JSON.parse(REFRACT) as unknown[]
    expect(out).toEqual([src[2], src[0], src[1]])
  })

  it('unwraps a {profiles: [...]} wrapper to a bare array', () => {
    const wrapped = JSON.stringify({ profiles: JSON.parse(REFRACT) })
    const r = shuffleProfiles(wrapped, queued(DRAWS_CBA))
    expect(r.error).toBeNull()
    expect(namesOf(r.fullOutput)).toEqual(['C', 'B', 'A'])
  })

  it('leaves an empty array empty', () => {
    const r = shuffleProfiles('[]')
    expect(r.error).toBeNull()
    expect(r.fullOutput).toBe('[]')
    expect(r.count).toBe(0)
  })

  it('leaves a single profile alone', () => {
    const one = JSON.stringify([{ name: 'Only', email: 'o@x.com' }])
    const r = shuffleProfiles(one)
    expect(r.fullOutput).toBe(one)
    expect(r.count).toBe(1)
  })
})

describe('shuffleProfiles, stellar', () => {
  it('detects stellar and reorders the elements', () => {
    const r = shuffleProfiles(STELLAR, queued(DRAWS_CAB))
    expect(r.error).toBeNull()
    expect(r.format).toBe('stellar')
    expect(namesOf(r.fullOutput)).toEqual(['S3', 'S1', 'S2'])
    expect(r.count).toBe(3)
  })
})

describe('shuffleProfiles, shikari', () => {
  it('keeps the header first and reorders the raw rows', () => {
    const r = shuffleProfiles(SHIKARI, queued(DRAWS_CBA))
    expect(r.error).toBeNull()
    expect(r.format).toBe('shikari')
    expect(r.fullOutput.split('\n')).toEqual([
      SHIKARI_HEADER,
      SHIKARI_ROWS[2],
      SHIKARI_ROWS[1],
      SHIKARI_ROWS[0]
    ])
    expect(r.count).toBe(3)
  })

  it('drops blank lines and a BOM, keeping the rest', () => {
    const messy = '﻿\n' + SHIKARI_HEADER + '\r\n' + SHIKARI_ROWS[0] + '\r\n\r\n' + SHIKARI_ROWS[1] + '\n\n'
    const r = shuffleProfiles(messy, queued([0.9]))
    expect(r.error).toBeNull()
    // i=1: j=floor(0.9*2)=1 -> swap(1,1): order unchanged.
    expect(r.fullOutput.split('\n')).toEqual([SHIKARI_HEADER, SHIKARI_ROWS[0], SHIKARI_ROWS[1]])
    expect(r.count).toBe(2)
  })

  it('leaves a header-only CSV as just the header', () => {
    const r = shuffleProfiles(SHIKARI_HEADER)
    expect(r.error).toBeNull()
    expect(r.fullOutput).toBe(SHIKARI_HEADER)
    expect(r.count).toBe(0)
  })
})

describe('shuffleProfiles, permutation', () => {
  it('keeps every entry exactly once across formats', () => {
    const big = JSON.stringify(
      Array.from({ length: 50 }, (_, i) => ({ name: `N${i}`, email: `e${i}@x.com` }))
    )
    const r = shuffleProfiles(big, lcg(42))
    const names = namesOf(r.fullOutput)
    expect(names.length).toBe(50)
    expect([...names].sort()).toEqual(namesOf(big).sort())
    // A 50-element list landing back in source order would mean no shuffle ran.
    expect(names).not.toEqual(namesOf(big))
  })
})

describe('shuffleProfiles, errors', () => {
  it('reports the format hint for empty or whitespace input', () => {
    for (const text of ['', '   \n\t']) {
      const r = shuffleProfiles(text)
      expect(r.format).toBe('unknown')
      expect(r.error).toBe(UNKNOWN_FORMAT_ERROR)
      expect(r.fullOutput).toBe('')
      expect(r.count).toBe(0)
    }
  })

  it('reports invalid JSON', () => {
    const r = shuffleProfiles('[{"name": ')
    expect(r.format).toBe('refract')
    expect(r.error).toMatch(/^Invalid JSON/)
    expect(r.fullOutput).toBe('')
  })

  it('reports JSON that is not a profile array', () => {
    const r = shuffleProfiles('{"hello": 1}')
    expect(r.error).toBe('Expected a JSON array of profiles.')
  })

  it('reports a CSV with no email column', () => {
    const r = shuffleProfiles('a,b,c\n1,2,3')
    expect(r.format).toBe('shikari')
    expect(r.error).toBe('No email column found in the CSV header.')
    expect(r.fullOutput).toBe('')
  })
})
