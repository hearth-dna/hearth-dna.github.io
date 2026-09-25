#!/usr/bin/env python3
"""Build frontend/public/kb.json from kb/reviewed/*.json.

`reviewed/conditions.json` is the condition catalogue: one id per condition with names, synonyms,
ICD-10 codes and the lab tests, measurements, symptoms and drugs that belong to it. Marker entries
name conditions by id; the build checks every id and links markers and conditions both ways.

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


def main() -> int:
    entries = []
    topics = {}
    try:
        conditions = load_conditions()
    except ValueError as e:
        return fail(f'{CONDITIONS}: {e}')
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
        'licences': [
            'dbSNP, ClinVar, GWAS Catalog: public domain / open',
            'CPIC guidelines: CC BY-SA 4.0',
            'Reviewed entries: curated in the family_dna repository',
        ],
    }
    body = json.dumps(payload, ensure_ascii=False, indent=1)
    payload['sha256'] = hashlib.sha256(body.encode()).hexdigest()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f'wrote {OUT}: {len(entries)} entries, {len(topics)} topics, {len(conditions)} conditions')
    return 0


if __name__ == '__main__':
    sys.exit(main())
