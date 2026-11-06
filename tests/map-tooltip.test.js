import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapTooltip } from '../src/map-tooltip.js';

class Events {
  handlers = new Map();
  on(type, fn) {
    if (typeof type === 'object') { for (const [event, handler] of Object.entries(type)) this.on(event, handler); return this; }
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return this;
  }
  off(type, fn) {
    if (typeof type === 'object') { for (const [event, handler] of Object.entries(type)) this.off(event, handler); return this; }
    this.handlers.get(type)?.delete(fn);
    return this;
  }
  fire(type, event = {}) { for (const fn of [...(this.handlers.get(type) || [])]) fn(event); return this; }
  addEventListener(type, fn) { this.on(type, fn); }
  removeEventListener(type, fn) { this.off(type, fn); }
}

class Element extends Events {
  attributes = new Map();
  focusVisible = false;
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  matches(selector) { return selector === ':focus-visible' && this.focusVisible; }
}

function setup() {
  const window = new Events();
  const document = Object.assign(new Events(), { defaultView: window, hidden: false });
  const container = Object.assign(new Element(), { ownerDocument: document });
  const visible = new Set();
  const layers = new Set();
  const map = Object.assign(new Events(), { getContainer: () => container, hasLayer: layer => layers.has(layer) });
  let openings = 0;
  const tooltip = Object.assign(new Events(), {
    options: {}, content: null, latlng: null,
    setContent(value) { this.content = value; return this; },
    setLatLng(value) { this.latlng = value; return this; },
    openOn() { if (!visible.has(this)) openings += 1; visible.add(this); return this; },
    close() { if (visible.delete(this)) this.fire('remove'); return this; },
    getElement: () => ({ id: 'shared-tooltip' }),
  });
  let enabled = true;
  let hoverEnabled = true;
  const controller = createMapTooltip({ map, tooltip, enabled: () => enabled, hoverEnabled: () => hoverEnabled });
  const add = name => {
    const element = new Element();
    const layer = Object.assign(new Events(), { getElement: () => element });
    layers.add(layer);
    controller.bind(layer, { content: name, anchor: event => event?.latlng || [0, 0] });
    return { layer, element };
  };
  return { controller, map, tooltip, visible, container, document, window, add,
    openings: () => openings, setEnabled: value => { enabled = value; }, setHoverEnabled: value => { hoverEnabled = value; } };
}

test('dragging across many communities cannot reopen departed tooltips at moveend', () => {
  const s = setup();
  const communities = ['Starling', 'Gagnon Estate Industrial', 'Ambleside'].map(s.add);
  communities[0].layer.fire('mouseover');
  assert.equal(s.visible.size, 1);
  s.map.fire('movestart');
  for (const { layer } of communities) {
    layer.fire('mouseover', { latlng: [1, 2] });
    layer.fire('mousemove', { latlng: [2, 3] });
    layer.fire('mouseout');
  }
  s.map.fire('moveend');
  assert.equal(s.visible.size, 0);
  assert.equal(s.openings(), 1, 'no deferred hover is replayed after the drag');
  communities[2].layer.fire('mousemove', { latlng: [3, 4] });
  assert.equal(s.visible.size, 1);
  assert.equal(s.tooltip.content, 'Ambleside');
  assert.deepEqual(s.tooltip.latlng, [3, 4]);
});

test('rapid community changes reuse one overlay; an old mouseout cannot close the current card', () => {
  const s = setup();
  const a = s.add('A');
  const b = s.add('B');
  a.element.setAttribute('aria-describedby', 'existing-help');
  a.layer.fire('mouseover');
  assert.equal(a.element.getAttribute('aria-describedby'), 'existing-help shared-tooltip');
  b.layer.fire('mouseover');
  a.layer.fire('mouseout');
  assert.equal(s.visible.size, 1);
  assert.equal(s.openings(), 1);
  assert.equal(s.tooltip.content, 'B');
  assert.equal(a.element.getAttribute('aria-describedby'), 'existing-help');
  assert.equal(b.element.getAttribute('aria-describedby'), 'shared-tooltip');
  b.layer.fire('mouseout');
  assert.equal(s.visible.size, 0);
  assert.equal(b.element.getAttribute('aria-describedby'), null);
});

test('zoom and movement remain blocked until both finish, including programmatic card selection', () => {
  const s = setup();
  const { layer } = s.add('A');
  layer.fire('mouseover');
  s.controller.close(); // Selection closes the existing preview before fitBounds.
  s.map.fire('movestart').fire('zoomstart').fire('zoomend');
  layer.fire('mouseover');
  assert.equal(s.visible.size, 0);
  s.map.fire('moveend');
  assert.equal(s.visible.size, 0);
  layer.fire('mousemove');
  assert.equal(s.visible.size, 1);
});

test('touch/mobile input does not create hover cards; keyboard focus retains an accessible description', () => {
  const s = setup();
  const { layer, element } = s.add('Keyboard community');
  s.setEnabled(false);
  layer.fire('mouseover');
  assert.equal(s.visible.size, 0);
  s.setEnabled(true);
  for (const originalEvent of [{ pointerType: 'touch' }, { sourceCapabilities: { firesTouchEvents: true } }, { buttons: 1 }]) {
    layer.fire('mouseover', { originalEvent });
    assert.equal(s.visible.size, 0);
  }
  s.setHoverEnabled(false);
  layer.fire('mouseover');
  element.fire('focus');
  assert.equal(s.visible.size, 0, 'pointer focus is not keyboard focus');
  element.focusVisible = true;
  element.fire('focus');
  assert.equal(s.visible.size, 1);
  assert.equal(element.getAttribute('aria-describedby'), 'shared-tooltip');
  element.fire('blur');
  assert.equal(s.visible.size, 0);
  assert.equal(element.getAttribute('aria-describedby'), null);
});

test('leaving, Escape, backgrounding, removal and destruction clean up the overlay and ARIA', () => {
  const s = setup();
  const { layer, element } = s.add('A');
  const closeActions = [
    () => s.container.fire('mouseleave'),
    () => s.document.fire('keydown', { key: 'Escape' }),
    () => s.window.fire('blur'),
    () => s.window.fire('resize'),
    () => { s.document.hidden = true; s.document.fire('visibilitychange'); s.document.hidden = false; },
    () => s.map.fire('preclick'),
    () => s.tooltip.close(),
  ];
  for (const close of closeActions) {
    layer.fire('mouseover');
    assert.equal(s.visible.size, 1);
    close();
    assert.equal(s.visible.size, 0);
    assert.equal(element.getAttribute('aria-describedby'), null);
  }
  layer.fire('mouseover').fire('remove');
  layer.fire('mousemove');
  assert.equal(s.visible.size, 0, 'removed/redrawn layers have no lingering listeners');
  const b = s.add('B');
  b.layer.fire('mouseover');
  s.map.fire('unload');
  b.layer.fire('mousemove');
  assert.equal(s.visible.size, 0);
  assert.equal(b.element.getAttribute('aria-describedby'), null);
});
