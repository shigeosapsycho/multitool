import { describe, it, expect } from 'vitest'
import { detectFormat, detectSet, formatSkuNames, formatSkus, moveSkuToIndex } from './targetSkus'

describe('moveSkuToIndex', () => {
  const base = () => ['a', 'b', 'c', 'd', 'e']

  it('moves a SKU to the top (position 1)', () => {
    expect(moveSkuToIndex(base(), 'c', 1)).toEqual(['c', 'a', 'b', 'd', 'e'])
  })

  it('moves a SKU to the bottom (position = length)', () => {
    expect(moveSkuToIndex(base(), 'c', 5)).toEqual(['a', 'b', 'd', 'e', 'c'])
  })

  it('moves a SKU forward to a middle position', () => {
    expect(moveSkuToIndex(base(), 'a', 3)).toEqual(['b', 'c', 'a', 'd', 'e'])
  })

  it('moves a SKU backward to a middle position', () => {
    expect(moveSkuToIndex(base(), 'e', 2)).toEqual(['a', 'e', 'b', 'c', 'd'])
  })

  it('clamps a position past the end to the last slot', () => {
    expect(moveSkuToIndex(base(), 'b', 99)).toEqual(['a', 'c', 'd', 'e', 'b'])
  })

  it('is a no-op when the SKU is already at the target position', () => {
    expect(moveSkuToIndex(base(), 'b', 2)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns the list unchanged for a position below 1', () => {
    expect(moveSkuToIndex(base(), 'b', 0)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns the list unchanged for a non-numeric position', () => {
    expect(moveSkuToIndex(base(), 'b', NaN)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('returns the list unchanged when the SKU is not present', () => {
    expect(moveSkuToIndex(base(), 'z', 2)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('does not mutate the input array', () => {
    const input = base()
    moveSkuToIndex(input, 'a', 4)
    expect(input).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('formatSkus and detectFormat', () => {
  const SKUS = ['111', '222', '333']

  it('joins Shikari with comma+space and Valor with a bare comma', () => {
    expect(formatSkus(SKUS, 'shikari')).toBe('111, 222, 333')
    expect(formatSkus(SKUS, 'valor')).toBe('111,222,333')
  })

  it('detects Valor from a comma list with no spaces', () => {
    expect(detectFormat('111,222,333')).toBe('valor')
  })

  it('detects Shikari when any comma is followed by whitespace', () => {
    expect(detectFormat('111, 222, 333')).toBe('shikari')
    expect(detectFormat('111,222, 333')).toBe('shikari')
  })

  it('keeps Stellar and Refract detection', () => {
    expect(detectFormat('111;;\n222;;')).toBe('stellar')
    expect(detectFormat('111\n222')).toBe('refract')
  })

  it('round-trips each comma format through detectFormat', () => {
    for (const fmt of ['shikari', 'valor'] as const) {
      expect(detectFormat(formatSkus(SKUS, fmt))).toBe(fmt)
    }
  })
})

describe('formatSkuNames', () => {
  const SKUS = ['88897904', '89444928']
  const NAMES: Record<string, string> = {
    '88897904': 'Scarlet Violet - 151 Booster Bundle',
    '89444928': 'Scarlet & Violet- 151 Poster Collection'
  }
  const nameOf = (sku: string) => NAMES[sku] ?? ''

  it('writes one "sku - name" line per SKU and nothing else', () => {
    expect(formatSkuNames(SKUS, nameOf)).toBe(
      [
        '88897904 - Scarlet Violet - 151 Booster Bundle',
        '89444928 - Scarlet & Violet- 151 Poster Collection'
      ].join('\n')
    )
  })

  it('carries no export list, separator, or trailing newline', () => {
    const out = formatSkuNames(SKUS, nameOf)
    expect(out.split('\n')).toHaveLength(2)
    expect(out).not.toContain(', ')
    expect(out).not.toContain(';;')
    expect(out.endsWith('\n')).toBe(false)
  })

  it('follows the given order rather than sorting', () => {
    expect(formatSkuNames(['89444928', '88897904'], nameOf).split('\n')).toEqual([
      '89444928 - Scarlet & Violet- 151 Poster Collection',
      '88897904 - Scarlet Violet - 151 Booster Bundle'
    ])
  })

  it('writes a bare SKU line when the catalog has no name for it', () => {
    expect(formatSkuNames(['99999999'], nameOf)).toBe('99999999')
  })

  it('trims a whitespace-only name down to the bare SKU line', () => {
    expect(formatSkuNames(['99999999'], () => '   ')).toBe('99999999')
  })

  it('trims surrounding whitespace off a real name', () => {
    expect(formatSkuNames(['88897904'], () => '  Booster Bundle  ')).toBe(
      '88897904 - Booster Bundle'
    )
  })

  it('returns an empty string for an empty list', () => {
    expect(formatSkuNames([], nameOf)).toBe('')
  })
})

describe('detectSet', () => {
  it('files Delta Reign under the Mega Evolution era, not the base set', () => {
    const title = 'Pokémon Trading Card Game: Mega Evolution—Delta Reign Elite Trainer Box'
    expect(detectSet(title)).toEqual({ set: 'Delta Reign', era: 'Mega Evolution Era' })
  })
})
