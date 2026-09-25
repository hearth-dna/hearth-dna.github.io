#!/usr/bin/env python3
"""Build frontend/public/kb.json from kb/reviewed/*.json.

`reviewed/conditions.json` is the condition catalogue: one id per condition with names, synonyms,
ICD-10 codes and the lab tests, measurements, symptoms and drugs that belong to it. Marker entries
name conditions by id; the build checks every id and links markers and conditions both ways.

`reviewed/labs/` is the lab catalogue the document reader maps printed results onto: analytes
(one id per test, with LOINC codes, names and printed abbreviations, a canonical unit and the
factors from every other accepted unit), panels (named groups such as a complete blood count) and
units (printed spellings of each canonical unit). Conditions name their lab tests by analyte id.

The reviewed files are hand-curated (evidence grades follow family_dna's CLINICAL_PRIORITY.MD:
A = guideline/replicated, B = replicated association, C = preliminary). Genotype keys are on the
forward strand and are normalised to sorted allele order so lookups are orientation-free.
"""
import glob
import hashlib
import json
import os
import sys
from datetime import date

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, '..', 'frontend', 'public', 'kb.json')
CONDITIONS = os.path.join(ROOT, 'reviewed', 'conditions.json')
LABS = os.path.join(ROOT, 'reviewed', 'labs')
ANALYTE_KEYS = ('id', 'names', 'panels', 'specimen', 'unit', 'units', 'plausible', 'decimals')
CONVERSIONS = {'hba1c'}  # non-linear conversions implemented in frontend/src/labs/normalise.ts
CONDITION_KEYS = ('id', 'names', 'category', 'rsids', 'labs', 'measurements', 'symptoms', 'body_parts', 'drugs')


def norm_gt(gt: str) -> str:
    return ''.join(sorted(gt.upper()))


def fail(msg: str) -> int:
    print(msg, file=sys.stderr)
    return 1


def load_conditions() -> list:
    with open(CONDITIONS, encoding='utf-8') as f:
        conditions = json.load(f)['conditions']
    for c in conditions:
        for k in CONDITION_KEYS:
            if k not in c:
                raise ValueError(f'condition {c.get("id")}: missing {k}')
        if not c['names'].get('en'):
            raise ValueError(f'condition {c["id"]}: names.en is required')
    ids = [c['id'] for c in conditions]
    if len(ids) != len(set(ids)):
        raise ValueError('duplicate condition id')
    return conditions


def load_labs() -> tuple:
    def read(name: str) -> list:
        with open(os.path.join(LABS, f'{name}.json'), encoding='utf-8') as f:
            return json.load(f)[name]

    units, panels, analytes = read('units'), read('panels'), read('analytes')
    unit_ids = {u['id'] for u in units}
    seen_alias = {}
    for u in units:
        for alias in u['aliases']:
            if seen_alias.setdefault(alias, u['id']) != u['id']:
                raise ValueError(f'unit alias {alias} belongs to {seen_alias[alias]} and {u["id"]}')
    panel_ids = {p['id'] for p in panels}
    ids = set()
    for a in analytes:
        for k in ANALYTE_KEYS:
            if k not in a:
                raise ValueError(f'analyte {a.get("id")}: missing {k}')
        if a['id'] in ids:
            raise ValueError(f'duplicate analyte {a["id"]}')
        ids.add(a['id'])
        if not a['names'].get('en'):
            raise ValueError(f'analyte {a["id"]}: names.en is required')
        for unit in [a['unit'], *a['units']]:
            if unit not in unit_ids:
                raise ValueError(f'analyte {a["id"]}: unknown unit {unit}')
        # A factor multiplies a value in that unit into the canonical one; null accepts the unit
        # as printed with no exact conversion (Lp(a) mg/dL ↔ nmol/L depends on the isoform).
        for unit, factor in a['units'].items():
            if factor is not None and not factor > 0:
                raise ValueError(f'analyte {a["id"]}: factor for {unit} must be positive')
        if a.get('convert') and a['convert'] not in CONVERSIONS:
            raise ValueError(f'analyte {a["id"]}: unknown conversion {a["convert"]}')
        lo, hi = a['plausible']
        if not lo < hi:
            raise ValueError(f'analyte {a["id"]}: plausible range must be low < high')
        for p in a['panels']:
            if p not in panel_ids:
                raise ValueError(f'analyte {a["id"]}: unknown panel {p}')
    return units, panels, analytes


