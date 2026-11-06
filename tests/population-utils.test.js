import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POPULATION_GROUP_IDS, POPULATION_BINS, POPULATION_NO_DATA_COLOR,
  populationShare, compositionSegments, populationColor, donutSvg,
} from '../src/population-utils.js';

function record(overrides = {}, population = 1000) {
  return {
    population,
    counts: { ...Object.fromEntries(POPULATION_GROUP_IDS.map(id => [id, 0])), ...overrides },
  };
}

test('exact shares use the table denominator, preserve zero and distinguish missing data', () => {
  const data = record({ chinese: 85, not_visible_minority: 915 });
  data.publishedPct = { chinese: 0.09 };
  assert.equal(populationShare(data, 'chinese'), 0.085);
  assert.equal(populationShare(data, 'south_asian'), 0);
  assert.equal(populationShare(data, 'invented_category'), null);
  assert.equal(populationShare(null, 'chinese'), null);
  assert.equal(populationShare({ ...data, population: 0 }, 'chinese'), null);
  assert.equal(populationShare({ ...data, population: '1000' }, 'chinese'), null);
  delete data.counts.chinese;
  assert.equal(populationShare(data, 'chinese'), null);
});

test('rounding affects only the ring: selected and unselected counts remain intact', () => {
  const data = record({ chinese: 100, south_asian: 205, not_visible_minority: 700 });
  const segments = compositionSegments(data, ['chinese', 'south_asian', 'chinese']);
  assert.deepEqual(segments.map(({ id, count }) => ({ id, count })), [
    { id: 'chinese', count: 100 }, { id: 'south_asian', count: 205 }, { id: 'other', count: 700 },
  ]);
  assert.equal(segments[0].share, 100 / 1005);
  assert.ok(Math.abs(segments.reduce((sum, segment) => sum + segment.share, 0) - 1) < 1e-12);
  assert.equal(populationShare(data, 'chinese'), 0.1);
  assert.equal(data.counts.not_visible_minority, 700);
});

test('under-reported categories leave an explicit gap instead of inflating known group shares', () => {
  const data = record({ chinese: 100, not_visible_minority: 320 }, 460);
  const selected = compositionSegments(data, ['chinese']);
  assert.deepEqual(selected, [
    { id: 'chinese', count: 100, share: 100 / 460 },
    { id: 'other', count: 320, share: 320 / 460 },
    { id: 'statistical_gap', count: 40, share: 40 / 460 },
  ]);
  assert.equal(selected[0].share, populationShare(data, 'chinese'));
  assert.ok(Math.abs(selected.reduce((sum, segment) => sum + segment.share, 0) - 1) < 1e-12);
  const all = compositionSegments(data, POPULATION_GROUP_IDS);
  assert.equal(all.some(segment => segment.id === 'other'), false);
  assert.deepEqual(all.at(-1), { id: 'statistical_gap', count: 40, share: 40 / 460 });
  assert.match(donutSvg(data, ['chinese'], { chinese: '#C084FC' }), /stroke="#ffffff"/);
});

test('missing categories cannot be quietly included as zero or as the remainder', () => {
  const complete = record({ chinese: 100, not_visible_minority: 900 });
  for (const invalid of [undefined, null, NaN, -5, '0']) {
    const partial = { ...complete, counts: { ...complete.counts, korean: invalid } };
    assert.deepEqual(compositionSegments(partial, ['chinese']), []);
    assert.equal(donutSvg(partial, ['chinese'], { chinese: '#6a5acd' }), '');
  }
  assert.deepEqual(compositionSegments({ ...complete, population: null }, ['chinese']), []);
  assert.deepEqual(compositionSegments(record(), ['chinese']), []);
});

test('selection does not redefine percentages and empty selection draws no rings', () => {
  const data = record({ chinese: 100, south_asian: 200, not_visible_minority: 700 });
  const one = compositionSegments(data, ['chinese']);
  const two = compositionSegments(data, ['chinese', 'south_asian']);
  assert.equal(one[0].share, two[0].share);
  assert.deepEqual(one[1], { id: 'other', count: 900, share: 0.9 });
  assert.deepEqual(compositionSegments(data, []), []);
  assert.deepEqual(compositionSegments(data, ['not_a_real_group']), []);
  assert.equal(donutSvg(data, []), '');
  assert.deepEqual(compositionSegments(data, ['korean']), [{ id: 'other', count: 1000, share: 1 }]);
  const all = compositionSegments(data, POPULATION_GROUP_IDS);
  assert.equal(all.some(segment => segment.id === 'other'), false);
  assert.equal(all.length, 3);
});

test('all heat maps use the same absolute bins, including boundaries and unavailable data', () => {
  assert.equal(populationColor(0), POPULATION_BINS[0].color);
  assert.notEqual(populationColor(0), POPULATION_NO_DATA_COLOR);
  assert.equal(populationColor(0.0499), POPULATION_BINS[0].color);
  assert.equal(populationColor(0.05), POPULATION_BINS[1].color);
  assert.equal(populationColor(0.1), POPULATION_BINS[2].color);
  assert.equal(populationColor(0.2), POPULATION_BINS[3].color);
  assert.equal(populationColor(0.3), POPULATION_BINS[4].color);
  assert.equal(populationColor(0.4), POPULATION_BINS[5].color);
  assert.equal(populationColor(0.75), populationColor(0.95));
  for (const invalid of [undefined, null, NaN, -0.1, '0.2']) {
    assert.equal(populationColor(invalid), POPULATION_NO_DATA_COLOR);
  }
  // Equal shares give the same shade despite different community sizes.
  assert.equal(populationColor(populationShare(record({ chinese: 200 }), 'chinese')),
    populationColor(populationShare(record({ chinese: 400 }, 2000), 'chinese')));
});

test('donut SVG permits only safe colors and numeric dimensions; no source labels are inserted', () => {
  const data = record({ chinese: 100, not_visible_minority: 900 });
  const svg = donutSvg(data, ['chinese'], { chinese: '#c084fc" onload="alert(1)' }, '<script>');
  assert.match(svg, /width="32"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.doesNotMatch(svg, /onload|alert|script|chinese/);
  assert.match(svg, /stroke="#4c7870"/);
  assert.match(donutSvg(data, ['chinese'], { chinese: '#C084FC' }, 24), /stroke="#C084FC"/);
});
