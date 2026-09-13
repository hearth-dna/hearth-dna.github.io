#!/usr/bin/env python3
"""Build frontend/public/kb.json from kb/reviewed/*.json.

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


def norm_gt(gt: str) -> str:
    return ''.join(sorted(gt.upper()))


def main() -> int:
    entries = []
    topics = {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'reviewed', '*.json'))):
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
    payload = {
        'version': date.today().strftime('%Y.%m.%d'),
        'entries': sorted(entries, key=lambda e: e['rsid']),
        'topics': list(topics.values()),
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
    print(f'wrote {OUT}: {len(entries)} entries, {len(topics)} topics')
    return 0


if __name__ == '__main__':
    sys.exit(main())
