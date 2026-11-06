import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const bytes = path => readFile(new URL(path, root));
const json = async path => JSON.parse(await bytes(path));
const hash = data => createHash('sha256').update(data).digest('hex');
const [geo, population, metadata, manifest, audit, geometryAudit, geometry] = await Promise.all([
  json('public/data/communities.geojson'), json('public/data/population-groups.json'), json('public/data/metadata.json'),
  json('data/census/sources.json'), json('data/census/audit.json'), json('data/census/geometry/geometry-audit.json'),
  json('data/census/geometry/areas.geojson'),
]);
for (const [name, expected] of Object.entries(audit.hashes)) assert.equal(hash(await bytes(`public/data/${name}`)), expected, `Published hash ${name}`);
assert.equal(hash(await bytes('data/census/geometry/areas.geojson')), geometryAudit.displaySha256);
assert.equal(geometryAudit.displayGeometriesValid, true);
assert.equal(geometryAudit.displayCoverageTopologyValid, true);
assert.deepEqual(geometryAudit.crossing, []);
assert.equal(geo.features.length, 1342);
assert.equal(new Set(geo.features.map(f => f.properties.code)).size, 1342);
assert.equal(population.groups.length, 13);
assert.equal(metadata.scopes.length, 33);
assert.equal(metadata.cityIncomeMedian, null);
assert.equal(metadata.scopes.find(s => s.id === 'gta').incomeMedian, null);

const source = new Map();
for (const extract of manifest.extracts) {
  const content = await bytes(extract.path);
  assert.equal(hash(content), extract.sha256, `Source hash ${extract.path}`);
  const [heading, ...lines] = content.toString('utf8').trim().split(/\r?\n/);
  const columns = heading.split(',');
  for (const line of lines) {
    // These pinned SDMX extracts contain numeric codes only, with no quoted cells.
    assert.equal(line.includes('"'), false, 'Revisit CSV parsing if the source format changes');
    const values = line.split(',');
    assert.equal(values.length, columns.length);
    const row = Object.fromEntries(columns.map((key, i) => [key, values[i]]));
    assert.equal(row.GENDER, '1');
    assert.equal(row.STATISTIC, '1');
    const key = `${row.REF_AREA.replace('_', '.')}/${row.CHARACTERISTIC}`;
    assert.equal(source.has(key), false, `Duplicate source cell ${key}`);
    source.set(key, row);
  }
}
function sourceValue(dguid, characteristic) {
  const row = source.get(`${dguid}/${characteristic}`);
  assert.ok(row, `Source cell missing ${dguid}/${characteristic}`);
  if (row.OBS_VALUE === '' || ['1', '2', '4', '6', 'O'].includes(row.FLAG)) return null;
  return Number(row.OBS_VALUE);
}
function containsRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function contains(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings => containsRing(point, rings[0]) && !rings.slice(1).some(ring => containsRing(point, ring)));
}
function verifyRecord(record, dguid) {
  assert.equal(record.population, sourceValue(dguid, 1669), `Same-table denominator ${dguid}`);
  for (let i = 0; i < population.groups.length; i++) {
    const id = population.groups[i].id;
    assert.equal(record.counts[id], sourceValue(dguid, 1671 + i), `Count ${dguid}/${id}`);
  }
}
const boundaryByDguid = new Map(geometry.features.map(f => [f.properties.DGUID, f]));
const scopes = new Map(metadata.scopes.map(s => [s.id, s]));
const fallbacks = [];
let suppressed = 0, zeros = 0;
for (const f of geo.features) {
  const p = f.properties;
  const original = boundaryByDguid.get(p.dguid);
  assert.ok(original, p.dguid);
  assert.deepEqual(f.geometry, original.geometry, `Statistical join changed a boundary ${p.code}`);
  assert.equal(p.municipalityCode, original.properties.CSDUID);
  assert.equal(p.regionCode, original.properties.CDUID);
  assert.equal(p.municipality, original.properties.CSDNAME);
  assert.ok(contains(p.centroid, f.geometry), `Anchor outside boundary ${p.code}`);
  assert.equal(p.income, sourceValue(p.dguid, 229), `Income ${p.code}`);
  assert.equal(p.totalPopulation, sourceValue(p.dguid, 1));
  assert.equal(p.householdSize, sourceValue(p.dguid, 56));
  const children = sourceValue(p.dguid, 35);
  assert.equal(p.children, children === null ? null : children / 100);
  const record = population.communities[p.code];
  verifyRecord(record, p.dguid);
  assert.equal(p.population, record.population);
  assert.equal(p.chineseCount, record.counts.chinese);
  assert.equal(p.chinesePct, p.chineseCount !== null && p.population ? p.chineseCount / p.population : null);
  if (p.chineseCount === 0) { zeros++; assert.equal(p.chineseStatus, 'reported_zero_rounded'); }
  if (p.income === null) { suppressed++; assert.equal(p.status, 'suppressed'); }
  assert.ok(scopes.has(p.municipalityCode) && scopes.has(p.regionCode));
  if (p.geographyType === 'municipality') {
    fallbacks.push(p.municipalityCode);
    assert.equal(p.incomeRank, null);
    assert.equal(p.type, 'Census subdivision');
  } else if (p.income !== null) {
    const peers = geo.features.map(f => f.properties).filter(peer => peer.municipalityCode === p.municipalityCode && peer.geographyType === 'tract' && peer.income !== null);
    assert.equal(p.incomeRankTotal, peers.length);
    assert.equal(p.incomeRank, 1 + peers.filter(peer => peer.income > p.income).length);
  }
}
assert.deepEqual(fallbacks.sort(), ['3518020', '3518022', '3518039']);
assert.equal(suppressed, 8);
for (const scope of metadata.scopes.filter(s => s.id !== 'gta')) {
  const dguid = `${scope.type === 'region' ? '2021A0003' : '2021A0005'}${scope.id}`;
  assert.equal(scope.incomeMedian, sourceValue(dguid, 229));
  verifyRecord(population.scopes[scope.id], dguid);
}
for (const [code, median, chinese] of [['3519036', 104000, 161415], ['3519038', 102000, 64120], ['3519028', 124000, 26815], ['3520005', 84000, 296225]]) {
  assert.equal(scopes.get(code).incomeMedian, median);
  assert.equal(population.scopes[code].counts.chinese, chinese);
}
const regionIds = ['3518', '3519', '3520', '3521', '3524'];
assert.equal(population.scopes.gta.population, regionIds.reduce((sum, id) => sum + population.scopes[id].population, 0));
for (const group of population.groups) assert.equal(population.scopes.gta.counts[group.id], regionIds.reduce((sum, id) => sum + population.scopes[id].counts[group.id], 0));
console.log(`PASS: 1,342 official areas; 33 scope baselines; 13 population categories; ${suppressed} suppressed incomes and ${zeros} published Chinese zeros; every published value, geographic join, anchor and source checksum verified.`);
