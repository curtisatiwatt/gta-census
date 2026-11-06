#!/usr/bin/env python3
"""Preserve York Region's public 2021 DA statistics on their original DA geometry.

No neighbourhood values, medians, or population proportions are interpolated.
Run with Python + shapely after downloading the documented source snapshots.
"""
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from shapely.geometry import shape

HERE = Path(__file__).resolve().parent
API = 'https://services1.arcgis.com/GzvOwaQBbX7KLiuG/arcgis/rest/services/'
SOURCES = {
    'income': {
        'itemId': '3da230acb6884c77848d2fdbe5527043',
        'layerUrl': API + 'myProfile_of_Total_Income_by_Census_Dissemination_Area__2021_Census/FeatureServer/3',
        'file': 'da-income-2021.geojson',
        'fields': {'income': 'MED_TOT_HH', 'households': 'TOT_PVT_HH'},
    },
    'populationGroups': {
        'itemId': 'eb45943c2f1b4aa699ecddf04822eea8',
        'layerUrl': API + 'myProfile_of_Immigration_Citizenship_by_Dissemination_Area__2021_Census/FeatureServer/14',
        'file': 'da-visible-minority-2021.geojson',
        'fields': {'population': 'TOT_VISIBLE_MINORITY_PVT_HH'},
    },
    'totalPopulation': {
        'itemId': '7a6e958187334501a40ced3cc4f83619',
        'layerUrl': API + 'PopDenPoints_DA/FeatureServer/1',
        'file': 'da-population-2021.json',
        'fields': {'totalPopulation': 'DAPOP2021', 'occupiedPrivateDwellings': 'DAURDWELL2021'},
    },
}
GROUP_FIELDS = {
    'south_asian': 'VM_SOUTH_ASIAN',
    'chinese': 'VM_CHINESE',
    'black': 'VM_BLACK',
    'filipino': 'VM_FILIPINO',
    'arab': 'VM_ARAB',
    'latin_american': 'VM_LATIN_AMERICAN',
    'southeast_asian': 'VM_SOUTHEAST_ASIAN',
    'west_asian': 'VM_WEST_ASIAN',
    'korean': 'VM_KOREAN',
    'japanese': 'VM_JAPANESE',
    'visible_minority_nie': 'VM_NIE',
    'multiple_visible_minorities': 'VM_MULTIPLE_VISIBLE_MINORITIES',
    'not_visible_minority': 'VM_NOT_A_VISIBLE_MINORITY',
}
SOURCES['populationGroups']['fields']['counts'] = GROUP_FIELDS


def read(filename):
    return json.loads((HERE / filename).read_text())


