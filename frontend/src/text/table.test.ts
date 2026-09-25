import { describe, expect, it } from 'vitest'
import { guessDelimiter, parseTable, splitCells } from './table'

describe('delimited tables', () => {
  it('keeps quoted delimiters and doubled quotes', () => {
    expect(splitCells('a,"b, c","say ""hi""",d', ',')).toEqual(['a', 'b, c', 'say "hi"', 'd'])
  })
  it('prefers the semicolon of a decimal-comma export', () => {
    expect(guessDelimiter(['Date;Weight', '01.03.2025;3,40', '01.04.2025;4,25'])).toBe(';')
    expect(guessDelimiter(['a\tb\tc', '1\t2\t3'])).toBe('\t')
  })
  it('drops a BOM and blank lines and pads short rows', () => {
    expect(parseTable('﻿Date,Weight,Note\r\n\r\n2026-01-01,70\r\n')).toEqual({
      header: ['Date', 'Weight', 'Note'],
      rows: [['2026-01-01', '70', '']],
      delimiter: ',',
    })
  })
})
