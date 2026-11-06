import test from 'node:test';
import assert from 'node:assert/strict';
import { clampSheetHeight, releaseSheetSnap, sheetHeights, stepSheetSnap } from '../src/community-sheet-utils.js';

const heights = sheetHeights(852, 150);
const release = (snap, height, velocity = 0) => releaseSheetSnap({ snap, startHeight: heights[snap], height, velocity, heights });

test('sheet has a natural summary, half-screen stop and near-full stop', () => {
  assert.deepEqual(heights, { peek: 150, half: 426, full: 784 });
  assert.deepEqual(sheetHeights(667, 178), { peek: 178, half: 334, full: 614 });
});

test('large type and short landscape screens never put a stop outside the viewport', () => {
  for (const viewport of [240, 375, 667, 852]) {
    for (const header of [100, 180, 330, 500]) {
      const stops = sheetHeights(viewport, header, 24);
      assert.ok(stops.peek <= stops.half && stops.half <= stops.full);
      assert.ok(stops.full <= viewport - 32);
      assert.equal(clampSheetHeight(-100, stops), stops.peek);
      assert.equal(clampSheetHeight(viewport + 500, stops), stops.full);
    }
  }
  assert.ok(sheetHeights(667, 350).half >= 414, 'enlarged header leaves room for content');
});

test('deliberate short swipes move one stop; small taps do not resize', () => {
  assert.equal(release('half', heights.half + 40), 'full');
  assert.equal(release('half', heights.half - 40), 'peek');
  assert.equal(release('full', heights.full - 40), 'half');
  assert.equal(release('peek', heights.peek + 40), 'half');
  assert.equal(release('half', heights.half + 5, 1.5), 'half');
});

test('long drags can cross both stops, while velocity makes a flick responsive', () => {
  assert.equal(release('peek', 760), 'full');
  assert.equal(release('full', 160), 'peek');
  assert.equal(release('half', heights.half + 14, .8), 'full');
  assert.equal(release('half', heights.half - 14, -.8), 'peek');
  assert.equal(release('peek', heights.peek - 60, -2), 'peek', 'a swipe never dismisses a selected community');
});

test('keyboard stepping clamps to visible stops', () => {
  assert.equal(stepSheetSnap('peek', -1), 'peek');
  assert.equal(stepSheetSnap('peek', 1), 'half');
  assert.equal(stepSheetSnap('half', 1), 'full');
  assert.equal(stepSheetSnap('full', 1), 'full');
  assert.equal(stepSheetSnap('full', -1), 'half');
});

// Exercise the real controller with a small DOM/event fixture. These checks cover
// close/reopen and delayed drag events; visual hit testing remains browser QA.
import { initCommunitySheet } from '../src/community-sheet.js';

function sheetFixture(t, isMobile = true) {
  class Events {
    listeners = new Map();
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    fire(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn({ type, target: this, currentTarget: this, ...event }); }
  }
  const elements = [];
  let doc;
  class Element extends Events {
    children = []; parent = null; attributes = new Map(); dataset = {}; textContent = ''; scrollTop = 0; inert = false; captures = new Set();
    constructor(tagName = 'div', id = '') {
      super(); this.tagName = tagName.toUpperCase(); this.id = id; elements.push(this);
      const classes = new Set();
      this.classList = { contains: name => classes.has(name), add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), toggle(name, force) { const next = force ?? !classes.has(name); if (next) classes.add(name); else classes.delete(name); return next; } };
      const styles = new Map();
      this.style = { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name), getPropertyValue: name => styles.get(name) || '' };
    }
    append(...nodes) { for (const node of nodes) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; this.children.push(node); } }
    insertBefore(node, before) { node.parent = this; this.children.splice(this.children.indexOf(before), 0, node); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    closest() { return ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'].includes(this.tagName) ? this : this.parent?.closest() || null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    getBoundingClientRect() { return { height: this === sidebar ? parseFloat(this.style.getPropertyValue('--community-sheet-height')) || 0 : 140 }; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); this.fire('lostpointercapture', { pointerId: id }); }
    focus() { doc.activeElement = this; }
  }
  const sidebar = new Element(); const panel = new Element('section', 'detail-panel'); sidebar.append(panel);
  for (const [id, tag] of [['mobile-detail-handle', 'button'], ['community-name', 'h1'], ['collapsed-summary', 'div'], ['community-meta', 'div'], ['detail-body', 'div']]) panel.append(new Element(tag, id));
  const body = new Element('body'); body.append(sidebar);
  const map = new Element();
  doc = { body, activeElement: null, createElement: tag => new Element(tag), getElementById: id => elements.find(el => el.id === id), querySelector: selector => selector === '.sidebar' ? sidebar : map };
  const media = Object.assign(new Events(), { matches: isMobile });
  const win = Object.assign(new Events(), { innerHeight: 852, visualViewport: Object.assign(new Events(), { height: 852 }), matchMedia: () => media });
  let frameId = 0; const frames = new Map();
  const globals = { document: doc, window: win, getComputedStyle: () => ({ paddingTop: '0', paddingBottom: '12' }), requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id), ResizeObserver: class { observe() {} } };
  const prior = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  t.after(() => { for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const changes = []; let closes = 0;
  const controller = initCommunitySheet({ onChange: snap => changes.push(snap), onClose: () => { closes++; } });
  const flush = () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } };
  return { controller, sidebar, panel, doc, win, media, flush, changes, closes: () => closes,
    header: panel.children.find(el => el.className === 'community-sheet-header'), content: doc.getElementById('detail-body'), close: doc.getElementById('mobile-sheet-close') };
}

