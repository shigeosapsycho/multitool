import { describe, expect, it } from 'vitest'
import { buildFilteredCsv, csvColumnLabel, escapeCsvField, parseCsv } from './csvFilter'

describe('parseCsv', () => {
  it('splits headers and rows', () => {
    const out = parseCsv('name,email,age\nann,a@x.com,30\nbob,b@x.com,41')
    expect(out.headers).toEqual(['name', 'email', 'age'])
    expect(out.rows).toEqual([
      ['ann', 'a@x.com', '30'],
      ['bob', 'b@x.com', '41']
    ])
  })

  it('handles CRLF line endings', () => {
    const out = parseCsv('a,b\r\n1,2\r\n')
    expect(out.headers).toEqual(['a', 'b'])
    expect(out.rows).toEqual([['1', '2']])
  })

  it('keeps commas inside quoted fields', () => {
    const out = parseCsv('name,address\nann,"1 Main St, Springfield"')
    expect(out.rows).toEqual([['ann', '1 Main St, Springfield']])
  })

  it('unescapes doubled quotes inside quoted fields', () => {
    const out = parseCsv('q\n"say ""hi"""')
    expect(out.rows).toEqual([['say "hi"']])
  })

  it('keeps newlines inside quoted fields', () => {
    const out = parseCsv('note,id\n"line one\nline two",7')
    expect(out.rows).toEqual([['line one\nline two', '7']])
  })

  it('drops blank lines and all-empty rows', () => {
    const out = parseCsv('a,b\n\n1,2\n,,\n\n')
    expect(out.rows).toEqual([['1', '2']])
  })

  it('returns empty for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
    expect(parseCsv('\n\n')).toEqual({ headers: [], rows: [] })
  })

  it('keeps short rows short (no padding)', () => {
    const out = parseCsv('a,b,c\n1,2')
    expect(out.rows).toEqual([['1', '2']])
  })
})

describe('csvColumnLabel', () => {
  it('uses the header text when present', () => {
    expect(csvColumnLabel('Email', 0)).toBe('Email')
  })

  it('falls back to the position for blank headers', () => {
    expect(csvColumnLabel('', 2)).toBe('Column 3')
    expect(csvColumnLabel('   ', 0)).toBe('Column 1')
  })
})

describe('escapeCsvField', () => {
  it('leaves plain values alone', () => {
    expect(escapeCsvField('hello', ',')).toBe('hello')
  })

  it('quotes values containing the separator', () => {
    expect(escapeCsvField('a,b', ',')).toBe('"a,b"')
    expect(escapeCsvField('a|b', '|')).toBe('"a|b"')
  })

  it('does not quote a comma when the separator is something else', () => {
    expect(escapeCsvField('a,b', '|')).toBe('a,b')
  })

  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsvField('say "hi"', ',')).toBe('"say ""hi"""')
  })

  it('quotes values containing newlines', () => {
    expect(escapeCsvField('a\nb', ',')).toBe('"a\nb"')
  })

  it('handles an empty separator without quoting everything', () => {
    expect(escapeCsvField('plain', '')).toBe('plain')
  })
})

describe('buildFilteredCsv', () => {
  const parsed = parseCsv('name,email,age\nann,a@x.com,30\nbob,b@x.com,41')

  it('keeps only the selected columns, in the given order', () => {
    expect(buildFilteredCsv(parsed, [1, 0], ',')).toEqual([
      'email,name',
      'a@x.com,ann',
      'b@x.com,bob'
    ])
  })

  it('joins with a custom separator', () => {
    expect(buildFilteredCsv(parsed, [0, 2], ' | ')).toEqual([
      'name | age',
      'ann | 30',
      'bob | 41'
    ])
  })

  it('joins with tab', () => {
    expect(buildFilteredCsv(parsed, [0, 1], '\t')).toEqual([
      'name\temail',
      'ann\ta@x.com',
      'bob\tb@x.com'
    ])
  })

  it('re-escapes fields that contain the new separator', () => {
    const p = parseCsv('id,note\n1,"semi;colon"')
    expect(buildFilteredCsv(p, [0, 1], ';')).toEqual(['id;note', '1;"semi;colon"'])
  })

  it('unquotes fields that no longer need quoting under the new separator', () => {
    const p = parseCsv('id,address\n1,"1 Main St, Springfield"')
    expect(buildFilteredCsv(p, [1], '|')).toEqual(['address', '1 Main St, Springfield'])
  })

  it('fills missing cells from short rows with empty fields', () => {
    const p = parseCsv('a,b,c\n1,2')
    expect(buildFilteredCsv(p, [0, 2], ',')).toEqual(['a,c', '1,'])
  })

  it('returns nothing when no columns are selected or input is empty', () => {
    expect(buildFilteredCsv(parsed, [], ',')).toEqual([])
    expect(buildFilteredCsv(parseCsv(''), [0], ',')).toEqual([])
  })
})
