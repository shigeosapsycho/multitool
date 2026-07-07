import { describe, expect, it } from 'vitest'
import { deleteProgressBanner, deleteProgressButton } from './deleteProgress'

// Expected values are built with the same toLocaleString() the helpers use,
// so the assertions hold under any system locale.
const f = (n: number) => n.toLocaleString()

describe('deleteProgressBanner', () => {
  it('uses permanent wording when permanent', () => {
    expect(deleteProgressBanner(true, 500, 2000)).toBe(
      `Permanently deleting ${f(500)} of ${f(2000)}…`
    )
  })

  it('uses trash wording when not permanent', () => {
    expect(deleteProgressBanner(false, 0, 12)).toBe(`Moving ${f(0)} of ${f(12)} to Trash…`)
  })
})

describe('deleteProgressButton', () => {
  it('formats both counts', () => {
    expect(deleteProgressButton(1500, 10000)).toBe(`Deleting ${f(1500)} of ${f(10000)}…`)
  })
})
