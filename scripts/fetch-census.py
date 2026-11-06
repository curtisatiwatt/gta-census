"""Fetch selected 2021 Census Profile cells from Statistics Canada's SDMX API.

The publication script is offline. This optional acquisition command refreshes
verbatim CSV extracts and records their exact source URLs and SHA-256 hashes.
"""
import argparse
import csv
import hashlib
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'data/census'
BASE = 'https://api.statcan.gc.ca/census-recensement/profile/sdmx/rest'
CHARACTERISTICS = ['1', '35', '56', '229'] + [str(n) for n in range(1669, 1684)]
REGIONS = {'3518': 'Durham', '3519': 'York', '3520': 'Toronto', '3521': 'Peel', '3524': 'Halton'}


def download_batch(task):
    name, level, geographies = task
    source_url = f"{BASE}/data/STC_CP,DF_{level}/A5.{'+'.join(geographies)}.1.{'+'.join(CHARACTERISTICS)}.1?format=csv"
    output = SOURCES / f'{name}.csv'
    if not output.exists():
        for attempt in range(4):
            try:
                body = urlopen(source_url, timeout=90).read()
                if not body.startswith(b'DATAFLOW,'):
                    raise ValueError('Expected a labelled SDMX CSV response')
                output.write_bytes(body)
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 + attempt * 3)
    body = output.read_bytes()
    rows = list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'))))
    seen = {row['REF_AREA'] for row in rows}
    missing = sorted(set(geographies) - seen)
    # Some geographies are published with no census statistics (suppression).
    result = {
        'path': output.relative_to(ROOT).as_posix(), 'url': source_url,
        'sha256': hashlib.sha256(body).hexdigest(), 'rows': len(rows),
        'requestedGeographies': geographies, 'returnedGeographies': sorted(seen),
        'missingGeographies': missing,
    }
    print(f'{name}: {len(seen)} areas, {len(rows)} cells, missing {len(missing)}', flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--boundaries', type=Path)
    args = parser.parse_args()
    definitions = json.loads((SOURCES / 'profile-definitions.json').read_text())
    tasks = [
        ('municipalities', 'CSD', [m['dguid'] for m in definitions['municipalities']]),
        ('regions', 'CD', ['2021A0003' + code for code in REGIONS]),
    ]
    if args.boundaries:
        boundaries = json.loads(args.boundaries.read_text())
        dg = sorted({feature['properties']['DGUID'].replace('.', '_') for feature in boundaries['features']})
        tasks += [(f'tracts-{n // 40:03}', 'CT', dg[n:n + 40]) for n in range(0, len(dg), 40)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        manifest = list(pool.map(download_batch, tasks))
    (SOURCES / 'sources.json').write_text(json.dumps({
        'retrievedDate': '2026-11-06', 'apiGuide': 'https://www12.statcan.gc.ca/wds-sdw/2021profile-profil2021-eng.cfm',
        'characteristics': CHARACTERISTICS, 'extracts': manifest,
    }, indent=2) + '\n')


if __name__ == '__main__':
    main()
