import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunityHighlight } from '../src/community-highlight.js';

class Events {
  handlers = new Map();
  on(type, fn) {
    if (typeof type === 'object') { for (const [name, handler] of Object.entries(type)) this.on(name, handler); return this; }
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn); return this;
  }
  off(type, fn) {
    if (typeof type === 'object') { for (const [name, handler] of Object.entries(type)) this.off(name, handler); return this; }
    this.handlers.get(type)?.delete(fn); return this;
  }
  fire(type, event = {}) { for (const handler of [...(this.handlers.get(type) || [])]) handler(event); return this; }
  addEventListener(type, fn) { this.on(type, fn); }
  removeEventListener(type, fn) { this.off(type, fn); }
}

const feature = code => ({ type: 'Feature', properties: { code }, geometry: {
  type: 'MultiPolygon', coordinates: [
    [[[0, 0], [0, 8], [8, 8], [8, 0], [0, 0]], [[2, 2], [2, 4], [4, 4], [4, 2], [2, 2]]],
    [[[10, 0], [10, 3], [13, 3], [13, 0], [10, 0]]],
  ],
} });

function setup() {
  const window = new Events();
  const document = Object.assign(new Events(), { defaultView: window, hidden: false });
  const container = Object.assign(new Events(), { ownerDocument: document });
  const panes = new Map();
  const layers = new Set();
  const paths = [];
  let dark = false;
  let hoverEnabled = true;
  let front = 0;
  const map = Object.assign(new Events(), {
    getContainer: () => container,
    getPane: name => panes.get(name),
    createPane(name) { const pane = { style: {} }; panes.set(name, pane); return pane; },
    hasLayer: layer => layers.has(layer),
    removeLayer: layer => layers.delete(layer),
  });
  const L = { geoJSON(data, options) {
    const layer = {
      data, options, front: 0,
      addTo() { layers.add(this); paths.push(this); return this; },
      bringToFront() { this.front = ++front; return this; },
    };
    return layer;
  } };
  const features = [feature('A'), feature('B'), feature('C')];
  const controller = createCommunityHighlight({ L, map, features, isDark: () => dark, hoverEnabled: () => hoverEnabled });
  const add = code => {
    const element = Object.assign(new Events(), { focusVisible: false, matches: () => element.focusVisible });
    const layer = Object.assign(new Events(), { getElement: () => element });
    layers.add(layer); controller.bind(layer, code);
    return { layer, element };
  };
  const visible = type => paths.filter(path => layers.has(path) && (!type || path.options.className.includes(type)));
  return { map, controller, container, window, document, panes, features, add, visible,
    dark: value => { dark = value; }, hover: value => { hoverEnabled = value; } };
}

test('selection uses the complete multipart boundary above roads and transit, without covering hit targets', () => {
  const s = setup();
  const before = JSON.stringify(s.features[0]);
  s.controller.setSelected('A');
  const paths = s.visible('selected');
  assert.equal(paths.length, 2, 'outline has a contrasting halo');
  for (const path of paths) {
    assert.equal(path.data, s.features[0], 'preserve all polygon components and holes');
    assert.equal(path.options.fill, false);
    assert.equal(path.options.interactive, false);
    assert.equal(path.options.bubblingMouseEvents, false);
    assert.equal(path.options.noClip, true, 'no viewport-cut polygon edges');
    assert.equal(path.options.smoothFactor, 0, 'retain narrow boundary turns');
    assert.equal(path.options.dashArray, null, 'missing population data must not break the selection outline');
    const pane = s.panes.get(path.options.pane);
    assert.ok(Number(pane.style.zIndex) > 440, 'above roads and transit');
    assert.ok(Number(pane.style.zIndex) < 450, 'below population markers and community labels');
    assert.equal(pane.style.pointerEvents, 'none');
  }
  assert.equal(JSON.stringify(s.features[0]), before);
});

test('hovering another community preserves selection; a late mouseout cannot erase the new hover', () => {
  const s = setup();
  const a = s.add('A'), b = s.add('B'), c = s.add('C');
  s.controller.setSelected('A');
  a.layer.fire('mouseover');
  assert.equal(s.visible().length, 2, 'selected community does not need a second hover outline');
  b.layer.fire('mouseover');
  c.layer.fire('mouseover');
  b.layer.fire('mouseout');
  assert.deepEqual(s.visible('hover').map(path => path.data.properties.code), ['C', 'C']);
  assert.equal(s.visible('selected').length, 2);
  assert.ok(Math.min(...s.visible('selected').map(path => path.front)) > Math.max(...s.visible('hover').map(path => path.front)));
  c.layer.fire('mouseout');
  assert.equal(s.visible('hover').length, 0);
  assert.equal(s.visible('selected').length, 2);
});

test('dragging, zooming and resizing clear hover but keep the selected boundary', () => {
  const s = setup();
  const b = s.add('B');
  s.controller.setSelected('A');
  b.layer.fire('mouseover');
  s.map.fire('movestart');
  b.layer.fire('mousemove');
  assert.equal(s.visible('hover').length, 0);
  s.map.fire('moveend');
  assert.equal(s.visible('hover').length, 0, 'dragging does not replay departed hover');
  b.layer.fire('mousemove');
  assert.equal(s.visible('hover').length, 2);
  s.map.fire('zoomstart');
  b.layer.fire('mousemove');
  assert.equal(s.visible('hover').length, 0);
  s.map.fire('zoomend');
  b.layer.fire('mousemove');
  s.window.fire('resize');
  assert.equal(s.visible('hover').length, 0);
  assert.equal(s.visible('selected').length, 2);
});

test('touch and pressed-pointer movement never create hover, while keyboard focus can reveal a boundary', () => {
  const s = setup();
  const a = s.add('A');
  for (const originalEvent of [{ pointerType: 'touch' }, { sourceCapabilities: { firesTouchEvents: true } }, { buttons: 1 }]) a.layer.fire('mouseover', { originalEvent });
  assert.equal(s.visible().length, 0);
  s.hover(false);
  a.layer.fire('mousemove');
  assert.equal(s.visible().length, 0);
  a.element.focusVisible = true;
  a.element.fire('focus');
  assert.equal(s.visible('hover').length, 2);
  a.element.fire('blur');
  assert.equal(s.visible().length, 0);
});

test('theme refresh, unbinding and disposal do not leave old paths or handlers behind', () => {
  const s = setup();
  const b = s.add('B');
  s.controller.setSelected('A');
  b.layer.fire('mouseover');
  const old = s.visible();
  const light = s.visible('selected-outline')[0].options.color;
  s.dark(true); s.controller.refresh();
  assert.equal(s.visible().length, 4);
  assert.ok(old.every(path => !s.map.hasLayer(path)));
  assert.notEqual(s.visible('selected-outline')[0].options.color, light);
  b.layer.fire('remove');
  assert.equal(s.visible('hover').length, 0);
  s.controller.destroy();
  s.controller.destroy();
  b.layer.fire('mouseover'); s.map.fire('moveend');
  assert.equal(s.visible().length, 0);
  assert.equal(s.window.handlers.get('resize').size, 0);
});
