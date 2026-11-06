"""Build published GTA census assets from pinned, official source snapshots."""
import csv
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/census'
PUBLIC = ROOT / 'public/data'
REGIONS = {'3518': 'Durham', '3519': 'York', '3520': 'Toronto', '3521': 'Peel', '3524': 'Halton'}
GROUPS = [
    ('south_asian', '南亚裔', 'South Asian'), ('chinese', '华人', 'Chinese'),
    ('black', '黑人', 'Black'), ('filipino', '菲律宾裔', 'Filipino'),
    ('arab', '阿拉伯裔', 'Arab'), ('latin_american', '拉丁美洲裔', 'Latin American'),
    ('southeast_asian', '东南亚裔', 'Southeast Asian'), ('west_asian', '西亚裔', 'West Asian'),
    ('korean', '韩裔', 'Korean'), ('japanese', '日裔', 'Japanese'),
    ('visible_minority_nie', '其他可见少数族裔', 'Visible minority, n.i.e.'),
    ('multiple_visible_minorities', '多个可见少数族裔', 'Multiple visible minorities'),
    ('not_visible_minority', '非可见少数族裔（普查分类）', 'Not a visible minority'),
]


def profile_url(dguid):
    return 'https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/page.cfm?Lang=E&DGUIDlist=' + dguid + '&GENDERlist=1&STATISTIClist=1&HEADERlist=0'


def read_json(path):
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_text())


