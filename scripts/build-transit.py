#!/usr/bin/env python3
"""Build the atlas rail network from official TTC / Metrolinx GTFS snapshots.

Requires Python packages shapely and pyproj. The committed rail-only snapshot is
reproducible without a download. To replace it from GTFS archives, pass
--feed-dir DIRECTORY containing ttc.zip, go.zip and up.zip. Only subway / LRT
lines 1, 2, 4, 5 and 6 and commuter rail are retained. The map is geographic
context rather than a timetable or a live service status display.
"""
import argparse
import collections
import csv
import datetime
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

from pyproj import Transformer
from shapely.geometry import LineString, Point, box, mapping
from shapely.ops import transform, unary_union

ROOT = Path(__file__).resolve().parents[1]
DAY = datetime.date(2026, 11, 6)
BOUNDS = [-80.1, 43.3, -78.4, 44.55]
SNAPSHOT = ROOT / 'data' / 'sources' / 'transit-rail-snapshot.json.gz'
OUTPUT = ROOT / 'public' / 'data'
AUDIT = ROOT / 'data' / 'audit' / 'transit.json'
SOURCES = {
    'ttc': {
        'operator': 'TTC',
        'url': 'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/7795b45e-e65a-4465-81fc-c36b9dfff169/resource/cfb6b2b8-6191-41e3-bda1-b175c51148cb/download/opendata_ttc_schedules.zip',
        'page': 'https://open.toronto.ca/dataset/ttc-routes-and-schedules/',
        'license': 'Open Government Licence – Toronto',
    },
    'go': {
        'operator': 'GO Transit',
        'url': 'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/GO-GTFS.zip',
        'page': 'https://www.gotransit.com/en/partner-with-us/software-developers',
        'license': 'Metrolinx Access and Use Agreement',
    },
    'up': {
        'operator': 'UP Express',
        'url': 'https://assets.metrolinx.com/raw/upload/Documents/Metrolinx/Open%20Data/UP-GTFS.zip',
        'page': 'https://www.gotransit.com/en/partner-with-us/software-developers',
        'license': 'Metrolinx Access and Use Agreement',
    },
}
# Presentation variants keep each route hue legible against the night basemap.
# Day colors continue to come directly from the official GTFS feed.
NIGHT_COLORS = {
    'ttc1': '#E6D861', 'ttc2': '#7CCB86', 'ttc4': '#E49BEA',
    'ttc5': '#FFAD63', 'ttc6': '#B4BCC2',
    'go-br': '#82ABD3', 'go-ki': '#73C99D', 'go-le': '#FF8A80',
    'go-lw': '#E899AC', 'go-mi': '#F8B477', 'go-rh': '#6BC9E6',
    'go-st': '#C7A374', 'up-up': '#78B8EC',
}
STATUS_SOURCES = [
    'https://www.ttc.ca/news/2026/October/TTC-seeks-rider-feedback-on-Lines-5-and-6',
    'https://www.ttc.ca/news/2026/October/TTC-adjusting-service-beginning-November-1',
    'https://www.ttc.ca/subway-stations/bloor-yonge-station',
]
METROLINX_CREDIT = (
    'Data used in this product or service is provided with the permission of Metrolinx. '
    'Metrolinx makes no representations or warranties of any kind, express or implied, '
    'with respect to the Data and assumes no responsibility for the accuracy or currency '
    'of the data used in this product or service.'
)

def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()