test('close fully removes the mobile sheet inset and survives layout refreshes until a new selection', t => {
  const s = sheetFixture(t);
  assert.equal(s.controller.getState(), 'closed', 'a new visitor starts with the map clear');
  s.controller.open('half');
  assert.equal(s.controller.getTargetInset(), 426);
  let prevented = false; let stopped = false;
  s.close.focus();
  s.close.fire('click', { preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented && stopped, true, 'dismiss activation must not propagate to the map');
  assert.equal(s.controller.getState(), 'closed');
  assert.equal(s.sidebar.style.getPropertyValue('--community-sheet-height'), '0px');
  assert.equal(s.controller.getInset(), 0);
  assert.equal(s.controller.getTargetInset(), 0);
  assert.equal(s.sidebar.getAttribute('aria-hidden'), 'true');
  assert.equal(s.sidebar.inert, true);
  assert.equal(s.closes(), 1);
  s.win.fire('resize'); s.win.visualViewport.fire('resize'); s.win.fire('atlas-languagechange'); s.flush(); s.controller.refresh();
  assert.equal(s.controller.getState(), 'closed');
  assert.equal(s.controller.getInset(), 0);
  s.content.scrollTop = 100;
  s.controller.open();
  assert.equal(s.controller.getState(), 'half');
  assert.equal(s.content.scrollTop, 0);
  assert.equal(s.sidebar.inert, false);
  assert.equal(s.sidebar.getAttribute('aria-hidden'), null);
});

test('closing during a captured gesture releases it and ignores its late pointer-up', t => {
  const s = sheetFixture(t);
  s.controller.open('half');
  s.header.fire('pointerdown', { pointerId: 7, button: 0, isPrimary: true, clientY: 500, timeStamp: 1 });
  s.header.fire('pointermove', { pointerId: 7, clientY: 400, timeStamp: 40 });
  assert.equal(s.header.hasPointerCapture(7), true);
  s.controller.close();
  assert.equal(s.header.hasPointerCapture(7), false);
  s.header.fire('pointerup', { pointerId: 7, clientY: 300, timeStamp: 70 });
  assert.equal(s.controller.getState(), 'closed');
  assert.equal(s.controller.getTargetInset(), 0);
});

test('desktop visibility belongs to the desktop shell after one mobile cleanup', t => {
  const s = sheetFixture(t);
  s.controller.open('full'); s.controller.close();
  s.media.matches = false; s.media.fire('change');
  assert.equal(s.sidebar.getAttribute('aria-hidden'), null);
  assert.equal(s.sidebar.inert, false);
  assert.equal(s.sidebar.classList.contains('collapsed'), false);
  s.sidebar.setAttribute('aria-hidden', 'true'); s.sidebar.inert = true; s.sidebar.classList.add('collapsed');
  s.controller.refresh(); s.win.fire('resize'); s.flush();
  assert.equal(s.sidebar.getAttribute('aria-hidden'), 'true');
  assert.equal(s.sidebar.inert, true);
  assert.equal(s.sidebar.classList.contains('collapsed'), true);
  assert.equal(s.controller.getInset(), 0);
});
