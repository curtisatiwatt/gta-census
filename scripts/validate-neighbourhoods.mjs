import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const cache = new Map();
async function bytes(path) {
  if (!cache.has(path)) cache.set(path, await readFile(new URL(path, root)));
  return cache.get(path);
}
async function json(path) {
  const data = await bytes(path);
  return JSON.parse(path.endsWith('.gz') ? gunzipSync(data) : data);
}
const hash = data => createHash('sha256').update(data).digest('hex');
const scalarStatistics = ['income', 'children', 'householdSize', 'totalPopulation', 'population', 'populationEstimate', 'populationEstimateYear'];
const allStatistics = [...scalarStatistics, 'incomeRank', 'incomeRankTotal', 'chineseCount', 'chinesePct'];
const displayNamesPath = 'data/municipal/peel-halton/display-names.json';
const [geo, data, audit, config, census, censusData, censusMetadata, displayNames] = await Promise.all([
  json('public/data/neighbourhoods.geojson'), json('public/data/neighbourhood-data.json'),
  json('data/municipal/audit.json'), json('data/municipal/datasets.json'),
  json('public/data/communities.geojson'), json('public/data/population-groups.json'),
  json('public/data/metadata.json'), json(displayNamesPath),
]);

assert.equal(geo.type, 'FeatureCollection');
assert.equal(data.schemaVersion, 1);
assert.ok(geo.features.length > 0);
assert.equal(audit.featureCount, geo.features.length);
assert.equal(audit.preparedDate, data.metadata.preparedDate);
assert.deepEqual(data.metadata.municipalCoverage, audit.coverage);
for (const name of ['neighbourhoods.geojson', 'neighbourhood-data.json']) {
  assert.equal(hash(await bytes(`public/data/${name}`)), audit.hashes[name], `Published hash: ${name}`);
}

const datasets = new Map(config.datasets.map(source => [source.id, source]));
assert.equal(datasets.size, config.datasets.length, 'Dataset IDs must be unique');
const requiredSources = new Set(['data/municipal/datasets.json', displayNamesPath,
  ...config.datasets.flatMap(s => [s.path, ...(s.profilePath ? [s.profilePath] : [])])]);
for (const path of requiredSources) {
  assert.ok(Object.hasOwn(audit.sourceHashes, path), `Missing source hash: ${path}`);
}
for (const [path, expected] of Object.entries(audit.sourceHashes)) {
  assert.equal(hash(await bytes(path)), expected, `Source hash: ${path}`);
}
const originals = new Map();
const profiles = new Map();
for (const source of config.datasets) {
  const features = (await json(source.path)).features;
  const byId = new Map(features.map(f => [String(f.properties[source.idField]), f]));
  assert.equal(byId.size, features.length, `Duplicate source IDs: ${source.id}`);
  originals.set(source.id, byId);
  const profileSource = source.profilePath ? await json(source.profilePath) : null;
  profiles.set(source.id, profileSource?.records ?? {});
  for (const key of ['source', 'sourceCsv', 'sourcePath']) {
    if (profileSource?.[key]) assert.ok(Object.hasOwn(audit.sourceHashes, profileSource[key]), `Missing original profile-source hash: ${profileSource[key]}`);
  }
}
const censusByCode = new Map(census.features.map(f => [f.properties.code, f]));
const scopes = new Map(censusMetadata.scopes.filter(s => s.type === 'municipality').map(s => [s.id, s]));
assert.equal(scopes.size, 27, 'All 27 GTA municipalities / First Nations scopes must remain represented');
const groupIds = censusData.groups.map(g => g.id);
assert.equal(groupIds.length, 13);
assert.equal(new Set(groupIds).size, 13);