def main() -> int:
    entries = []
    topics = {}
    try:
        conditions = load_conditions()
    except ValueError as e:
        return fail(f'{CONDITIONS}: {e}')
    try:
        units, panels, analytes = load_labs()
    except ValueError as e:
        return fail(f'{LABS}: {e}')
    analyte_ids = {a['id'] for a in analytes}
    for c in conditions:
        for lab in c['labs']:
            if lab not in analyte_ids:
                return fail(f'condition {c["id"]}: unknown lab {lab}')
    for path in sorted(glob.glob(os.path.join(ROOT, 'reviewed', '*.json'))):
        if path == CONDITIONS:
            continue
        with open(path, encoding='utf-8') as f:
            doc = json.load(f)
        topics[doc['topic']] = {'id': doc['topic'], 'category': doc['category']}
        for e in doc['entries']:
            for k in ('rsid', 'gene', 'name', 'risk_allele', 'evidence', 'summary', 'genotypes', 'sources'):
                if k not in e:
                    print(f'{path}: {e.get("rsid")} missing {k}', file=sys.stderr)
                    return 1
            e['topic'] = doc['topic']
            e['genotypes'] = {norm_gt(k): v for k, v in e['genotypes'].items()}
            e.setdefault('generated_by', 'human')
            entries.append(e)
    seen = set()
    for e in entries:
        if e['rsid'] in seen:
            print(f'duplicate rsid {e["rsid"]}', file=sys.stderr)
            return 1
        seen.add(e['rsid'])
    # Markers name conditions by id; each condition lists its markers. Either side may say it.
    by_id = {c['id']: c for c in conditions}
    for e in entries:
        for cid in e.get('conditions', []):
            if cid not in by_id:
                return fail(f'{e["rsid"]}: unknown condition {cid}')
            if e['rsid'] not in by_id[cid]['rsids']:
                by_id[cid]['rsids'].append(e['rsid'])
    by_rsid = {e['rsid']: e for e in entries}
    for c in conditions:
        for rsid in c['rsids']:
            if rsid not in by_rsid:
                # Allowed: a condition may name markers nobody has curated yet.
                print(f'note: condition {c["id"]} names {rsid}, which has no entry', file=sys.stderr)
            elif c['id'] not in by_rsid[rsid].setdefault('conditions', []):
                by_rsid[rsid]['conditions'].append(c['id'])
        c['rsids'].sort()
    payload = {
        'version': date.today().strftime('%Y.%m.%d'),
        'entries': sorted(entries, key=lambda e: e['rsid']),
        'topics': list(topics.values()),
        'conditions': sorted(conditions, key=lambda c: c['id']),
        'analytes': analytes,
        'panels': panels,
        'units': units,
        'licences': [
            'dbSNP, ClinVar, GWAS Catalog: public domain / open',
            'CPIC guidelines: CC BY-SA 4.0',
            'Reviewed entries: curated in the family_dna repository',
            'LOINC codes: copyright Regenstrief Institute, Inc., available at no cost at loinc.org',
        ],
    }
    body = json.dumps(payload, ensure_ascii=False, indent=1)
    payload['sha256'] = hashlib.sha256(body.encode()).hexdigest()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f'wrote {OUT}: {len(entries)} entries, {len(topics)} topics, {len(conditions)} conditions, {len(analytes)} lab tests')
    return 0


if __name__ == '__main__':
    sys.exit(main())
