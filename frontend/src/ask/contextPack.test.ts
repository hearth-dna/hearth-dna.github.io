import { describe, expect, it } from 'vitest'
import type { Finding, KbEntry } from '../kb/kb'
import type { Person } from '../types'
import { buildContextPack, type PackOptions, packStats, squeeze } from './contextPack'
import { PROMPTS } from './prompts'

const entry: KbEntry = {
  rsid: 'rs4244285',
  gene: 'CYP2C19',
  name: 'CYP2C19*2',
  risk_allele: 'A',
  orientation: 'forward',
  evidence: 'A',
  summary: 'Loss-of-function allele.',
  genotypes: { AG: { label: '*1/*2 intermediate metaboliser', magnitude: 2 } },
  sources: ['https://cpicpgx.org/x'],
  topic: 'pharmacogenomics',
  generated_by: 'human',
}
const finding: Finding = {
  entry,
  genotype: 'AG',
  call: { rsid: 'rs4244285', chromosome: '10', position: 1, a1: 'A', a2: 'G' },
  match: entry.genotypes.AG,
  riskCopies: 1,
}
const vova: Person = {
  id: 'p1',
  label: 'vova',
  displayName: 'Vova',
  sex: 'male',
  birthYear: 1984,
  notes: '',
  createdAt: 't',
}

describe('buildContextPack', () => {
  const now = new Date('2026-09-13T00:00:00Z')
  it('pseudonymises by default and is deterministic', () => {
    const pack = buildContextPack({
      question: 'Clopidogrel?',
      people: [{ person: vova, findings: [finding] }],
      realNames: false,
      now,
    })
    expect(pack).toContain('## Person A, male, about 40')
    expect(pack).not.toContain('Vova')
    expect(pack).toContain(
      '- CYP2C19 rs4244285 (CYP2C19*2): A/G — *1/*2 intermediate metaboliser [evidence A]',
    )
    expect(pack).toContain('## Question\nClopidogrel?')
    expect(pack).toMatchSnapshot()
  })
  it('uses real names and exact age when asked, and appends the template', () => {
    const pack = buildContextPack({
      question: 'q',
      people: [{ person: vova, findings: [finding] }],
      realNames: true,
      now,
      template: PROMPTS[2],
    })
    expect(pack).toContain('## Vova, male, 42')
    expect(pack).toContain(PROMPTS[2].text)
  })
  it('lists health-log entries under the person with the body indented', () => {
    const opts: PackOptions = {
      question: 'Lipids?',
      people: [
        {
          person: vova,
          findings: [],
          health: [
            {
              id: 'h1',
              personId: 'p1',
              date: '2026-05-01',
              time: '',
              kind: 'lab',
              title: 'Lipid panel',
              body: 'LDL 4.1 mmol/L (ref < 3.0)\nHDL 1.2 mmol/L',
              source: '',
              bodyPart: '',
              severity: null,
              value: null,
              value2: null,
              unit: '',
              tags: [],
              createdAt: 't',
            },
            {
              id: 'h2',
              personId: 'p1',
              date: '2026-04-20',
              time: '',
              kind: 'symptom',
              title: 'Aching hands in the morning',
              body: '',
              source: '',
              bodyPart: 'hands',
              severity: 5,
              value: null,
              value2: null,
              unit: '',
              tags: ['arthritis'],
              createdAt: 't',
            },
          ],
        },
      ],
      realNames: false,
      now,
    }
    const pack = buildContextPack(opts)
    expect(pack).toContain(
      "### Health log (the person's documents and self-reported symptoms, dated)\n- 2026-05-01 · Lab result · Lipid panel\n  LDL 4.1 mmol/L (ref < 3.0)\n  HDL 1.2 mmol/L\n- 2026-04-20 · Symptom · Aching hands in the morning (hands; severity 5/10; arthritis)",
    )
    expect(packStats(opts, pack).healthEntries).toBe(2)
  })
  it('counts genotypes for the sharing log', () => {
    const opts = { question: 'q', people: [{ person: vova, findings: [finding] }], realNames: false, now }
    const pack = buildContextPack(opts)
    expect(packStats(opts, pack)).toEqual({
      chars: pack.length,
      tokens: Math.ceil(pack.length / 4),
      genotypes: 1,
      healthEntries: 0,
    })
  })
})

describe('compact context pack', () => {
  const now = new Date('2026-09-13T00:00:00Z')
  const base = {
    personId: 'p1',
    time: '',
    source: '',
    bodyPart: '',
    severity: null,
    tags: [],
    value: null,
    value2: null,
    unit: '',
    createdAt: 't',
    body: '',
  }
  const bp = (id: string, date: string, v: number, v2: number, time = '') => ({
    ...base,
    id,
    date,
    time,
    kind: 'measurement' as const,
    title: 'Blood pressure',
    value: v,
    value2: v2,
    unit: 'mmHg',
  })
  const pack = buildContextPack({
    question: 'q',
    realNames: false,
    compact: true,
    now,
    people: [
      {
        person: vova,
        findings: [finding],
        genotypes: [{ rsid: 'rs999', chromosome: '2', position: 42, a1: 'C', a2: 'T' }],
        health: [
          bp('b2', '2026-09-10', 124, 82, '08:05'),
          {
            ...base,
            id: 'l1',
            date: '2026-09-05',
            kind: 'lab',
            title: 'Lipid panel',
            body: 'LDL 4.1 mmol/L\n\n  HDL 1.2',
          },
          bp('b1', '2026-09-01', 120, 80),
        ],
      },
    ],
  })
  it('puts each record on one line and folds a measurement series', () => {
    expect(pack).toContain(
      [
        'Genotypes:',
        '- CYP2C19 rs4244285 A/G: *1/*2 intermediate metaboliser [evidence A]',
        '- rs999 C/T (chr2:42; not in knowledge base)',
        'Health log:',
        '- Blood pressure, mmHg (2 readings): 2026-09-01 120/80; 2026-09-10 08:05 124/82',
        '- 2026-09-05 lab: Lipid panel — LDL 4.1 mmol/L; HDL 1.2',
      ].join('\n'),
    )
  })
  it('keeps one source per evidence note and can drop the notes', () => {
    expect(pack).toContain('- CYP2C19*2: Loss-of-function allele. Sources: https://cpicpgx.org/x')
    const bare = buildContextPack({
      question: 'q',
      realNames: false,
      compact: true,
      evidence: false,
      now,
      people: [{ person: vova, findings: [finding] }],
    })
    expect(bare).not.toContain('Evidence notes')
  })
  it('shortens long text', () => {
    expect(squeeze('a\n b', 10)).toBe('a; b')
    expect(squeeze('Once a day.\nAfter food', 40)).toBe('Once a day. After food')
    expect(squeeze('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
