"""Build a municipal-first display layer without reallocating census statistics.

Requires shapely and pyproj. Run after extracting pinned municipal profiles.
Census assets remain independent and unchanged, and are a switchable map layer.
"""
import gzip
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform, unary_union
from shapely import make_valid

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/data'
MUNICIPAL = ROOT / 'data/municipal'
PROJECT = Transformer.from_crs(4326, 26917, always_xy=True).transform
REGIONS = {'3518': 'Durham', '3519': 'York', '3520': 'Toronto', '3521': 'Peel', '3524': 'Halton'}


def read(path):
    path = ROOT / path
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_text())


def sha(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def area(geometry):
    return transform(PROJECT, geometry).area


def polygon(geometry):
    if not geometry.is_valid:
        geometry = make_valid(geometry)
    if geometry.geom_type == 'GeometryCollection':
        geometry = unary_union([g for g in geometry.geoms if g.geom_type in ('Polygon', 'MultiPolygon')])
    assert geometry.geom_type in ('Polygon', 'MultiPolygon'), geometry.geom_type
    return geometry


def write(name, value):
    path = PUBLIC / name
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
    return sha(path.relative_to(ROOT))


def main():
    config = read('data/municipal/datasets.json')
    census = read('public/data/communities.geojson')
    census_data = read('public/data/population-groups.json')
    groups = [g['id'] for g in census_data['groups']]
    municipalities = {f['properties']['CSDUID']: f for f in read('data/census/geometry/municipalities-raw.geojson.gz')['features']}
    features, records, provenance, coverage = [], {}, {}, []
    source_hashes, links = {'data/municipal/datasets.json': sha('data/municipal/datasets.json')}, {}
    display_path = 'data/municipal/peel-halton/display-names.json'
    display_names = read(display_path)['datasets']
    source_hashes[display_path] = sha(display_path)
    for source in config['datasets']:
        path = source['path']; source_hashes[path] = sha(path)
        links[source['sourceUrl']] = {'label': source['publisher'] + ' · ' + source['title'], 'url': source['sourceUrl']}
        if source.get('profilePath'):
            source_hashes[source['profilePath']] = sha(source['profilePath'])
            profile_source = read(source['profilePath'])
            for key in ['source', 'sourceCsv', 'sourcePath']:
                if profile_source.get(key):
                    source_hashes[profile_source[key]] = sha(profile_source[key])
    datasets = {s['id']: s for s in config['datasets']}
    raw = {key: read(s['path'])['features'] for key, s in datasets.items()}
    profiles = {key: read(s['profilePath'])['records'] if s.get('profilePath') else {} for key, s in datasets.items()}
    for csd, municipal_feature in municipalities.items():
        city = municipal_feature['properties']['CSDNAME']
        city_geometry = polygon(shape(municipal_feature['geometry']))
        city_features = []
        selected = [datasets[s] for s in config['municipalities'].get(csd, {}).get('datasets', [])]
        for source in selected:
            for original in raw[source['id']]:
                op = original['properties']
                if source.get('filter') and any(str(op.get(k)) != str(v) for k,v in source['filter'].items()):
                    continue
                if source.get('municipalityField') and str(op.get(source['municipalityField'])) not in [city, csd]:
                    continue
                original_geometry = polygon(shape(original['geometry']))
                if not original_geometry.intersects(city_geometry):
                    continue
                intersected = polygon(original_geometry.intersection(city_geometry)) if original_geometry.intersection(city_geometry).area else None
                if intersected is None or area(intersected) < 10000:
                    continue
                retained = area(intersected) / area(original_geometry)
                # Ignore marginal cross-city slivers caused by different shoreline/road precision.
                if retained < .01:
                    continue
                source_id = str(op[source['idField']])
                display = display_names.get(source['id'], {}).get('records', {}).get(source_id, {})
                name = str(op[source['nameField']]).strip()
                assert name and name != 'None', (source['id'], source_id)
                name = source.get('nameOverrides', {}).get(source_id, name)
                name = display.get('name', name)
                # City-authored boundaries are authoritative, including their own
                # shoreline. Do not crop Toronto's Islands to a federal shoreline.
                substantial_clip = source.get('clipToMunicipality', False) and retained < .995
                geometry = intersected if substantial_clip else original_geometry
                subtract_ids = source.get('subtractFeatures', {}).get(source_id, [])
                if subtract_ids:
                    exclusions = [polygon(shape(f['geometry'])) for f in raw[source['id']] if str(f['properties'][source['idField']]) in subtract_ids]
                    geometry = polygon(geometry.difference(unary_union(exclusions)))
                modified_boundary = substantial_clip or bool(subtract_ids)
                code = f"NB{csd}-{source['id']}-{source_id}"
                point = geometry.representative_point()
                profile_id = str(int(source_id)) if source.get('numericProfileId') else source_id
                profile = profiles[source['id']].get(profile_id) if not modified_boundary else None
                caveat = (profile or {}).get('caveat') or '采用官方命名分区。尚未取得与此规划边界匹配的完整社区统计；可直接选择上方相交统计区，查看其人口、收入及完整范围。'
                caveat_en = (profile or {}).get('caveatEn') or 'Official named boundaries are used. A complete matching community profile has not been obtained. Select an overlapping statistical area above to see its population, income and complete boundary.'
                if substantial_clip:
                    caveat += ' 此区域跨越市界，当前只显示本市部分；不沿用原完整区域的统计值。'
                    caveat_en += ' This neighbourhood crosses municipal borders. Only the part in this municipality is shown; statistics for the complete neighbourhood are not reused.'
                if subtract_ids:
                    caveat += ' 为避免重叠，已从此范围移除官方单列的Ashgrove村落。'
                    caveat_en += ' The separately named official Ashgrove rural cluster is excluded from this polygon to avoid overlap.'
                profile = profile or {}
                counts = profile.get('counts')
                population = profile.get('population')
                chinese = counts.get('chinese') if counts else None
                p = {
                    'code': code, 'name': name, 'aliases': display.get('aliases', profile.get('aliases', [])),
                    'municipalityCode': csd, 'municipality': city,
                    'regionCode': csd[:4], 'region': REGIONS[csd[:4]], 'sector': csd[:4], 'sectorLabel': REGIONS[csd[:4]],
                    'geographyType': source.get('geographyType','neighbourhood'),
                    'type': display.get('type', source.get('type','Municipal neighbourhood')), 'typeLabel': display.get('typeLabel', source.get('typeLabel','市政社区')),
                    'municipalSource': source['publisher'], 'boundarySourceUrl': source['sourceUrl'],
                    'boundaryReference': source.get('reference','Official source snapshot retrieved 2026-11-06'),
                    'sourceFeatureId': source_id, 'sourceDataset': source['id'],
                    'sourceUrl': profile.get('sourceUrl'), 'statisticsMethod': profile.get('statisticsMethod', 'municipal_profile' if profile else 'unavailable'),
                    'income': profile.get('income'), 'incomeRank': None, 'children': profile.get('children'),
                    'householdSize': profile.get('householdSize'), 'totalPopulation': profile.get('totalPopulation'),
                    'populationEstimate': profile.get('populationEstimate'), 'populationEstimateYear': profile.get('populationEstimateYear'),
                    'population': population, 'chineseCount': chinese,
                    'chinesePct': chinese / population if chinese is not None and population else None,
                    'status': 'reported' if profile.get('income') is not None else 'missing',
                    'centroid': [point.x,point.y], 'anchorMethod': 'interior_representative_point',
                    'roundedStatistics': True, 'clippedToMunicipality': substantial_clip, 'boundaryAdjusted': modified_boundary,
                    'caveat': caveat, 'caveatEn': caveat_en,
                }
                f = {'type':'Feature','id':code,'properties':p,'geometry':mapping(geometry)}
                city_features.append(f)
                if counts is not None:
                    assert set(counts) == set(groups), code
                    records[code] = {'population':population,'counts':counts,'sourceUrl':profile['sourceUrl'],'statisticsMethod':p['statisticsMethod']}
                provenance[code] = {'sourcePath':source['path'], 'sourceId':source_id, 'profileId':profile_id, 'sourceName':str(op[source['nameField']]), 'displayGeometrySha256':digest(f['geometry']), 'retainedAreaRatio':retained, 'excludedSourceIds':subtract_ids}
        municipal_geometries = [shape(f['geometry']) for f in city_features]
        covered = unary_union(municipal_geometries)
        # Only significant unserved areas get a federal fallback. Narrow cartographic
        # discrepancies along edges do not create tiny, misleading named communities.
        fallback_count = 0
        for original in census['features']:
            if config['municipalities'].get(csd, {}).get('completeCoverage'):
                break
            if original['properties']['municipalityCode'] != csd:
                continue
            original_geometry = shape(original['geometry'])
            residual = original_geometry.difference(covered) if city_features else original_geometry
            if residual.is_empty:
                continue
            retained = area(residual) / area(original_geometry)
            if city_features and (retained < .01 or area(residual) < 10000):
                continue
            f = json.loads(json.dumps(original)); p=f['properties']
            whole = not municipal_geometries or original_geometry.intersection(covered).area == 0
            if whole:
                if p['code'] in census_data['communities']:
                    records[p['code']] = census_data['communities'][p['code']]
                p['statisticsMethod'] = 'census_fallback'
            else:
                p['code'] = 'REST-' + p['code']; f['id'] = p['code']
                f['geometry'] = mapping(polygon(residual))
                for key in ['income','incomeRank','incomeRankTotal','children','householdSize','population','totalPopulation','chineseCount','chinesePct']:
                    p[key] = None
                p['statisticsMethod']='unavailable'; p['geographyType']='census_remainder'; p['typeLabel']='普查补充区';p['type']='Census fallback area'
                p['status']='missing'; p['chineseStatus']='missing'; p['smallPopulation']=False
                p['caveat']='此处没有所采用市政分区的边界，以普查区的未覆盖部分补充。局部范围不沿用完整普查区的统计；请切换普查统计区查看。'
                p['caveatEn']='This location is outside the adopted municipal boundary dataset, so the uncovered part of a census area is shown. Full-area statistics are not assigned to this fragment; switch to census areas to view them.'
                p['sourceUrl']=None; p['profileUrl']=None
            point=shape(f['geometry']).representative_point();p['centroid']=[point.x,point.y]
            p['fallbackReason']=config['municipalities'].get(csd,{}).get('fallbackReason','No adopted named municipal or regional polygon covers this location.')
            p['boundarySourceUrl']='https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm'
            city_features.append(f);fallback_count+=1
        overlap = sum(area(g) for g in municipal_geometries) - area(covered)
        coverage.append({'municipalityCode':csd,'municipality':city,'municipalAreas':len(municipal_geometries),'fallbackAreas':fallback_count,'municipalCoverageRatio':area(covered.intersection(city_geometry))/area(city_geometry) if municipal_geometries else 0,'municipalOverlapSquareMetres':overlap,'datasets':[s['id'] for s in selected]})
        features.extend(city_features)
    features.sort(key=lambda f:(f['properties']['municipality'],f['properties']['name']))
    assert len({f['properties']['code'] for f in features}) == len(features)
    metadata={
        'preparedDate':'2026-11-06',
        'boundaryNote':'默认优先使用各市政府正式命名社区、规划区；缺少可用市级分区时采用区域政府的命名社区，仍无覆盖处才补充联邦普查区。各分区的来源可在详情查看。普查统计区图层独立保留原始2021年普查边界。',
        'missingDataNote':'社区原表仅展示对应边界的资料；缺项由独立的相交统计区资料补充，可直接选择并查看其完整范围。底色使用对应统计区完整数值，不将人口分摊或平均中位数当作社区统计。Brampton另明确标注2022年市府发布人口估算。',
        'scopeNote':'同名社区在不同城市分别标识。跨市区域只显示本市部分时，不沿用整个区域的人口与收入。地图名称是所引政府数据的正式名称，不代表所有民间街区或地产片区。',
        'childrenDefinition':'Toronto社区使用市政府2021年社区定制表的0–14岁比例（25%抽样）；其他区域仅使用对应官方表的同年龄指标。',
        'license':'包含Toronto、Mississauga、Brampton、Caledon、Oakville、Burlington、Milton、Halton Hills、Pickering、Ajax、Oshawa、York及Durham政府资料。许可和署名要求见各项官方来源与仓库来源清单。Contains public sector information made available under The Regional Municipality of York’s Open Data Licence. Contains information licensed under the Open Government Licence – Town of Oakville. 加拿大统计局数据按其开放许可使用；Leaflet使用BSD 2-Clause许可。',
        'english':{
            'boundaryNote':'The default layer prioritizes official municipal neighbourhoods and planning areas, then named regional-government neighbourhoods. Federal census areas fill remaining gaps. Each area links to its boundary source. The separate census layer preserves the original 2021 boundaries.',
            'missingDataNote':'Community profiles contain only matching statistics. Linked overlapping statistical areas supply additional figures with their full boundaries. Shading retains complete statistical-area values; population is never apportioned and medians are never averaged into community statistics. Brampton population estimates are explicitly labelled 2022.',
            'scopeNote':'Neighbourhoods with the same name in different municipalities remain separate. Where a cross-border neighbourhood is clipped to a municipality, full-area statistics are not reused. Names follow the cited government datasets and do not enumerate every informal or real-estate neighbourhood.',
            'childrenDefinition':'Toronto neighbourhoods use the published age 0–14 percentage in the City custom 2021 profile (25% sample). Elsewhere only corresponding official age indicators are used.',
            'license':'Contains municipal and regional government information from the credited sources; source-specific licences and attribution are recorded in the repository manifests. Contains public sector information made available under The Regional Municipality of York’s Open Data Licence. Contains information licensed under the Open Government Licence – Town of Oakville. Federal census data use the Statistics Canada Open Licence. Leaflet uses the BSD 2-Clause licence.',
        },
        'sources':list(links.values()), 'municipalCoverage':coverage,
    }
    hashes={'neighbourhoods.geojson':write('neighbourhoods.geojson',{'type':'FeatureCollection','features':features}), 'neighbourhood-data.json':write('neighbourhood-data.json',{'schemaVersion':1,'communities':records,'metadata':metadata})}
    audit={'preparedDate':'2026-11-06','featureCount':len(features),'municipalCount':sum(bool(f['properties'].get('municipalSource')) for f in features),'populationProfileCount':len(records),'coverage':coverage,'sourceHashes':source_hashes,'hashes':hashes,'provenance':provenance}
    (MUNICIPAL/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in audit.items() if k not in ['provenance','sourceHashes']},ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