// -1 is on an edge, 0 outside, 1 strictly inside. An interior anchor must
// also be outside every hole, rather than merely inside an outer ring.
function ringLocation([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const dx = bx - ax, dy = by - ay;
    const cross = (x - ax) * dy - (y - ay) * dx;
    const edgeLength = Math.hypot(dx, dy);
    if (edgeLength > 0 && Math.abs(cross) <= 1e-12 * edgeLength &&
        x >= Math.min(ax, bx) - 1e-12 && x <= Math.max(ax, bx) + 1e-12 &&
        y >= Math.min(ay, by) - 1e-12 && y <= Math.max(ay, by) + 1e-12) return -1;
    if ((ay > y) !== (by > y) && x < ax + (y - ay) * dx / dy) inside = !inside;
  }
  return inside ? 1 : 0;
}
function validateGeometry(feature) {
  const { geometry, properties: p } = feature;
  assert.ok(['Polygon', 'MultiPolygon'].includes(geometry.type), `Polygon required: ${p.code}`);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  assert.ok(polygons.length > 0, `Empty geometry: ${p.code}`);
  for (const rings of polygons) {
    assert.ok(rings.length > 0, `Missing outer ring: ${p.code}`);
    for (const ring of rings) {
      assert.ok(ring.length >= 4, `Incomplete ring: ${p.code}`);
      assert.deepEqual(ring[0], ring.at(-1), `Unclosed ring: ${p.code}`);
      for (const point of ring) {
        assert.ok(point.length >= 2 && point.every(Number.isFinite), `Invalid coordinate: ${p.code}`);
        assert.ok(Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90, `Not WGS84: ${p.code}`);
      }
    }
  }
  assert.ok(Array.isArray(p.centroid) && p.centroid.length === 2 && p.centroid.every(Number.isFinite), `Invalid anchor: ${p.code}`);
  assert.ok(polygons.some(rings => ringLocation(p.centroid, rings[0]) === 1 &&
    rings.slice(1).every(ring => ringLocation(p.centroid, ring) === 0)), `Anchor outside polygon or inside a hole: ${p.code}`);
}
function validValue(value, label) {
  assert.ok(value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0), label);
}
function verifyRecord(record, expected, p) {
  assert.ok(record, `Population record missing: ${p.code}`);
  assert.deepEqual(Object.keys(record.counts).sort(), [...groupIds].sort(), `All 13 original categories: ${p.code}`);
  assert.equal(record.population, expected.population, `Same-table denominator: ${p.code}`);
  validValue(record.population, `Invalid denominator: ${p.code}`);
  assert.equal(p.population, record.population, `Feature/chart denominator mismatch: ${p.code}`);
  for (const id of groupIds) {
    assert.equal(record.counts[id], expected.counts[id], `Published category, including nulls and zeroes: ${p.code}/${id}`);
    validValue(record.counts[id], `Invalid count: ${p.code}/${id}`);
  }
  assert.equal(record.sourceUrl, expected.sourceUrl, `Population source: ${p.code}`);
  assert.equal(p.chineseCount, record.counts.chinese, `Chinese numerator: ${p.code}`);
  assert.equal(p.chinesePct, record.counts.chinese !== null && record.population ? record.counts.chinese / record.population : null,
    `Chinese share uses the same denominator: ${p.code}`);
}
function noStatistics(p) {
  for (const key of allStatistics) assert.ok(p[key] == null, `Modified boundary carries ${key}: ${p.code}`);
  assert.equal(data.communities[p.code], undefined, `Modified boundary carries a population chart: ${p.code}`);
  assert.equal(p.statisticsMethod, 'unavailable', `Modified boundary statistics method: ${p.code}`);
  assert.equal(p.status, 'missing', `Modified boundary income status: ${p.code}`);
  assert.equal(p.sourceUrl, null, `Modified boundary retains a statistics source: ${p.code}`);
}
// Shapely emits coordinate ordinates as Python floats, including an explicit
// .0 for integer values. Preserve that representation for the producer's hash.
function geometryDigest(geometry) {
  const coordinates = value => Array.isArray(value) ? `[${value.map(coordinates).join(',')}]` :
    Number.isInteger(value) ? `${value}.0` : JSON.stringify(value);
  return hash(`{"coordinates":${coordinates(geometry.coordinates)},"type":${JSON.stringify(geometry.type)}}`);
}

