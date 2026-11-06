import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const folder = new URL('../public/data/', import.meta.url);
const read = file => JSON.parse(readFileSync(new URL(file, folder), 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(new URL(file, folder))).digest('hex');
const geographyAudit = JSON.parse(readFileSync(new URL('../data/audit/geography.json', import.meta.url)));
const transitAudit = JSON.parse(readFileSync(new URL('../data/audit/transit.json', import.meta.url)));
const collections = [
  'basemap.geojson', 'geographic-context.geojson', 'orientation-landmarks.geojson',
  'transit-operating.geojson', 'transit-future.geojson',
];

function checkCoordinates(value, file) {
  assert.ok(Array.isArray(value), file);
  if (typeof value[0] === 'number') {
    const [longitude, latitude] = value;
    assert.ok(Number.isFinite(longitude) && Number.isFinite(latitude), file);
    assert.ok(longitude >= -80.101 && longitude <= -78.349 && latitude >= 43.249 && latitude <= 44.601, `${file}: coordinates outside GTA display window`);
    return;
  }
  for (const child of value) checkCoordinates(child, file);
}
for (const file of collections) {
  const data = read(file);
  assert.equal(data.type, 'FeatureCollection', file);
  for (const feature of data.features) {
    assert.equal(feature.type, 'Feature', file);
    assert.ok(feature.geometry?.type && feature.properties?.kind, file);
    checkCoordinates(feature.geometry.coordinates, file);
    assert.match(feature.properties.sourceUrl, /^https:\/\//, file);
  }
}
for (const entry of geographyAudit.outputs) {
  assert.equal(hash(entry.file), entry.sha256, `${entry.file}: geography audit mismatch`);
  assert.equal(read(entry.file).features.length, entry.features, entry.file);
}
for (const [file, checksum] of Object.entries(transitAudit.outputsSha256)) {
  assert.equal(hash(file), checksum, `${file}: transit audit mismatch`);
}
const base = read('basemap.geojson').features;
assert.ok(base.filter(feature => feature.properties.kind === 'road').length > 500);
assert.ok(base.some(feature => feature.properties.kind === 'water' && /Ontario/i.test(feature.properties.name)), 'Lake Ontario is missing');
const context = read('geographic-context.geojson').features;
for (const id of ['CYYZ', 'CYTZ']) assert.ok(context.some(feature => feature.properties.airportId === id), id);
assert.ok(context.some(feature => feature.properties.kind === 'park' && /Rouge/i.test(feature.properties.name)), 'Rouge park geometry is missing');
assert.ok(context.some(feature => feature.properties.kind === 'reserve' && /Scugog/i.test(feature.properties.name)), 'Scugog reserve is missing');
assert.ok(context.some(feature => feature.properties.kind === 'railway'));

const places = read('orientation-landmarks.geojson').features;
const names = places.map(feature => feature.properties.name);
assert.equal(new Set(names).size, names.length, 'Duplicate orientation names');
for (const name of ['Toronto', 'Mississauga', 'Brampton', 'Markham', 'Richmond Hill', 'Vaughan', 'Oakville', 'Oshawa', 'CN Tower']) {
  assert.ok(names.includes(name), `Missing orientation label: ${name}`);
}
const lines = read('transit-lines.json');
const lineIds = new Set(lines.map(line => line.id));
assert.equal(lineIds.size, lines.length, 'Duplicate transit lines');
for (const id of ['ttc1', 'ttc2', 'ttc4', 'ttc5', 'ttc6', 'up-up']) assert.ok(lineIds.has(id), id);
const transit = read('transit-operating.geojson');
assert.match(transit.attribution, /permission of Metrolinx/);
const routes = transit.features.filter(feature => feature.properties.kind === 'transit_route');
const stations = transit.features.filter(feature => feature.properties.kind === 'transit_station');
assert.equal(routes.length, transitAudit.publishedRouteCount);
assert.equal(stations.length, transitAudit.publishedStationCount);
assert.equal(new Set(stations.map(feature => feature.properties.id)).size, stations.length, 'Duplicate station ids');
for (const route of routes) {
  assert.ok(lineIds.has(route.properties.lineId));
  assert.equal(route.properties.status, 'operating');
}
for (const station of stations) {
  assert.equal(station.geometry.type, 'Point');
  assert.equal(station.properties.status, 'operating');
  assert.ok(station.properties.lineIds.length);
  for (const id of station.properties.lineIds) assert.ok(lineIds.has(id));
}
console.log(`PASS: official GTA geography, ${routes.length} operating rail lines and ${stations.length} stations, verified sources and output checksums.`);
