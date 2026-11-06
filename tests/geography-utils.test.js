import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScopeHash, scopeHash, hasPopulationRecord } from '../src/geography-utils.js';

test('shared city links preserve either boundary mode across refresh', () => {
  for (const mode of ['census', 'neighbourhoods']) {
    assert.deepEqual(parseScopeHash(scopeHash('3519036', mode)), { scopeId: '3519036', mode });
  }
  assert.equal(scopeHash('gta', 'census'), '#scope=gta&boundary=census');
  assert.deepEqual(parseScopeHash(scopeHash('City & region + 中文', 'census')), {
    scopeId: 'City & region + 中文', mode: 'census',
  });
});

test('original city links and unrecognized modes default to municipal neighbourhoods', () => {
  for (const hash of ['#scope=3520005', '#scope=3520005&boundary=', '#scope=3520005&boundary=unknown']) {
    assert.deepEqual(parseScopeHash(hash), { scopeId: '3520005', mode: 'neighbourhoods' });
  }
  assert.equal(scopeHash('gta', 'unknown'), '#scope=gta&boundary=neighbourhoods');
});

test('malformed, empty and non-scope links are safely ignored', () => {
  for (const hash of [null, undefined, 123, '', '#CT5350001.00', '#scope=', '#scope=%20',
    '#scope=%E0%A4%A', '#scope=%FF', '#scope=%', '#scope=gta&boundary=%ZZ',
    '#scope=gta&scope=3520005', '#scope=gta&boundary=census&boundary=neighbourhoods']) {
    assert.equal(parseScopeHash(hash), null, String(hash));
  }
  assert.throws(() => scopeHash(null, 'census'), TypeError);
});

test('population coverage counts reported zero and incomplete but usable categories', () => {
  assert.equal(hasPopulationRecord({ population: 100, counts: { chinese: 0 } }), true);
  assert.equal(hasPopulationRecord({ population: 100, counts: { chinese: null, black: 20 } }), true);
  const records = [{ population: null, counts: { chinese: null } }, { population: 100, counts: { chinese: 0 } }];
  assert.equal(records.filter(hasPopulationRecord).length, 1);
});

test('missing or invalid denominators and categories never count as population coverage', () => {
  for (const population of [null, undefined, '100', 0, -1, NaN, Infinity]) {
    assert.equal(hasPopulationRecord({ population, counts: { chinese: 10 } }), false);
  }
  for (const counts of [null, undefined, {}, [], [0], '10', { chinese: null },
    { chinese: undefined }, { chinese: '10' }, { chinese: -1 }, { chinese: NaN }, { chinese: Infinity }]) {
    assert.equal(hasPopulationRecord({ population: 100, counts }), false);
  }
  assert.equal(hasPopulationRecord(null), false);
});
