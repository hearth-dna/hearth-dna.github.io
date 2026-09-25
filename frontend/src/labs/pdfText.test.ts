import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import type { Kb } from '../kb/kb'
import { parseLabText } from './parseText'
import { linesFromItems, type TextItem } from './pdfText'

const kb = JSON.parse(readFileSync(`${__dirname}/../../public/kb.json`, 'utf8')) as Kb

/**
 * A one-page PDF whose text layer holds `rows` as columns at the given x positions, the way lab
 * systems print a result table. Built here so no binary fixture is needed; ASCII and Helvetica only.
 */
function tablePdf(rows: string[][], xs = [50, 250, 330, 430]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`)
  const ops = rows.flatMap((cells, i) =>
    cells.map((c, j) => `BT /F1 10 Tf ${xs[j]} ${780 - i * 16} Td (${esc(c)}) Tj ET`),
  )
  const stream = ops.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

async function items(bytes: Uint8Array): Promise<TextItem[]> {
  const task = getDocument({ data: bytes, disableFontFace: true, useWorkerFetch: false, verbosity: 0 })
  const content = await (await (await task.promise).getPage(1)).getTextContent()
  await task.destroy()
  return content.items.filter((i) => 'str' in i) as TextItem[]
}

describe('linesFromItems', () => {
  it('joins items on one baseline, left to right, with a tab across a column gap', () => {
    const it = (str: string, x: number, y: number): TextItem => ({
      str,
      transform: [10, 0, 0, 10, x, y],
      width: str.length * 5,
    })
    expect(
      linesFromItems([
        it('6.1', 250, 700),
        it('Glucose', 50, 700),
        it('HbA1c', 50, 684),
        it('5.9', 250, 684.5),
      ]),
    ).toEqual(['Glucose\t6.1', 'HbA1c\t5.9'])
  })
})

describe('a text PDF, read locally', () => {
  it('becomes the same rows as the text it prints', async () => {
    const pdf = tablePdf([
      ['LIPID PANEL'],
      ['Collected: 2026-09-19'],
      ['Test', 'Result', 'Units', 'Reference'],
      ['Cholesterol, total', '5.9', 'mmol/L', '< 5.2'],
      ['LDL cholesterol', '3.9 H', 'mmol/L', '< 3.0'],
      ['HDL cholesterol', '1.4', 'mmol/L', '> 1.0'],
      ['Triglycerides', '1.3', 'mmol/L', '< 1.7'],
    ])
    const text = linesFromItems(await items(pdf)).join('\n')
    expect(text.split('\n')[3]).toBe('Cholesterol, total\t5.9\tmmol/L\t< 5.2')
    const { draft } = parseLabText(kb, text)
    expect(draft).toMatchObject({ date: '2026-09-19', panel: 'lipid' })
    expect(draft.rows.map((r) => [r.analyte, r.value, r.flag])).toEqual([
      ['chol_total', 5.9, 'H'],
      ['ldl', 3.9, 'H'],
      ['hdl', 1.4, ''],
      ['tg', 1.3, ''],
    ])
  })
})
