import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const read = path => readFile(new URL(`../${path}`, import.meta.url));
const json = async path => JSON.parse(await read(path));
const hash = value => createHash('sha256').update(value).digest('hex');
const [config, audit, geo, data, display, census, neighbourhoods] = await Promise.all([
  json('data/municipal/statistics-sources.json'), json('data/municipal/statistics-audit.json'),
  json('public/data/statistics-areas.geojson'), json('public/data/statistics-data.json'),
  json('public/data/statistics-display.geojson'), json('public/data/communities.geojson'),
  json('public/data/neighbourhoods.geojson'),
]);
for (const [path, expected] of Object.entries(audit.sourceHashes)) assert.equal(hash(await read(path)), expected, path);
for (const [name, expected] of Object.entries(audit.hashes)) assert.equal(hash(await read(`public/data/${name}`)), expected, name);
assert.equal(data.schemaVersion, 1);
const originals = new Map();
const originalRecords = {};
for (const source of config.datasets) {
  for (const f of (await json(source.path)).features) {
    assert.ok(!originals.has(f.properties.code), `Duplicate original: ${f.properties.code}`);
    originals.set(f.properties.code, f);
  }
  Object.assign(originalRecords, (await json(source.dataPath)).records);
}
assert.equal(geo.features.length, originals.size);
for (const f of geo.features) {
  assert.deepEqual(f, originals.get(f.properties.code), `Preserve full geometry and values: ${f.properties.code}`);
  assert.ok(f.properties.name && Array.isArray(f.properties.centroid) && f.properties.centroid.length === 2 && f.properties.centroid.every(Number.isFinite), `Display identity/anchor: ${f.properties.code}`);
}
assert.deepEqual(data.records, originalRecords, 'No derived, allocated, or averaged statistics');
const all = new Map([...census.features, ...geo.features].map(f => [f.properties.code, f]));
const communities = new Map(neighbourhoods.features.map(f => [f.properties.code, f]));
for (const [code, related] of Object.entries(data.relationships)) {
  assert.ok(communities.has(code), code);
  assert.ok(related.length > 0);
  assert.equal(new Set(related.map(r => r.code)).size, related.length);
  for (const r of related) {
    assert.ok(all.has(r.code), r.code);
    assert.ok(r.communityAreaShare > 0 && r.communityAreaShare <= 1.000001, code);
    assert.ok(r.statisticAreaShare > 0 && r.statisticAreaShare <= 1.000001, code);
  }
}
for (const f of display.features) {
  const p = f.properties;
  assert.deepEqual(Object.keys(p).sort(), ['communityCodes', 'income', 'population', 'statisticCode']);
  assert.equal(typeof p.income, 'boolean', 'Mask flags are not statistical values');
  assert.equal(typeof p.population, 'boolean');
  assert.ok(p.income || p.population);
  assert.ok(all.has(p.statisticCode));
  for (const code of p.communityCodes) assert.ok(data.relationships[code]?.some(r => r.code === p.statisticCode), code);
  assert.equal(new Set(p.communityCodes.map(code => communities.get(code).properties.municipalityCode)).size, 1, 'A display mask must not leak into another municipality when filtering scope');
}
const estimatesPath = 'data/municipal/peel-halton/statistics-research/brampton/population-estimates-selected.json';
const estimates = await json(estimatesPath);
const rawEstimates = new Map((await json(estimates.sourcePath)).features.map(f => [f.properties.NEIGHBOURHOOD_NAME, f.properties]));
assert.equal(Object.keys(estimates.records).length, 53);
for (const r of Object.values(estimates.records)) {
  assert.equal(r.populationEstimate, rawEstimates.get(r.name).populationtotals_ecyptapop, r.name);
  assert.equal(r.populationEstimateYear, 2022);
  assert.equal(r.population, null, 'Estimate is not a 2021 population-group denominator');
  assert.equal(r.income, null);
}
// All seven requested cities must offer statistics without losing named boundaries.
for (const city of ['Richmond Hill', 'Vaughan', 'Markham', 'Mississauga', 'Burlington', 'Oakville', 'Brampton']) {
  const selected = neighbourhoods.features.filter(f => f.properties.municipality === city);
  assert.ok(selected.length, city);
  for (const f of selected) assert.ok(data.relationships[f.properties.code]?.length || f.properties.income !== null, `${city}: no path to income/population for ${f.properties.name}`);
}
// Audit York's published DA values directly, including suppressed/null values.
const yorkRoot = 'data/municipal/york/statistics-research/';
const manifest = await json(`${yorkRoot}supplemental-manifest.json`);
for (const s of Object.values(manifest.sources)) assert.equal(hash(await read(yorkRoot + s.file)), s.sha256, s.file);
const income = new Map((await json(yorkRoot + manifest.sources.income.file)).features.map(f => [String(f.properties.DAUID), f]));
const groups = new Map((await json(yorkRoot + manifest.sources.populationGroups.file)).features.map(f => [String(f.properties.DAUID), f]));
const totals = new Map((await json(yorkRoot + manifest.sources.totalPopulation.file)).features.map(f => [String(f.attributes.DAUID), f.attributes]));
const finite = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
for (const f of geo.features.filter(f => f.properties.statisticsMethod === 'municipal_census_da')) {
  const p = f.properties, rawIncome = income.get(p.daId), rawGroups = groups.get(p.daId);
  assert.deepEqual(f.geometry, rawIncome.geometry, `Full original DA: ${p.code}`);
  assert.equal(p.income, finite(rawIncome.properties.MED_TOT_HH));
  assert.equal(p.totalPopulation, finite(totals.get(p.daId).DAPOP2021));
  assert.equal(p.population, finite(rawGroups.properties.TOT_VISIBLE_MINORITY_PVT_HH));
  for (const [id, field] of Object.entries(manifest.sources.populationGroups.fields.counts)) assert.equal(data.records[p.code].counts[id], finite(rawGroups.properties[field]), `${p.code}/${id}`);
}
console.log(`Statistics verified: ${geo.features.length} official areas, ${Object.keys(data.relationships).length} communities linked; original boundaries, values and suppression preserved.`);
