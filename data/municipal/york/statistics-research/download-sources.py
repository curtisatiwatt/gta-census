#!/usr/bin/env python3
"""Refresh the three official York 2021 sources used by prepare-supplemental.py."""
import json
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = 'https://services1.arcgis.com/GzvOwaQBbX7KLiuG/arcgis/rest/services/'
SOURCE_SPECS = [
    ('da-income-2021', '3da230acb6884c77848d2fdbe5527043',
     'myProfile_of_Total_Income_by_Census_Dissemination_Area__2021_Census/FeatureServer/3'),
    ('da-visible-minority-2021', 'eb45943c2f1b4aa699ecddf04822eea8',
     'myProfile_of_Immigration_Citizenship_by_Dissemination_Area__2021_Census/FeatureServer/14'),
    ('da-population-2021', '7a6e958187334501a40ced3cc4f83619', 'PopDenPoints_DA/FeatureServer/1'),
]


def get(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        value = json.load(response)
    if 'error' in value:
        raise ValueError(value['error'])
    return value


def save(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def download(spec):
    name, item, endpoint = spec
    url = BASE + endpoint
    layer = get(url + '?f=json')
    save(name + '-layer.json', layer)
    save(name + '-item.json', get('https://www.arcgis.com/sharing/rest/content/items/' + item + '?f=json'))
    fields = ['DAUID', 'CSDUID', 'CSDNAME', 'CTUID']
    geojson = name != 'da-population-2021'
    if name == 'da-income-2021':
        fields += ['TOT_PVT_HH', 'MED_TOT_HH', 'MED_AFT_TAX_INC_HH', 'TOT_HHTI_PVT']
        fields += [f['name'] for f in layer['fields'] if f['name'].startswith('PVT_HHTI_')]
    elif name == 'da-visible-minority-2021':
        fields += [f['name'] for f in layer['fields'] if f['name'].startswith(('TOT_VISIBLE_MINORITY', 'VM_'))]
    else:
        fields = ['DAUID', 'CSDUID', 'CSDNAME', 'DAPOP2021', 'DATDWELL2021', 'DAURDWELL2021']
    features = []
    while True:
        params = {'where': '1=1', 'outFields': ','.join(fields), 'returnGeometry': str(geojson).lower(),
                  'outSR': 4326, 'f': 'geojson' if geojson else 'json', 'orderByFields': 'OBJECTID',
                  'resultOffset': len(features), 'resultRecordCount': 1000}
        page = get(url + '/query?' + urllib.parse.urlencode(params))
        features.extend(page['features'])
        if len(page['features']) < 1000:
            break
    suffix = '.geojson' if geojson else '.json'
    save(name + suffix, {'type': 'FeatureCollection', 'features': features} if geojson else {'features': features})
    print(name, len(features))


if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(download, SOURCE_SPECS))
