import test from 'node:test';
import assert from 'node:assert/strict';
import { clipSegment, groupRoadLabels, roadLabelName, visibleLineAnchors, visibleWaterAnchors } from '../src/label-placement.js';

const project = ([x, y]) => ({ x, y });
const size = { x: 400, y: 300 };

test('a road crossing the viewport has visible anchors even when its original midpoint is off screen', () => {
  const anchors = visibleLineAnchors([[[-1000, 100], [100, 100]]], project, size, 80);
  assert.ok(anchors.length);
  assert.ok(anchors.every(p => p.x >= 50 && p.x <= 100 && p.y === 100));
  const crossing = visibleLineAnchors([[[-1000, 120], [1000, 120]]], project, size, 80);
  assert.ok(crossing.some(p => p.x === 200 && p.y === 120));
  assert.deepEqual(visibleLineAnchors([[[-100, -50], [500, -50]]], project, size), []);
});

test('clipping cannot bridge disjoint road pieces or create an off-road label', () => {
  assert.deepEqual(clipSegment({ x: -10, y: 50 }, { x: 110, y: 50 }, { left: 0, right: 100, top: 0, bottom: 100 }), [{ x: 0, y: 50 }, { x: 100, y: 50 }]);
  const anchors = visibleLineAnchors([[[60, 70], [110, 70]], [[260, 240], [340, 240]]], project, size, 80);
  assert.ok(anchors.length === 2);
  assert.ok(anchors.every(p => p.y === 70 || p.y === 240));
});

test('opposite travel directions share a road label without losing address quadrants', () => {
  const feature = (name, classes = []) => ({ properties: { name, classes }, geometry: { type: 'MultiLineString', coordinates: [[[1, 2], [3, 4]]] } });
  const groups = groupRoadLabels([feature('100 Ave EB NW'), feature('100 Ave WB NW'), feature('100 Ave NE'), feature('Highway 401 SB NW', ['Arterial-Class A'])]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].name, 'Highway 401 NW');
  assert.equal(groups.find(g => g.name === '100 Ave NW').lines.length, 2);
  assert.equal(roadLabelName('HIGHWAY 404 SE'), 'Highway 404 SE');
});

test('river label anchors stay inside the visible polygon instead of a concave bounding box centre', () => {
  const geometry = { type: 'Polygon', coordinates: [[[30, 30], [300, 30], [300, 65], [70, 65], [70, 230], [300, 230], [300, 265], [30, 265], [30, 30]]] };
  const anchors = visibleWaterAnchors(geometry, project, size, 80);
  assert.ok(anchors.length);
  assert.ok(anchors.every(p => p.y <= 65 || p.y >= 230 || p.x <= 70));
  assert.ok(anchors.every(p => p.x >= 50 && p.x <= 350));
});

test('water holes and fully offscreen water do not receive label anchors', () => {
  const geometry = { type: 'Polygon', coordinates: [[[30, 30], [350, 30], [350, 260], [30, 260], [30, 30]], [[100, 80], [280, 80], [280, 220], [100, 220], [100, 80]]] };
  const anchors = visibleWaterAnchors(geometry, project, size, 80);
  assert.ok(anchors.length);
  assert.ok(anchors.every(p => !(p.x > 100 && p.x < 280 && p.y > 80 && p.y < 220)));
  assert.deepEqual(visibleWaterAnchors(geometry, ([x, y]) => ({ x: x + 500, y }), size), []);
});
