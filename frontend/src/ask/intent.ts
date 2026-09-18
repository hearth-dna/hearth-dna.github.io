import type { Kb } from '../kb/kb'
import { BODY_PARTS } from '../types'

/**
 * What kind of question this is, from its words alone: a medication question wants
 * pharmacogenomic markers and the current medication list, a lab question wants lab results, a
 * symptom question wants recent symptoms and measurements. Rules, not a model: every type says
 * which words triggered it, so the recommendation can explain itself. Pure and local.
 */
export type QuestionType = 'medication' | 'labs' | 'symptoms' | 'family' | 'doctor' | 'report' | 'genetics'

export interface Intent {
  type: QuestionType
  /** Distinct words or phrases in the question that point to this type, in question order. */
  signals: string[]
}

/**
 * A question word matches a stem of five or more letters it starts with ("prescribed" ← "prescri"),
 * or a shorter entry exactly ("mom" must not match "moment"). Entries with a space are phrases.
 */
const SIGNALS: Record<QuestionType, string[]> = {
  medication: [
    'medicat',
    'medicine',
    'drug',
    'drugs',
    'dose',
    'doses',
    'dosage',
    'pill',
    'pills',
    'tablet',
    'prescri',
    'side effect',
    'interaction',
    'statin',
    'antidepressant',
    'painkiller',
    'antibiotic',
    'supplement',
    'metaboli',
    'taking',
    'mg',
  ],
  labs: [
    'lab',
    'labs',
    'blood test',
    'test result',
    'result',
    'cholesterol',
    'ldl',
    'hdl',
    'triglycerid',
    'glucose',
    'hba1c',
    'ferritin',
    'vitamin',
    'iron',
    'tsh',
    'crp',
    'creatinin',
    'reference range',
    'level',
    'panel',
    'trend',
  ],
  symptoms: [
    'symptom',
    'pain',
    'painful',
    'ache',
    'aches',
    'aching',
    'hurt',
    'hurts',
    'fever',
    'headache',
    'migraine',
    'tired',
    'fatigue',
    'rash',
    'cough',
    'dizzy',
    'dizziness',
    'nause',
    'swell',
    'itch',
    'itchy',
    'sleep',
    'insomnia',
    'feel',
    'feeling',
    'sore',
    'stiff',
    'temperature',
    'blood pressure',
    'weight',
  ],
  family: [
    'inherit',
    'heredit',
    'parent',
    'mother',
    'father',
    'mom',
    'dad',
    'child',
    'son',
    'sons',
    'daughter',
    'sibling',
    'brother',
    'sister',
    'family',
    'carrier',
    'pass on',
    'passed on',
    'compare',
    'both of',
    'kids',
  ],
  doctor: [
    'doctor',
    'appointment',
    'visit',
    'clinician',
    'physician',
    'specialist',
    'gp',
    'cardiologist',
    'rheumatologist',
    'what to ask',
    'questions to ask',
    'prepare',
  ],
  report: [
    'report',
    'second opinion',
    'letter',
    'diagnos',
    'conclusion',
    'discharge',
    'scan',
    'scans',
    'mri',
    'x-ray',
    'ultrasound',
  ],
  genetics: [
    'gene',
    'genes',
    'genetic',
    'variant',
    'snp',
    'snps',
    'genotype',
    'dna',
    'mutation',
    'allele',
    'risk',
    'risks',
    'predispos',
  ],
}

/** Ties go to the more specific type. */
const ORDER: QuestionType[] = ['medication', 'labs', 'symptoms', 'report', 'doctor', 'family', 'genetics']

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}*-]+/u)
    .filter(Boolean)
}

function hits(question: string, stems: string[]): string[] {
  const q = question.toLowerCase()
  const ws = words(question)
  const out: string[] = []
  for (const stem of stems) {
    const found = stem.includes(' ')
      ? q.includes(stem) && stem
      : ws.find((w) => w === stem || (stem.length >= 5 && w.startsWith(stem)))
    if (found && !out.includes(found)) out.push(found)
  }
  return out
}

/**
 * Every type the question shows signals for, strongest first. Knowledge-base names count too:
 * a drug from the kb is a medication signal, a gene symbol or rsid a genetics one, a body part a
 * symptom one. Asking about two or more selected people adds a family signal.
 */
export function classifyQuestion(question: string, kb: Kb, peopleSelected = 1): Intent[] {
  const ws = new Set(words(question))
  const extra: Record<QuestionType, string[]> = {
    medication: [],
    labs: [],
    symptoms: [],
    family: [],
    doctor: [],
    report: [],
    genetics: [],
  }
  for (const e of kb.entries) {
    for (const d of e.drugs ?? []) if (ws.has(d.toLowerCase())) extra.medication.push(d.toLowerCase())
    if (ws.has(e.gene.toLowerCase())) extra.genetics.push(e.gene)
    if (ws.has(e.rsid)) extra.genetics.push(e.rsid)
  }
  for (const w of ws) if (/^rs\d+$/.test(w) && !extra.genetics.includes(w)) extra.genetics.push(w)
  for (const b of BODY_PARTS) if (question.toLowerCase().includes(b)) extra.symptoms.push(b)
  if (peopleSelected >= 2) extra.family.push('several people')

  return ORDER.map((type) => ({
    type,
    signals: [...new Set([...hits(question, SIGNALS[type]), ...extra[type]])],
  }))
    .filter((i) => i.signals.length > 0)
    .sort((a, b) => b.signals.length - a.signals.length || ORDER.indexOf(a.type) - ORDER.indexOf(b.type))
}

/** The prompt template that fits a question type best (ids from prompts.ts). */
export const TEMPLATE_FOR: Record<QuestionType, string> = {
  medication: 'medication',
  labs: 'labs',
  symptoms: 'symptoms',
  family: 'compare',
  doctor: 'doctor',
  report: 'second-opinion',
  genetics: 'explain',
}
