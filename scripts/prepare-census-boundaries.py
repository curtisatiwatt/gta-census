"""Rebuild display boundaries from audited Statistics Canada snapshots.

One-time data-preparation dependencies: shapely>=2.1, pyproj>=3.6.
The Vite application and deployment do not require Python.
Run from any directory: python scripts/prepare-census-boundaries.py
"""
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path

import shapely
from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data/census/geometry'
REGIONS = {'3518': 'Durham', '3519': 'York', '3520': 'Toronto', '3521': 'Peel', '3524': 'Halton'}
RAW = gzip.decompress((DEST / 'areas-raw.geojson.gz').read_bytes())
ROWS = json.loads(RAW)['features']
CSDS = json.loads(gzip.decompress((DEST / 'municipalities-raw.geojson.gz').read_bytes()))['features']

original = [shape(feature['geometry']) for feature in ROWS]
source_geometry_issues = [
    {'dguid': feature['properties']['DGUID'], 'reason': shapely.is_valid_reason(geometry)}
    for feature, geometry in zip(ROWS, original) if not geometry.is_valid
]
assert shapely.coverage_is_valid(original)
project = Transformer.from_crs(4326, 26917, always_xy=True).transform
unproject = Transformer.from_crs(26917, 4326, always_xy=True).transform
projected = [shapely.transform(geometry, project, interleaved=False) for geometry in original]
simplified = shapely.coverage_simplify(projected, tolerance=8, simplify_boundary=False)
assert shapely.coverage_is_valid(simplified)
areas = []
maximum_area_change = 0
for feature, geometry, source in zip(ROWS, simplified, projected):
    # The common precision grid preserves shared edges after reprojection.
    geographic = shapely.set_precision(shapely.transform(geometry, unproject, interleaved=False), 1e-7)
    assert geographic.is_valid
    point = geographic.representative_point()
    properties = {
        **feature['properties'],
        'centroid': [round(point.x, 7), round(point.y, 7)],
        'anchorMethod': 'interior_representative_point',
    }
    maximum_area_change = max(maximum_area_change, abs(geometry.area - source.area) / source.area)
    areas.append({'type': 'Feature', 'properties': properties, 'geometry': mapping(geographic)})
assert shapely.coverage_is_valid([shape(feature['geometry']) for feature in areas])
output = json.dumps({'type': 'FeatureCollection', 'features': areas}, separators=(',', ':'))
(DEST / 'areas.geojson').write_text(output)

municipalities = [(feature['properties'], shape(feature['geometry'])) for feature in CSDS]
scopes = []
for properties, geometry in municipalities:
    scopes.append({
        'id': properties['CSDUID'], 'name': properties['CSDNAME'], 'kind': 'municipality',
        'regionId': properties['CSDUID'][:4], 'bounds': list(geometry.bounds), 'dguid': properties['DGUID'],
    })
for code, name in REGIONS.items():
    geometry = unary_union([geometry for properties, geometry in municipalities if properties['CSDUID'].startswith(code)])
    scopes.append({'id': code, 'name': name, 'kind': 'region', 'bounds': list(geometry.bounds), 'dguid': '2021A0003' + code})
scopes.append({
    'id': 'gta', 'name': 'Greater Toronto Area', 'kind': 'gta',
    'bounds': list(unary_union([geometry for _, geometry in municipalities]).bounds), 'dguid': None,
})
(DEST / 'scope-bounds.json').write_text(json.dumps(scopes, indent=2))

tracts = [(feature['properties'], geometry) for feature, geometry in zip(ROWS, original) if feature['properties']['CTUID']]
coverage = []
crossing = []
for properties, municipality in municipalities:
    selected = [(p, geometry) for p, geometry in tracts if p['CSDUID'] == properties['CSDUID']]
    coverage.append({
        'CSDUID': properties['CSDUID'], 'name': properties['CSDNAME'], 'count': len(selected),
        'landCovered': round(municipality.intersection(unary_union([geometry for _, geometry in selected])).area / municipality.area, 8),
    })
    for p, geometry in selected:
        ratio = geometry.intersection(municipality).area / geometry.area
        if ratio < 0.9999:
            crossing.append([p['CTUID'], properties['CSDNAME'], ratio])
audit = {
    'countsByRegion': dict(Counter(properties['region'] for properties, _ in tracts)),
    'crossing': crossing,
    'coverage': coverage,
    'areaCount': len(areas),
    'fallbackCSDs': ['3518020', '3518022', '3518039'],
    'rawCoverageTopologyValid': True,
    'sourceGeometryIssues': source_geometry_issues,
    'displayGeometriesValid': True,
    'displayCoverageTopologyValid': True,
    'simplification': {
        'method': 'Shapely coverage_simplify', 'toleranceMetres': 8, 'crs': 'EPSG:26917',
        'simplifyBoundary': False, 'coordinatePrecisionDegrees': 1e-7,
        'maxIndividualRelativeAreaChange': maximum_area_change,
        'note': 'Shared interior edges are simplified together. Outer GTA boundaries are not simplified. Coordinates use a common precision grid. Statistical values are never reassigned.',
    },
    'rawSha256': hashlib.sha256(RAW).hexdigest(),
    'displaySha256': hashlib.sha256(output.encode()).hexdigest(),
    'source': 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer',
    'boundaryReferenceYear': 2021,
    'preparedDate': '2026-11-06',
}
(DEST / 'geometry-audit.json').write_text(json.dumps(audit, indent=2))
print(f'Validated {len(areas)} areas, {len(tracts)} census tracts, 27 census subdivisions and continuous shared boundaries.')
