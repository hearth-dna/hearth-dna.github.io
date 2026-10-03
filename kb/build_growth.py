#!/usr/bin/env python3
"""Write kb/reviewed/growth/who.json: the WHO growth curves as monthly LMS rows.

A one-off generator, not part of `make kb-build`: the tables are WHO's and do not change. It reads
them from WHO's own R packages as CRAN publishes them (anthro: Child Growth Standards 0-5 years,
daily rows; anthroplus: Growth Reference 5-19 years, monthly rows), keeps one row per month and
writes `{indicator: {boys|girls: [[month, L, M, S], ...]}}`.

    python3 -m venv /tmp/v && /tmp/v/bin/pip install rdata
    /tmp/v/bin/python kb/build_growth.py

Percentile p at an age is M * (1 + L*S*z)^(1/L) (M * exp(S*z) when L is 0), z the normal quantile.
"""

import json
import os
import tempfile
import urllib.request

import rdata

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'reviewed', 'growth', 'who.json')
MIRROR = 'https://raw.githubusercontent.com/cran/{}/master/R/sysdata.rda'
DAYS_PER_MONTH = 30.4375

# indicator: (anthro table 0-60 months, anthroplus table 61+ months or None)
INDICATORS = {
    'wfa': ('growthstandards_weianthro', 'wfa_growth_standards'),  # weight-for-age, kg, to 10 y
    'lhfa': ('growthstandards_lenanthro', 'hfa_growth_standards'),  # length/height-for-age, cm
    'bfa': ('growthstandards_bmianthro', 'bfa_growth_standards'),  # BMI-for-age, kg/m²
    'hcfa': ('growthstandards_hcanthro', None),  # head circumference-for-age, cm, to 5 y
}


def load(package):
    with tempfile.NamedTemporaryFile(suffix='.rda') as f:
        f.write(urllib.request.urlopen(MIRROR.format(package)).read())
        f.flush()
        return rdata.read_rda(f.name)


def row(month, r):
    return [month, round(float(r.l), 4), round(float(r.m), 4), round(float(r.s), 5)]


def main():
    anthro, plus = load('anthro'), load('anthroplus')
    out = {
        'source': 'WHO Child Growth Standards (0-5 y, 2006) and WHO Growth Reference (5-19 y, 2007), '
        'from the WHO R packages anthro and anthroplus as published on CRAN',
        'licence': 'Data (c) World Health Organization; reproduced with attribution for non-commercial use',
        'indicators': {},
    }
    for key, (young, old) in INDICATORS.items():
        out['indicators'][key] = {}
        for sex, name in ((1, 'boys'), (2, 'girls')):
            t = anthro[young]
            t = t[t.sex == sex].set_index('age')
            rows = [row(m, t.loc[round(m * DAYS_PER_MONTH)]) for m in range(0, 61)]
            if old:
                o = plus[old]
                o = o[(o.sex == sex) & (o.age > 60)]
                rows += [row(int(r.age), r) for r in o.itertuples()]
            out['indicators'][key][name] = rows
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
        f.write('\n')
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