def official_snapshot(directory):
    feeds = {}
    dates = [DAY + datetime.timedelta(days=n) for n in range(7)]
    for agency, source in SOURCES.items():
        path = directory / (agency + '.zip')
        with zipfile.ZipFile(path) as archive:
            def rows(name):
                if name not in archive.namelist():
                    return []
                return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8-sig'))
            calendar = list(rows('calendar.txt'))
            exceptions = list(rows('calendar_dates.txt'))
            services = set()
            for date in dates:
                value = date.strftime('%Y%m%d')
                active = {row['service_id'] for row in calendar
                          if row['start_date'] <= value <= row['end_date']
                          and row[date.strftime('%A').lower()] == '1'}
                for row in exceptions:
                    if row['date'] == value:
                        if row['exception_type'] == '1':
                            active.add(row['service_id'])
                        else:
                            active.discard(row['service_id'])
                services.update(active)
            routes = {row['route_id']: row for row in rows('routes.txt')
                      if (agency == 'ttc' and row['route_id'] in ['1', '2', '4', '5', '6'])
                      or (agency != 'ttc' and row['route_type'] == '2')}
            trips = {row['trip_id']: row for row in rows('trips.txt')
                     if row['route_id'] in routes and row['service_id'] in services}
            route_shapes = collections.defaultdict(set)
            route_stops = collections.defaultdict(set)
            for trip in trips.values():
                route_shapes[trip['route_id']].add(trip['shape_id'])
            for row in rows('stop_times.txt'):
                if row['trip_id'] in trips:
                    route_stops[trips[row['trip_id']]['route_id']].add(row['stop_id'])
            shape_ids = set().union(*route_shapes.values())
            shapes = collections.defaultdict(list)
            for row in rows('shapes.txt'):
                if row['shape_id'] in shape_ids:
                    shapes[row['shape_id']].append([
                        int(row['shape_pt_sequence']),
                        float(row['shape_pt_lon']), float(row['shape_pt_lat'])])
            shapes = {key: [[x[1], x[2]] for x in sorted(value)] for key, value in shapes.items()}
            stop_ids = set().union(*route_stops.values())
            stops = {row['stop_id']: row for row in rows('stops.txt') if row['stop_id'] in stop_ids}
            feeds[agency] = {
                'archiveSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'source': source,
                'feedInfo': list(rows('feed_info.txt')),
                'calendar': calendar,
                'routes': routes,
                'shapes': shapes,
                'stops': stops,
                'routeShapes': {key: sorted(value) for key, value in route_shapes.items()},
                'routeStops': {key: sorted(value) for key, value in route_stops.items()},
                'selectedTripCount': len(trips),
            }
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_bytes(gzip.compress(json_bytes(feeds), mtime=0))
    return feeds


