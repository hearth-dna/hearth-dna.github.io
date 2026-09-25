import type { HealthEntryInput } from '../db/repo'
import type { Kb } from '../kb/kb'
import { labCatalogue } from './normalise'
import type { LabReportDraft, LabRow } from './types'

/** The test's name in the UI language (English when the catalogue has none), or as printed. */
export function labTitle(kb: Kb, row: Pick<LabRow, 'analyte' | 'printedName'>, lang: string): string {
  const a = row.analyte ? labCatalogue(kb).byId.get(row.analyte) : undefined
  return a ? (a.names[lang] ?? a.names.en) : row.printedName
}

/**
 * Reviewed rows → one `lab` health-log entry each. The value and unit are kept as printed (in
 * the unit's canonical spelling), never converted: the paper is the record. The body keeps the
 * printed line, so a wrong reading can always be traced back.
 */
export function labEntries(
  kb: Kb,
  draft: LabReportDraft,
  rows: LabRow[],
  o: { personId: string; source: string; lang: string; fallbackDate: string },
): HealthEntryInput[] {
  return rows.map((r) => {
    const printed = [
      `${r.printedName}: ${r.printedValue}${r.printedUnit ? ` ${r.printedUnit}` : ''}`,
      r.printedRef ? ` (ref ${r.printedRef})` : '',
      r.printedFlag ? ` ${r.printedFlag}` : '',
    ].join('')
    return {
      personId: o.personId,
      date: draft.date || o.fallbackDate,
      time: draft.time,
      kind: 'lab',
      title: labTitle(kb, r, o.lang),
      body: [r.section, `As printed: ${printed}`].filter(Boolean).join('\n'),
      source: o.source,
      value: r.value,
      valueText: r.text || (r.comparator ? r.printedValue : ''),
      unit: r.unit || r.printedUnit,
      analyte: r.analyte ?? '',
      refLow: r.refLow,
      refHigh: r.refHigh,
      flag: r.flag,
    }
  })
}