const codes = new Set();
const municipalCodes = new Set();
const representedScopes = new Set();
const torontoProfileIds = new Set();
let adjustedCount = 0, fallbackCount = 0, remainderCount = 0, profileCount = 0;
for (const feature of geo.features) {
  const p = feature.properties;
  assert.ok(typeof p.code === 'string' && p.code.length > 0 && !codes.has(p.code), `Duplicate / missing feature ID: ${p.code}`);
  codes.add(p.code);
  assert.equal(feature.id, p.code, `Feature/property identity: ${p.code}`);
  assert.ok(typeof p.name === 'string' && p.name.trim().length > 0, `Missing name: ${p.code}`);
  const scope = scopes.get(p.municipalityCode);
  assert.ok(scope, `Unknown municipality: ${p.code}`);
  assert.equal(p.municipality, scope.name, `Wrong municipality name: ${p.code}`);
  assert.equal(p.regionCode, scope.regionCode, `Wrong region: ${p.code}`);
  representedScopes.add(p.municipalityCode);
  validateGeometry(feature);
  for (const key of scalarStatistics) validValue(p[key] ?? null, `Invalid ${key}: ${p.code}`);
  if (p.children !== null) assert.ok(p.children <= 1, `Children proportion outside 0–1: ${p.code}`);

  if (p.sourceDataset) {
    municipalCodes.add(p.code);
    const source = datasets.get(p.sourceDataset);
    assert.ok(source, `Unknown municipal source: ${p.code}`);
    assert.ok(config.municipalities[p.municipalityCode]?.datasets.includes(source.id), `Source not selected for municipality: ${p.code}`);
    const original = originals.get(source.id).get(p.sourceFeatureId);
    assert.ok(original, `Unknown source feature: ${p.code}`);
    const origin = audit.provenance[p.code];
    assert.ok(origin, `Missing provenance: ${p.code}`);
    assert.equal(origin.sourcePath, source.path, `Provenance path: ${p.code}`);
    assert.equal(origin.sourceId, p.sourceFeatureId, `Provenance identity: ${p.code}`);
    assert.equal(origin.sourceName, String(original.properties[source.nameField]), `Provenance name: ${p.code}`);
    const display = displayNames.datasets[source.id]?.records[p.sourceFeatureId];
    assert.equal(p.name, display?.name ?? source.nameOverrides?.[p.sourceFeatureId] ?? String(original.properties[source.nameField]).trim(), `Official display name: ${p.code}`);
    if (display) {
      assert.equal(display.sourceName, origin.sourceName, `Display-name mapping must preserve the original source name: ${p.code}`);
      assert.deepEqual(p.aliases, display.aliases, `Approved search aliases: ${p.code}`);
      assert.equal(p.type, display.type ?? source.type ?? 'Municipal neighbourhood', `Approved geography type: ${p.code}`);
      assert.equal(p.typeLabel, display.typeLabel ?? source.typeLabel ?? '市政社区', `Approved geography label: ${p.code}`);
    }
    assert.equal(p.municipalSource, source.publisher, `Boundary publisher: ${p.code}`);
    assert.equal(p.boundarySourceUrl, source.sourceUrl, `Boundary citation: ${p.code}`);
    assert.equal(geometryDigest(feature.geometry), origin.displayGeometrySha256, `Display geometry hash: ${p.code}`);
    const profileId = source.numericProfileId ? String(Number(p.sourceFeatureId)) : p.sourceFeatureId;
    assert.equal(origin.profileId, profileId, `Profile join ID (including padded numeric IDs): ${p.code}`);
    const excluded = source.subtractFeatures?.[p.sourceFeatureId] ?? [];
    assert.deepEqual(origin.excludedSourceIds, excluded, `Boundary exclusions: ${p.code}`);
    const clipped = Boolean(source.clipToMunicipality && origin.retainedAreaRatio < 0.995);
    assert.equal(p.clippedToMunicipality, clipped, `Cross-municipal clipping flag: ${p.code}`);
    assert.equal(p.boundaryAdjusted, clipped || excluded.length > 0, `Changed-boundary flag: ${p.code}`);
    if (p.boundaryAdjusted) {
      adjustedCount++;
      noStatistics(p);
      continue;
    }
    const profile = profiles.get(source.id)[profileId];
    for (const key of scalarStatistics) assert.equal(p[key], profile?.[key] ?? null, `Exact municipal profile ${key}: ${p.code}`);
    assert.equal(p.incomeRank, null, `Do not rank unlike municipal geographies: ${p.code}`);
    assert.equal(p.sourceUrl, profile?.sourceUrl ?? null, `Municipal profile citation: ${p.code}`);
    assert.equal(p.statisticsMethod, profile?.statisticsMethod ?? (profile ? 'municipal_profile' : 'unavailable'), `Municipal statistics method: ${p.code}`);
    assert.equal(p.status, p.income === null ? 'missing' : 'reported', `Municipal income status: ${p.code}`);
    if (profile) profileCount++;
    if (profile?.counts != null) {
      verifyRecord(data.communities[p.code], profile, p);
      assert.equal(data.communities[p.code].statisticsMethod, p.statisticsMethod, `Chart statistics method: ${p.code}`);
    } else {
      assert.equal(data.communities[p.code], undefined, `Invented population categories: ${p.code}`);
      assert.equal(p.chineseCount, null, `Invented Chinese count: ${p.code}`);
      assert.equal(p.chinesePct, null, `Invented Chinese share: ${p.code}`);
    }
    if (source.id === 'toronto') {
      assert.ok(profile?.counts, `Toronto neighbourhood lost its official profile: ${p.code}`);
      assert.equal(torontoProfileIds.has(profileId), false, `Duplicate Toronto profile join: ${profileId}`);
      torontoProfileIds.add(profileId);
    }
  } else if (p.geographyType === 'census_remainder') {
    remainderCount++;
    assert.ok(p.code.startsWith('REST-') && censusByCode.has(p.code.slice(5)), `Unknown census remainder: ${p.code}`);
    assert.equal(p.municipalityCode, censusByCode.get(p.code.slice(5)).properties.municipalityCode);
    noStatistics(p);
    assert.equal(p.chineseStatus, 'missing', `Remainder Chinese status: ${p.code}`);
    assert.equal(p.profileUrl, null, `Remainder retains a full-area profile: ${p.code}`);
  } else {
    fallbackCount++;
    const original = censusByCode.get(p.code);
    assert.ok(original, `Unknown whole census fallback: ${p.code}`);
    assert.equal(p.statisticsMethod, 'census_fallback', `Whole census fallback method: ${p.code}`);
    assert.deepEqual(feature.geometry, original.geometry, `Whole fallback changed its census boundary: ${p.code}`);
    for (const key of [...allStatistics, 'dguid', 'name', 'municipalityCode', 'sourceUrl', 'profileUrl', 'geographyType', 'status', 'chineseStatus']) {
      assert.equal(p[key], original.properties[key], `Whole fallback changed ${key}: ${p.code}`);
    }
    assert.deepEqual(data.communities[p.code], censusData.communities[p.code], `Whole fallback changed Census chart data: ${p.code}`);
    verifyRecord(data.communities[p.code], censusData.communities[p.code], p);
  }
}