def write(filename, value):
    (HERE / filename).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def main():
    minority = read('da-visible-minority-2021.geojson')['features']
    incomes = {f['properties']['DAUID']: f for f in read('da-income-2021.geojson')['features']}
    totals = {f['attributes']['DAUID']: f['attributes'] for f in read('da-population-2021.json')['features']}
    assert len(minority) == len(incomes) == len(totals) == 1184
    features, records = [], {}
    coverage = defaultdict(Counter)
    for f in minority:
        p = f['properties']
        dauid = p['DAUID']
        income_feature = incomes[dauid]
        assert income_feature['geometry'] == f['geometry'], dauid
        assert income_feature['properties']['CSDUID'] == p['CSDUID'] == totals[dauid]['CSDUID'], dauid
        income = income_feature['properties']['MED_TOT_HH']
        pop = p['TOT_VISIBLE_MINORITY_PVT_HH']
        counts = {key: p[field] for key, field in GROUP_FIELDS.items()}
        assert all(v is None or (isinstance(v, (int, float)) and math.isfinite(v) and v >= 0)
                   for v in [income, pop, *counts.values()]), dauid
        assert shape(f['geometry']).is_valid, dauid
        code = 'DA' + dauid
        centre = shape(f['geometry']).representative_point()
        income_url = 'https://www.arcgis.com/home/item.html?id=' + SOURCES['income']['itemId']
        groups_url = 'https://www.arcgis.com/home/item.html?id=' + SOURCES['populationGroups']['itemId']
        profile_url = ('https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/page.cfm?'
                       'Lang=E&DGUIDlist=2021S0512' + dauid + '&GENDERlist=1&STATISTIClist=1&HEADERlist=0')
        features.append({
            'type': 'Feature',
            'geometry': f['geometry'],
            'properties': {
                'code': code, 'name': p['CSDNAME'] + ' · DA ' + dauid,
                'municipalityCode': p['CSDUID'], 'municipality': p['CSDNAME'],
                'regionCode': '3519', 'region': 'York', 'sector': '3519', 'sectorLabel': 'York',
                'geographyType': 'dissemination_area', 'type': 'Dissemination area', 'typeLabel': '普查传播区',
                'income': income, 'totalPopulation': totals[dauid]['DAPOP2021'], 'population': pop,
                'households': income_feature['properties']['TOT_PVT_HH'],
                'occupiedPrivateDwellings': totals[dauid]['DAURDWELL2021'],
                'chineseCount': counts['chinese'],
                'chinesePct': counts['chinese'] / pop if pop and counts['chinese'] is not None else None,
                'sourceUrl': income_url, 'incomeSourceUrl': income_url, 'populationSourceUrl': groups_url,
                'profileUrl': profile_url, 'boundarySourceUrl': groups_url,
                'publisher': 'The Regional Municipality of York',
                'statisticsMethod': 'municipal_census_da', 'referenceYear': 2021, 'incomeReferenceYear': 2020,
                'centroid': [centre.x, centre.y], 'anchorMethod': 'interior_representative_point',
                'daId': dauid, 'tractId': p['CTUID'], 'roundedStatistics': True,
                'caveat': 'York 区域政府发布的 2021 普查 DA 原始统计；数值适用于所高亮的完整 DA，不能当作与其相交的命名社区整体统计。收入为 2020 年住户总收入中位数；人口构成采用同表私人住户人口分母。',
                'caveatEn': '2021 Census DA data published by York Region. Statistics describe the complete highlighted DA, not an intersecting named neighbourhood. Income is median total household income in 2020; population groups use the same-table private-household population denominator.',
            },
        })
        records[code] = {'population': pop, 'counts': counts, 'sourceUrl': groups_url}
        c = coverage[p['CSDUID']]
        c['areas'] += 1
        c['withIncome'] += income is not None
        c['withPopulationGroups'] += pop is not None and all(v is not None for v in counts.values())
        c['totalPopulation'] += totals[dauid]['DAPOP2021']

    for s in SOURCES.values():
        s['sourceUrl'] = 'https://www.arcgis.com/home/item.html?id=' + s['itemId']
        raw = read(s['file'])['features'][0]
        s['queryParameters'] = {'where': '1=1', 'outFields': ','.join(raw.get('properties', raw.get('attributes', {}))), 'returnGeometry': s['file'].endswith('.geojson'), 'outSR': 4326, 'f': 'geojson' if s['file'].endswith('.geojson') else 'json'}
        s['sha256'] = hashlib.sha256((HERE / s['file']).read_bytes()).hexdigest()
    manifest = {
        'schemaVersion': 1, 'retrieved': '2026-11-06',
        'publisher': 'The Regional Municipality of York', 'originalProducer': 'Statistics Canada',
        'license': "York Region Open Data Licence v1.0",
        'licenseUrl': 'https://www.arcgis.com/sharing/rest/content/items/78cc02388af248c0b7a30eda6adfade0/data',
        'attribution': "Contains public sector information made available under The Regional Municipality of York's Open Data Licence",
        'sources': SOURCES,
        'definitions': {
            'income': 'Median total income of private households in 2020, dollars. Preserve each DA median; never average or spatially apportion it.',
            'totalPopulation': '2021 Census population count, including institutional residents. Not the population-groups denominator.',
            'population': 'Total visible-minority-status population in private households, 2021 Census 25% sample, from the same table as all 13 groups.',
            'counts': 'Twelve visible-minority groups plus Not a visible minority. Census categories; not an ethnicity or nationality classification.',
            'null': 'Source suppression/missing value, preserved as null. Null does not mean zero.',
        },
        'coverageByMunicipality': {code: dict(values) for code, values in sorted(coverage.items())},
        'quality': {'uniqueCodes': len(records), 'identicalIncomeAndPopulationGeometry': True,
                    'allGeometriesValid': True, 'allMunicipalityJoinsMatch': True,
                    'totalPopulation': sum(c['totalPopulation'] for c in coverage.values()),
                    'withIncome': sum(c['withIncome'] for c in coverage.values()),
                    'withPopulationGroups': sum(c['withPopulationGroups'] for c in coverage.values())},
        'usage': 'Display these as complete original statistics areas linked to named municipal neighbourhoods. No EDI/community statistics are derived here.',
        'reserveCoverage': 'The official York dataset includes CSD 3519076 Chippewas of Georgina Island First Nation (three DAs); retain its CSD identity rather than assigning it to Georgina.',
    }
    write('supplemental-areas.geojson', {'type': 'FeatureCollection', 'features': features})
    write('supplemental-data.json', {'schemaVersion': 1, 'records': records})
    write('supplemental-manifest.json', manifest)
    print(json.dumps(manifest['quality']))
    print(json.dumps(manifest['coverageByMunicipality']))


if __name__ == '__main__':
    main()
