import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedStatistics, statisticAvailable, statisticPopulation } from '../src/statistics-utils.js';

test('linked statistical values stay attached to their complete source feature', () => {
  const feature = { properties: { code: 'DA1', income: 125000, population: 500, totalPopulation: 510 }, geometry: { type: 'Polygon', coordinates: [] } };
  const linked = relatedStatistics('Glen Abbey', { 'Glen Abbey': [{ code: 'DA1', statisticAreaShare: .2 }, { code: 'missing' }] }, new Map([['DA1', feature]]));
  assert.equal(linked.length, 1);
  assert.equal(linked[0].feature, feature);
  assert.equal(linked[0].feature.properties.income, 125000);
  assert.equal(statisticPopulation(feature.properties), 510);
  assert.equal(statisticPopulation({ population: 500, totalPopulation: null }), 500);
});

test('suppressed values are unavailable; a published zero remains data', () => {
  const feature = { properties: { code: 'DA1', income: null } };
  const records = { DA1: { population: 500, counts: { chinese: 0, black: null } } };
  assert.equal(statisticAvailable(feature, records), false);
  assert.equal(statisticAvailable(feature, records, 'chinese'), true);
  assert.equal(statisticAvailable(feature, records, 'black'), false);
  assert.equal(statisticAvailable(undefined, records), false);
});
