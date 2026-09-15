import { describe, expect, it } from 'vitest'
import type { Finding, KbEntry } from '../kb/kb'
import type { Person } from '../types'
import { buildContextPack, packStats } from './contextPack'
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
    const pack = buildContextPack({
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
    })
    expect(pack).toContain(
      "### Health log (the person's documents and self-reported symptoms, dated)\n- 2026-05-01 · Lab result · Lipid panel\n  LDL 4.1 mmol/L (ref < 3.0)\n  HDL 1.2 mmol/L\n- 2026-04-20 · Symptom · Aching hands in the morning (hands; severity 5/10; arthritis)",
    )
    expect(packStats(pack).healthEntries).toBe(2)
  })
  it('counts genotypes for the sharing log', () => {
    const pack = buildContextPack({
      question: 'q',
      people: [{ person: vova, findings: [finding] }],
      realNames: false,
      now,
    })
    expect(packStats(pack).genotypes).toBe(1)
  })
})