assert.equal(torontoProfileIds.size, 158, 'All 158 Toronto neighbourhoods must join to their real profiles');
assert.deepEqual([...representedScopes].sort(), [...scopes.keys()].sort(), 'A municipality / First Nation disappeared from the layer');
assert.deepEqual(Object.keys(audit.provenance).sort(), [...municipalCodes].sort(), 'Provenance contains missing or orphan features');
assert.equal(audit.municipalCount, municipalCodes.size);
assert.equal(audit.populationProfileCount, Object.keys(data.communities).length);
for (const code of Object.keys(data.communities)) assert.ok(codes.has(code), `Orphan population record: ${code}`);
assert.equal(audit.coverage.length, scopes.size);
assert.equal(new Set(audit.coverage.map(c => c.municipalityCode)).size, scopes.size);
for (const coverage of audit.coverage) {
  const features = geo.features.filter(f => f.properties.municipalityCode === coverage.municipalityCode);
  assert.equal(coverage.municipalAreas, features.filter(f => f.properties.sourceDataset).length, `Municipal coverage count: ${coverage.municipality}`);
  assert.equal(coverage.fallbackAreas, features.filter(f => !f.properties.sourceDataset).length, `Fallback coverage count: ${coverage.municipality}`);
  assert.deepEqual(coverage.datasets, config.municipalities[coverage.municipalityCode]?.datasets ?? [], `Selected datasets: ${coverage.municipality}`);
  if (config.municipalities[coverage.municipalityCode]?.completeCoverage) assert.equal(coverage.fallbackAreas, 0, `Complete municipal coverage gained census fragments: ${coverage.municipality}`);
}
console.log(`PASS: ${municipalCodes.size} official named areas; ${profileCount} matching municipal profiles including all 158 Toronto neighbourhoods; ${fallbackCount} unchanged census fallbacks; ${remainderCount} census remainders without statistics; ${adjustedCount} adjusted boundaries with no statistics; all 27 scopes, 13-category joins, anchors, provenance and hashes verified.`);
