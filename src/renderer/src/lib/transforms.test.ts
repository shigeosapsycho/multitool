import { describe, it, expect } from 'vitest'
import { searchInMaster } from './transforms'

describe('searchInMaster', () => {
  it('still matches a search item that is the whole master line', () => {
    expect(searchInMaster('a:1\nb:2\nc:3', 'b:2\nz:9')).toEqual(['b:2'])
  })

  it('returns the full master line for a partial search item', () => {
    expect(searchInMaster('alice@x.com:pw1\nbob@x.com:pw2', 'bob@x.com')).toEqual([
      'bob@x.com:pw2'
    ])
  })

  it('matches any field, not just the first', () => {
    expect(searchInMaster('alice:hunter2\nbob:other', 'hunter2')).toEqual(['alice:hunter2'])
  })

  it('splits on ; , | as well as colon', () => {
    expect(searchInMaster('a;1\nb,2\nc|3', '1\n2\n3')).toEqual(['a;1', 'b,2', 'c|3'])
  })

  it('does not match a prefix or substring of a field', () => {
    expect(searchInMaster('alicia:pw\nalice2:pw', 'alice')).toEqual([])
  })

  it('returns every master line a search item hits', () => {
    expect(searchInMaster('alice:pw1\nbob:x\nalice:pw2', 'alice')).toEqual([
      'alice:pw1',
      'alice:pw2'
    ])
  })

  it('orders by the search list, then master order', () => {
    expect(searchInMaster('a:1\nb:2\nc:3', 'c\na')).toEqual(['c:3', 'a:1'])
  })

  it('lists a master line once however many search items hit it', () => {
    expect(searchInMaster('alice:pw', 'alice\npw\nalice:pw')).toEqual(['alice:pw'])
  })

  it('lists a repeated master line once', () => {
    expect(searchInMaster('a:1\na:1', 'a')).toEqual(['a:1'])
  })

  it('returns nothing when no search item is found', () => {
    expect(searchInMaster('a:1', 'z')).toEqual([])
  })
})