def write_json(name, data):
    path = PUBLIC / name
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    definitions = read_json(SOURCE / 'profile-definitions.json')
    manifest = read_json(SOURCE / 'sources.json')
    profiles = defaultdict(dict)
    for extract in manifest['extracts']:
        path = ROOT / extract['path']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == extract['sha256'], path
        for row in csv.DictReader(path.open(encoding='utf-8-sig')):
            assert row['GENDER'] == '1' and row['STATISTIC'] == '1'
            dguid = row['REF_AREA'].replace('_', '.')
            assert row['CHARACTERISTIC'] not in profiles[dguid], (dguid, row['CHARACTERISTIC'])
            profiles[dguid][row['CHARACTERISTIC']] = row

    def value(dguid, key):
        row = profiles.get(dguid, {}).get(str(key))
        if not row or row['FLAG'] in {'1', '2', '4', '6', 'O'} or row['OBS_VALUE'] == '':
            return None
        number = float(row['OBS_VALUE'])
        return int(number) if number.is_integer() else number

    def record(dguid):
        return {'population': value(dguid, 1669), 'counts': {
            group[0]: value(dguid, 1671 + i) for i, group in enumerate(GROUPS)
        }, 'sourceUrl': profile_url(dguid)}

    scopes = []
    population_scopes = {}
    bounds = {s['id']: s['bounds'] for s in read_json(SOURCE / 'geometry/scope-bounds.json')}
    for code, name in REGIONS.items():
        dg = '2021A0003' + code
        population_scopes[code] = record(dg)
        scopes.append({'id': code, 'name': name, 'type': 'region', 'incomeMedian': value(dg, 229),
                       'totalPopulation': value(dg, 1), 'sourceUrl': profile_url(dg), 'bounds': bounds[code]})
    for municipality in definitions['municipalities']:
        code, dg = municipality['code'], municipality['dguid']
        population_scopes[code] = record(dg)
        scopes.append({'id': code, 'name': municipality['name'], 'type': 'municipality',
                       'regionCode': municipality['regionCode'], 'region': REGIONS[municipality['regionCode']],
                       'incomeMedian': value(dg, 229), 'totalPopulation': value(dg, 1),
                       'sourceUrl': profile_url(dg), 'bounds': bounds[code]})
    gta_population = {
        'population': sum(population_scopes[code]['population'] for code in REGIONS),
        'counts': {g[0]: sum(population_scopes[code]['counts'][g[0]] for code in REGIONS) for g in GROUPS},
        'aggregation': 'Sum of the five official 2021 census division totals; published values are rounded.',
    }
    population_scopes['gta'] = gta_population
    scopes.insert(0, {'id': 'gta', 'name': 'Greater Toronto Area', 'type': 'gta', 'incomeMedian': None,
                     'totalPopulation': sum(value('2021A0003' + c, 1) for c in REGIONS), 'bounds': bounds['gta']})

    boundaries = read_json(SOURCE / 'geometry/areas.geojson')
    features, records, flag_counts = [], {}, Counter()
    for feature in boundaries['features']:
        original = feature['properties']
        dg = original['DGUID']
        municipality_code = original['CSDUID']
        tract = original.get('CTUID')
        code = 'CT' + tract if tract else 'CSD' + municipality_code
        area_record = record(dg)
        income, denominator = value(dg, 229), area_record['population']
        chinese = area_record['counts']['chinese']
        chinese_pct = chinese / denominator if chinese is not None and denominator else None
        age_pct = value(dg, 35)
        flag = profiles.get(dg, {}).get('229', {}).get('FLAG', 'O')
        flag_counts[flag or 'reported'] += 1
        caveats = []
        caveats_en = []
        if not tract:
            caveats.append('此处采用整个市镇的普查统计，统计范围大于普查区。')
            caveats_en.append('This area displays the entire census subdivision, a broader geography than a census tract.')
        if income is None:
            caveats.append('家庭收入未公布或被保密抑制。')
            caveats_en.append('Household income is unpublished or confidentially suppressed.')
        if denominator is not None and denominator < 1000:
            caveats.append('人口不足1,000，取整对占比的影响较大。')
            caveats_en.append('Population is below 1,000; rounding has a greater effect on percentages.')
        if chinese == 0:
            caveats.append('原表人数为0，经过随机取整。')
            caveats_en.append('The published count is zero and is subject to random rounding.')
        p = {
            'code': code, 'name': original['CSDNAME'] + ' · CT ' + original['CTNAME'] if tract else original['CSDNAME'],
            'income': income, 'incomeRank': None, 'children': age_pct / 100 if age_pct is not None else None,
            'householdSize': value(dg, 56), 'population': denominator, 'totalPopulation': value(dg, 1),
            'chineseCount': chinese, 'chinesePct': chinese_pct,
            'sector': original['CDUID'], 'sectorLabel': REGIONS[original['CDUID']],
            'regionCode': original['CDUID'], 'region': REGIONS[original['CDUID']],
            'municipalityCode': municipality_code, 'municipality': original['CSDNAME'],
            'geographyType': 'tract' if tract else 'municipality',
            'type': 'Census tract' if tract else 'Census subdivision',
            'typeLabel': '普查区' if tract else '市镇统计区',
            'sourceUrl': profile_url(dg), 'profileUrl': profile_url(dg), 'dguid': dg,
            'status': 'reported' if income is not None else 'suppressed' if flag == '6' else 'missing',
            'chineseStatus': 'reported_zero_rounded' if chinese == 0 else 'reported' if chinese is not None else 'missing',
            'smallPopulation': denominator is not None and denominator < 1000,
            'roundedStatistics': True, 'centroid': original['centroid'],
            'anchorMethod': original['anchorMethod'], 'caveat': ''.join(caveats), 'caveatEn': ' '.join(caveats_en),
        }
        if tract:
            p.update(tractId=tract, tractName=original['CTNAME'])
        feature['id'], feature['properties'] = code, p
        features.append(feature)
        records[code] = area_record
    # Ranks only compare tracts inside their own municipality. Municipality-level
    # fallback polygons are deliberately excluded from tract rankings.
    by_municipality = defaultdict(list)
    for f in features:
        p = f['properties']
        if p['geographyType'] == 'tract' and p['income'] is not None:
            by_municipality[p['municipalityCode']].append(p)
    for peers in by_municipality.values():
        for p in peers:
            p['incomeRank'] = 1 + sum(other['income'] > p['income'] for other in peers)
            p['incomeRankTotal'] = len(peers)
    features.sort(key=lambda f: (f['properties']['municipality'], f['properties'].get('tractId', '')))
    PUBLIC.mkdir(parents=True, exist_ok=True)
    hashes = {}
    hashes['communities.geojson'] = write_json('communities.geojson', {'type': 'FeatureCollection', 'features': features})
    hashes['population-groups.json'] = write_json('population-groups.json', {
        'schemaVersion': 1, 'censusYear': 2021, 'variable': 'visible_minority', 'denominatorLabel': '私人住户人口',
        'groups': [dict(zip(['id', 'label', 'name'], g)) for g in GROUPS],
        'defaultGroupIds': ['south_asian', 'chinese', 'black', 'filipino', 'not_visible_minority'],
        'city': gta_population, 'scopes': population_scopes, 'communities': records,
    })
    metadata = read_json(SOURCE / 'metadata-template.json')
    metadata.update(scopes=scopes, cityChineseCount=gta_population['counts']['chinese'],
                    cityChinesePct=gta_population['counts']['chinese'] / gta_population['population'])
    hashes['metadata.json'] = write_json('metadata.json', metadata)
    audit = {
        'preparedDate': '2026-11-06', 'featureCount': len(features),
        'tractCount': sum(f['properties']['geographyType'] == 'tract' for f in features),
        'municipalityFallbacks': [f['properties']['municipalityCode'] for f in features if f['properties']['geographyType'] == 'municipality'],
        'regions': dict(Counter(f['properties']['region'] for f in features)),
        'incomeStatusCounts': dict(flag_counts), 'sourceProfileCount': len(profiles),
        'hashes': hashes,
    }
    (SOURCE / 'audit.json').write_text(json.dumps(audit, indent=2) + '\n')
    print(json.dumps(audit, indent=2))


if __name__ == '__main__':
    main()
