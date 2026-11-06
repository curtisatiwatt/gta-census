"""Select published municipal statistics; never substitute personal income for household income."""
import csv
import hashlib
import json
from pathlib import Path

DEST = Path(__file__).resolve().parent
FIELDS = {
    'south_asian': 'VM_SA', 'chinese': 'VM_Chinese', 'black': 'VM_Black',
    'filipino': 'VM_Filip', 'arab': 'VM_Arab', 'latin_american': 'VM_LatAmer',
    'southeast_asian': 'VM_SouthEA', 'west_asian': 'VM_WestA', 'korean': 'VM_Korean',
    'japanese': 'VM_Japan', 'visible_minority_nie': 'VM_VM_NIE',
    'multiple_visible_minorities': 'VM_MVM', 'not_visible_minority': 'VM_NVM',
}

def number(value):
    if value is None or value.strip() in {'', 'x', 'F', '..', '...', 'NA'}:
        return None
    numeric = float(value)
    assert numeric >= 0
    return int(numeric) if numeric.is_integer() else numeric

def main():
    csv_path = DEST / 'mississauga-2021-neighbourhoods.csv'
    rows = list(csv.DictReader(csv_path.open(encoding='utf-8-sig')))
    all_rows = [r for r in rows if r['GEN'] == 'All' and r['Geog_Cat'] == 'Neighbourhood']
    by_name = {r['Geog']: r for r in all_rows}
    assert len(by_name) == len(all_rows) == 56
    geometry_path = DEST / 'mississauga-neighbourhoods-2021.geojson'
    features = json.loads(geometry_path.read_text())['features']
    assert set(by_name) == {f['properties']['Geog'] for f in features}
    source_url = 'https://www.arcgis.com/home/item.html?id=f189743f279b4d06945689dce525b746'
    records = {}
    for feature in features:
        p = feature['properties']
        row = by_name[p['Geog']]
        records[str(p['OBJECTID'])] = {
            'name': p['Geog'], 'municipalityCode': '3521005',
            'population': number(row['VM']),
            'counts': {group: number(row[column]) for group, column in FIELDS.items()},
            'income': None, 'children': None, 'householdSize': number(row['STD_AHS']),
            'totalPopulation': None, 'sourceUrl': source_url,
            'censusYear': 2021, 'incomeYear': 2020,
        }
    output = {
        'municipalityCode': '3521005', 'publisher': 'City of Mississauga',
        'sourceUrl': source_url, 'sourceCsv': str(csv_path.relative_to(DEST.parents[2])),
        'sourceCsvSha256': hashlib.sha256(csv_path.read_bytes()).hexdigest(),
        'geometrySha256': hashlib.sha256(geometry_path.read_bytes()).hexdigest(),
        'join': {'geometryId': 'OBJECTID', 'geometryName': 'Geog', 'profileName': 'Geog', 'gender': 'All'},
        'fieldMappings': {'population': 'VM', 'counts': FIELDS, 'householdSize': 'STD_AHS'},
        'definitions': {
            'population': 'Total - Visible minority for the population in private households - 25% sample data',
            'householdSize': 'Total - Structural type of dwelling_Average household size (municipal custom 25% sample)',
            'income': 'Unavailable: the source includes individual and non-census-family-person income, not median total household income.',
            'children': 'Unavailable in the complete-population definition used by this application; AG and AG_0_14 in this table are 25% sample data.',
            'totalPopulation': 'Unavailable: AG is a 25% sample population count, not the complete-population count.',
        },
        'records': records,
    }
    (DEST / 'profiles-selected.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(f'Selected {len(records)} official neighbourhood profiles with 13 population categories.')

if __name__ == '__main__':
    main()