def station_name(agency, text):
    if agency == 'ttc':
        # Official GTFS supplies each directional platform, without parent stations.
        name = re.sub(r'\s*(?:-\s*)?(?:(?:North|South|East|West)bound|LRT|Subway)\s+Platform.*$', '', text).strip()
        return 'Bloor-Yonge Station' if name in ['Bloor Station', 'Yonge Station'] else name
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--feed-dir', type=Path)
    args = parser.parse_args()
    feeds = official_snapshot(args.feed_dir) if args.feed_dir else json.loads(gzip.decompress(SNAPSHOT.read_bytes()))
    project = Transformer.from_crs(4326, 26917, always_xy=True).transform
    geographic = Transformer.from_crs(26917, 4326, always_xy=True).transform
    clip = box(*BOUNDS)
    features = []
    lines = []
    station_groups = {}
    counts = {}
    route_audit = []
    for agency in SOURCES:
        feed = feeds[agency]
        source = feed['source']
        for route_id, route in sorted(feed['routes'].items()):
            short = route['route_short_name'].lower()
            line_id = f'{agency}{short}' if agency == 'ttc' else f'{agency}-{short}'
            name = route['route_long_name']
            if agency == 'go':
                name = 'GO ' + name
            if agency == 'up':
                name = 'UP Express'
            color = '#' + (route.get('route_color') or '557166')
            lines.append({'id': line_id, 'name': name, 'color': color,
                          'darkColor': NIGHT_COLORS[line_id], 'operator': source['operator'], 'status': 'operating'})
            candidates = [(sid, transform(project, LineString(feed['shapes'][sid])))
                          for sid in feed['routeShapes'][route_id]]
            candidates.sort(key=lambda item: (-item[1].length, item[0]))
            retained = []
            selected_ids = []
            coverage = None
            for sid, geom in candidates:
                # Opposite-direction and short-turn trips trace the same corridor.
                # Keep longer variants and any branch adding over 150 metres.
                if coverage is not None and geom.difference(coverage).length <= 150:
                    continue
                retained.append(geom)
                selected_ids.append(sid)
                coverage = unary_union(retained).buffer(40)
            route_geom = transform(geographic, unary_union(retained).simplify(12, preserve_topology=True)).intersection(clip)
            if route_geom.is_empty:
                continue
            coords = mapping(route_geom)
            feature = {'type': 'Feature', 'geometry': coords, 'properties': {
                'kind': 'transit_route', 'id': line_id, 'name': name, 'lineId': line_id,
                'status': 'operating', 'operator': source['operator'],
                'routeNumber': route['route_short_name'], 'sourceUrl': source['page'],
                'geometryQuality': 'official_gtfs', 'sourceShapeIds': selected_ids,
            }}
            features.append(feature)
            route_audit.append({'lineId': line_id, 'sourceRouteId': route_id,
                                'candidateShapeCount': len(candidates), 'retainedShapeIds': selected_ids})
            for stop_id in feed['routeStops'][route_id]:
                stop = feed['stops'][stop_id]
                point = [float(stop['stop_lon']), float(stop['stop_lat'])]
                if not clip.covers(Point(point)):
                    continue
                name = station_name(agency, stop['stop_name'])
                key = (agency, name)
                record = station_groups.setdefault(key, {'name': name, 'lineIds': set(), 'points': {},
                                                         'sourceUrl': source['page'], 'operator': source['operator'],
                                                         'stopUrl': stop.get('stop_url', '')})
                record['lineIds'].add(line_id)
                record['points'][stop_id] = point
        counts[agency] = {'routes': len(feed['routes']), 'sourceStops': len(feed['stops']),
                          'selectedTrips': feed['selectedTripCount']}
    for (agency, name), record in sorted(station_groups.items()):
        points = list(record['points'].values())
        coordinate = [round(sum(p[i] for p in points) / len(points), 7) for i in range(2)]
        slug = re.sub('[^a-z0-9]+', '-', name.lower()).strip('-')
        properties = {'kind': 'transit_station', 'id': f'{agency}-station-{slug}',
                      'name': name, 'lineIds': sorted(record['lineIds']),
                      'status': 'operating', 'operator': record['operator'],
                      'sourceUrl': record['stopUrl'] or record['sourceUrl'],
                      'sourceStopIds': sorted(record['points']),
                      'geometryQuality': 'official_gtfs_platform_centre' if agency == 'ttc' else 'official_gtfs'}
        features.append({'type': 'Feature', 'properties': properties,
                         'geometry': {'type': 'Point', 'coordinates': coordinate}})
    common = {'type': 'FeatureCollection', 'retrievedAt': DAY.isoformat(),
              'sourceDates': {a: f['feedInfo'] or f['calendar'] for a, f in feeds.items()},
              'sources': [{**v, 'id': k} for k, v in SOURCES.items()],
              'attribution': METROLINX_CREDIT,
              'note': 'Official TTC, GO Transit and UP Express GTFS rail geometry. '
                      'Snapshot of services scheduled during 6–12 November 2026, clipped to the GTA context extent. '
                      'Routes provide geographic orientation; check the operator for current service. '
                      'TTC station markers use the mean of directional platform coordinates.'}
    operating = {**common, 'features': features}
    future = {'type': 'FeatureCollection', 'retrievedAt': DAY.isoformat(), 'sources': [],
              'note': 'This edition displays operating rapid transit and regional rail. Future projects are not included.',
              'features': []}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = {'transit-operating.geojson': operating, 'transit-future.geojson': future, 'transit-lines.json': lines}
    checksums = {}
    for file, value in results.items():
        data = json_bytes(value)
        (OUTPUT / file).write_bytes(data)
        checksums[file] = hashlib.sha256(data).hexdigest()
    audit = {'retrievedAt': DAY.isoformat(), 'bounds': BOUNDS, 'statusVerifiedAt': DAY.isoformat(),
             'statusSources': STATUS_SOURCES,
             'ttcOpenDates': {'ttc5': '2026-02-08', 'ttc6': '2025-12-07'},
             'snapshotSha256': hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest(),
             'feedArchives': {a: {'sha256': f['archiveSha256'], 'source': f['source'], 'feedInfo': f['feedInfo']} for a, f in feeds.items()},
             'selection': counts, 'routes': route_audit,
             'publishedRouteCount': sum(f['properties']['kind'] == 'transit_route' for f in features),
             'publishedStationCount': sum(f['properties']['kind'] == 'transit_station' for f in features),
             'attribution': METROLINX_CREDIT, 'outputsSha256': checksums}
    AUDIT.parent.mkdir(parents=True, exist_ok=True)
    AUDIT.write_bytes(json_bytes(audit))
    print(json.dumps({'routes': audit['publishedRouteCount'], 'stations': audit['publishedStationCount'], 'files': checksums}, indent=2))


if __name__ == '__main__':
    main()
