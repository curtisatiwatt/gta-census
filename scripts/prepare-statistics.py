"""Associate named communities with complete published statistical areas.

Values are never allocated to intersections, summed, or averaged. Intersections
are used only for navigation and for a display mask where community values are
missing. Selecting a row always outlines the complete source statistical area.
"""
import importlib.util
import json
from collections import defaultdict
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

spec = importlib.util.spec_from_file_location('neighbourhoods', Path(__file__).with_name('prepare-neighbourhoods.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
ROOT, PUBLIC = base.ROOT, base.PUBLIC


def main():
    config = base.read('data/municipal/statistics-sources.json')
    neighbourhoods = base.read('public/data/neighbourhoods.geojson')['features']
    profiles = base.read('public/data/neighbourhood-data.json')['communities']
    census = base.read('public/data/communities.geojson')['features']
    source_hashes = {p: base.sha(p) for p in ['data/municipal/statistics-sources.json', 'public/data/neighbourhoods.geojson', 'public/data/neighbourhood-data.json', 'public/data/communities.geojson', 'public/data/population-groups.json']}
    datasets, extra, records, sources = {}, [], {}, []
    datasets['census'] = {'features': census, 'mode': 'fallback'}
    for source in config['datasets']:
        features = base.read(source['path'])['features']
        data = base.read(source['dataPath'])
        source_hashes[source['path']] = base.sha(source['path'])
        source_hashes[source['dataPath']] = base.sha(source['dataPath'])
        for path in source.get('auditPaths', []):
            source_hashes[path] = base.sha(path)
        datasets[source['id']] = {**source, 'features': features}
        extra.extend(features)
        records.update(data.get('records', {}))
        sources.append({'label': source['publisher'] + ' · ' + source['title'], 'url': source['sourceUrl']})
    for dataset in datasets.values():
        dataset['geometries'] = [base.polygon(shape(f['geometry'])) for f in dataset['features']]
        dataset['tree'] = STRtree(dataset['geometries'])
        dataset['areas'] = [base.area(g) for g in dataset['geometries']]
    relationships, display_parts = {}, defaultdict(list)
    for community in neighbourhoods:
        p = community['properties']
        record = profiles.get(p['code'], {})
        income_missing = p.get('income') is None
        population_missing = not record.get('population') or not record.get('counts') or any(v is None for v in record.get('counts', {}).values())
        if not income_missing and not population_missing:
            continue
        geometry = base.polygon(shape(community['geometry']))
        community_area = base.area(geometry)
        primary = config['primaryByRegion'].get(p['regionCode'], 'census')
        choices = [s['id'] for s in config['datasets'] if s.get('mode') == 'related' and p['regionCode'] in s['regions']] + [primary]
        related = []
        for priority, key in enumerate(choices):
            dataset = datasets[key]
            for index in dataset['tree'].query(geometry, predicate='intersects'):
                full = dataset['features'][index]
                full_geometry = dataset['geometries'][index]
                intersection = geometry.intersection(full_geometry)
                overlap = base.area(intersection)
                if overlap < max(1000, min(community_area, dataset['areas'][index]) * .005):
                    continue
                code = full['properties']['code']
                related.append({'code': code, 'communityAreaShare': overlap / community_area,
                                'statisticAreaShare': overlap / dataset['areas'][index], 'priority': priority})
                if key == primary:
                    flags = (income_missing, population_missing)
                    display_parts[(code, p['municipalityCode'], *flags)].append((p['code'], base.polygon(intersection)))
        related.sort(key=lambda r: (r['priority'], -r['communityAreaShare'], r['code']))
        if related:
            relationships[p['code']] = related
    display = []
    for (code, municipality, income, population), parts in sorted(display_parts.items()):
        geometry = base.polygon(unary_union([g for _, g in parts]))
        display.append({'type': 'Feature', 'properties': {'statisticCode': code, 'communityCodes': sorted({c for c, _ in parts}), 'income': income, 'population': population}, 'geometry': mapping(geometry)})
    output = {
        'statistics-areas.geojson': {'type': 'FeatureCollection', 'features': extra},
        'statistics-data.json': {'schemaVersion': 1, 'records': records, 'relationships': relationships, 'sources': sources},
        'statistics-display.geojson': {'type': 'FeatureCollection', 'features': display},
    }
    hashes = {name: base.write(name, value) for name, value in output.items()}
    audit = {'sourceHashes': source_hashes, 'hashes': hashes, 'extraAreaCount': len(extra), 'relatedCommunityCount': len(relationships), 'displayFragmentCount': len(display),
             'method': 'Spatial intersections link complete source statistical areas; no statistical value is reallocated. Display masks contain only references, never population or income values.'}
    (ROOT / 'data/municipal/statistics-audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in audit.items() if k not in ['sourceHashes', 'hashes']}, indent=2))


if __name__ == '__main__':
    main()
