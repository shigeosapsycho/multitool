import { describe, it, expect } from 'vitest'
import { removeFromList, type RemoveFromListOptions } from './removeFromList'

const LOOSE: RemoveFromListOptions = { caseSensitive: false, ignoreSpacing: true, match: 'line' }
const STRICT: RemoveFromListOptions = { caseSensitive: true, ignoreSpacing: false, match: 'line' }

function kept(master: string, remove: string, opts: RemoveFromListOptions): string[] {
  return removeFromList(master, remove, opts).kept
}

describe('removeFromList', () => {
  it('drops every master line that appears in the remove list', () => {
    const master = 'a@x.com\nb@x.com\nc@x.com\nd@x.com'
    const remove = 'b@x.com\nd@x.com'
    expect(kept(master, remove, LOOSE)).toEqual(['a@x.com', 'c@x.com'])
  })

  it('keeps master order and every copy of a kept duplicate', () => {
    expect(kept('c\na\nb\na\nc', 'b', LOOSE)).toEqual(['c', 'a', 'a', 'c'])
  })

  it('removes every copy of a removed duplicate', () => {
    expect(kept('a\nb\na\na', 'a', LOOSE)).toEqual(['b'])
  })

  it('returns the whole master when nothing matches', () => {
    expect(kept('a\nb', 'z', LOOSE)).toEqual(['a', 'b'])
  })

  it('returns an empty list when everything matches', () => {
    expect(kept('a\nb', 'b\na', LOOSE)).toEqual([])
  })

  it('never adds remove-list entries to the output', () => {
    expect(kept('a\nb', 'b\nc\nd', LOOSE)).toEqual(['a'])
  })

  it('handles CRLF line endings in either list', () => {
    expect(kept('a\r\nb\r\nc\r\n', 'b\r\n', STRICT)).toEqual(['a', 'c'])
  })

  it('drops blank and whitespace-only lines in either list', () => {
    expect(kept('a\n\n   \nb\n', '\n  \n', STRICT)).toEqual(['a', 'b'])
  })

  it('ignores a leading BOM on either list', () => {
    expect(kept('﻿a\nb', '﻿a', STRICT)).toEqual(['b'])
  })

  it('returns kept master lines verbatim, never normalized', () => {
    expect(kept('  Keep Me  \nDrop', 'drop', LOOSE)).toEqual(['  Keep Me  '])
  })

  it('returns the master minus blanks when the remove list is empty', () => {
    expect(removeFromList('a\n\nb', '', LOOSE)).toEqual({ kept: ['a', 'b'], unused: [] })
  })

  describe('case sensitivity', () => {
    const master = 'Alice@X.com\nbob@x.com\nCAROL@x.com'
    const remove = 'alice@x.com\ncarol@X.COM'

    it('matches regardless of case when off', () => {
      expect(kept(master, remove, LOOSE)).toEqual(['bob@x.com'])
    })

    it('requires an exact case match when on', () => {
      const on = { ...LOOSE, caseSensitive: true }
      expect(kept(master, remove, on)).toEqual(['Alice@X.com', 'bob@x.com', 'CAROL@x.com'])
      expect(kept(master, 'Alice@X.com', on)).toEqual(['bob@x.com', 'CAROL@x.com'])
    })
  })

  describe('spacing', () => {
    const master = '  john doe  \njane\tsmith\nbob lee\nann marie'
    const remove = 'johndoe\njane smith\nbob  lee\n ann marie'

    it('ignores every space and tab, inside the line too, when on', () => {
      expect(kept(master, remove, LOOSE)).toEqual([])
    })

    it('ignores non-breaking spaces when on', () => {
      expect(kept('a b', 'ab', LOOSE)).toEqual([])
    })

    it('compares lines exactly as typed when off', () => {
      const off = { ...LOOSE, ignoreSpacing: false }
      expect(kept(master, remove, off)).toEqual(['  john doe  ', 'jane\tsmith', 'bob lee', 'ann marie'])
    })

    it('still removes an exact match, leading and trailing spaces included, when off', () => {
      const off = { ...LOOSE, ignoreSpacing: false }
      expect(kept(master, '  john doe  \nbob lee', off)).toEqual(['jane\tsmith', 'ann marie'])
    })

    it('combines with case: both loose removes, both strict keeps', () => {
      expect(kept('Hello World', 'helloworld', LOOSE)).toEqual([])
      expect(kept('Hello World', 'helloworld', STRICT)).toEqual(['Hello World'])
    })
  })

  describe('match: line', () => {
    it('matches whole lines only, never a part of one', () => {
      const master = 'john:pass1\njohnny@x.com\nhello world'
      expect(kept(master, 'john\nworld', LOOSE)).toEqual(['john:pass1', 'johnny@x.com', 'hello world'])
    })
  })

  describe('match: field', () => {
    const FIELD: RemoveFromListOptions = { ...LOOSE, match: 'field' }

    it('removes user:pass rows when the remove list holds just the usernames', () => {
      const master = 'alice:pw1\nbob:pw2\ncarol:pw3'
      expect(kept(master, 'alice\ncarol', FIELD)).toEqual(['bob:pw2'])
    })

    it('matches a whole field, never a prefix of one', () => {
      expect(kept('john:pw\njohnny:pw', 'john', FIELD)).toEqual(['johnny:pw'])
    })

    it('matches any field, not just the first', () => {
      expect(kept('alice:hunter2\nbob:secret', 'secret', FIELD)).toEqual(['alice:hunter2'])
    })

    it('splits on colon, semicolon, comma, pipe, and tab', () => {
      const master = 'a:1\nb;2\nc,3\nd|4\ne\t5\nf 6'
      expect(kept(master, 'a\nb\nc\nd\ne\nf', FIELD)).toEqual(['f 6'])
    })

    it('still matches a whole line that contains delimiters', () => {
      expect(kept('alice:pw1\nbob:pw2', 'alice:pw1', FIELD)).toEqual(['bob:pw2'])
    })

    it('applies case and spacing rules to each field', () => {
      expect(kept('Alice : pw', 'alice', FIELD)).toEqual([])
      expect(kept('Alice : pw', 'alice', { ...FIELD, caseSensitive: true })).toEqual(['Alice : pw'])
      expect(kept('Alice : pw', 'Alice', { ...FIELD, ignoreSpacing: false })).toEqual([
        'Alice : pw'
      ])
    })
  })

  describe('match: contains', () => {
    const CONTAINS: RemoveFromListOptions = { ...LOOSE, match: 'contains' }

    it('removes any line containing an entry anywhere', () => {
      const master = 'a@gmail.com\nb@yahoo.com\nc@gmail.com:pw'
      expect(kept(master, '@gmail.com', CONTAINS)).toEqual(['b@yahoo.com'])
    })

    it('catches prefixes too, unlike field mode', () => {
      expect(kept('john:pw\njohnny:pw\nbob:pw', 'john', CONTAINS)).toEqual(['bob:pw'])
    })

    it('applies case and spacing rules to the search', () => {
      expect(kept('Hello World', 'o w', CONTAINS)).toEqual([])
      expect(kept('Hello World', 'O W', { ...CONTAINS, caseSensitive: true })).toEqual([
        'Hello World'
      ])
      expect(kept('Hello World', 'ow', { ...CONTAINS, ignoreSpacing: false })).toEqual([
        'Hello World'
      ])
    })
  })

  describe('unused entries', () => {
    it('lists remove-list entries that matched no master line', () => {
      const out = removeFromList('a\nb\nc', 'b\nx\ny', LOOSE)
      expect(out.kept).toEqual(['a', 'c'])
      expect(out.unused).toEqual(['x', 'y'])
    })

    it('is empty when every entry was used', () => {
      expect(removeFromList('a\nb', 'a\nb', LOOSE).unused).toEqual([])
    })

    it('keeps the first spelling and lists a repeated entry once', () => {
      expect(removeFromList('a', 'Zed\nzed\n ZED', LOOSE).unused).toEqual(['Zed'])
    })

    it('counts an entry as used when it matched a field', () => {
      const out = removeFromList('alice:pw\nbob:pw', 'alice\npw\ncarol', { ...LOOSE, match: 'field' })
      expect(out.unused).toEqual(['carol'])
    })

    it('counts every entry a contains-mode line matched, not only the first', () => {
      const out = removeFromList('foo bar baz', 'foo\nbaz\nqux', { ...LOOSE, match: 'contains' })
      expect(out.kept).toEqual([])
      expect(out.unused).toEqual(['qux'])
    })
  })
})
