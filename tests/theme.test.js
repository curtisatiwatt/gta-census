import test from 'node:test';
import assert from 'node:assert/strict';

const storageKey = 'census-atlas-theme';
let moduleId = 0;

async function withBrowser(options, check) {
  const previous = Object.fromEntries(['window', 'document', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const saved = new Map(options.preference === undefined ? [] : [[storageKey, options.preference]]);
  const writes = [];
  const events = [];
  const windowListeners = new Map();
  const mediaListeners = new Set();
  const buttonListeners = new Map();
  const selectListeners = new Map();
  const select = { value: '', addEventListener: (type, listener) => selectListeners.set(type, listener) };
  const attributes = new Map();
  const meta = new Map();
  const button = {
    innerHTML: '',
    setAttribute: (key, value) => attributes.set(key, value),
    addEventListener: (type, listener) => buttonListeners.set(type, listener),
  };
  const media = {
    matches: Boolean(options.systemDark),
    addEventListener(type, listener) { if (type === 'change') mediaListeners.add(listener); },
  };
  const document = {
    documentElement: { dataset: {}, style: {} },
    getElementById: id => id === 'theme-toggle' ? button : id === 'theme-preference' ? select : null,
    querySelector: selector => selector === 'meta[name="theme-color"]' ? { setAttribute: (key, value) => meta.set(key, value) } : null,
  };
  const window = {
    matchMedia(query) { assert.equal(query, '(prefers-color-scheme: dark)'); return media; },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    dispatchEvent(event) {
      if (event.type === 'atlas-themechange') events.push(event.detail.theme);
      windowListeners.get(event.type)?.forEach(listener => listener(event));
      return true;
    },
  };
  const localStorage = {
    getItem(key) { if (options.blockedStorage) throw new Error('Storage is disabled'); return saved.get(key) ?? null; },
    removeItem(key) {
      if (options.blockedStorage) throw new Error('Storage is disabled');
      saved.delete(key);
    },
    setItem(key, value) {
      if (options.blockedStorage) throw new Error('Storage is disabled');
      saved.set(key, value);
      writes.push([key, value]);
    },
  };
  for (const [key, value] of Object.entries({ window, document, localStorage })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    const theme = await import(`../src/theme.js?theme-test=${++moduleId}`);
    await check({
      theme, document, saved, writes, events, attributes, meta, select,
      choose: value => selectListeners.get('change')({ target: { value } }),
      click: () => buttonListeners.get('click')(),
      changeSystem(dark) { media.matches = dark; mediaListeners.forEach(listener => listener({ matches: dark })); },
      receivePreference(value) {
        if (value === null) saved.delete(storageKey); else saved.set(storageKey, value);
        window.dispatchEvent({ type: 'storage', key: storageKey, newValue: value });
      },
    });
  } finally {
    for (const key of Object.keys(previous)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
  }
}

test('first visit follows system changes without saving an unsolicited override', async () => {
  await withBrowser({ systemDark: true }, ({ theme, changeSystem, writes, events, document }) => {
    theme.initTheme();
    assert.equal(theme.getTheme(), 'dark');
    assert.equal(document.documentElement.style.colorScheme, 'dark');
    changeSystem(false);
    assert.equal(theme.getTheme(), 'light');
    changeSystem(true);
    assert.equal(theme.getTheme(), 'dark');
    assert.deepEqual(writes, []);
    assert.deepEqual(events, ['dark', 'light', 'dark']);
  });
});

test('a manual toggle persists and stays in control when the system theme changes', async () => {
  let remembered;
  await withBrowser({ systemDark: false }, ({ theme, click, changeSystem, saved, attributes }) => {
    theme.initTheme();
    click();
    assert.equal(theme.getTheme(), 'dark');
    assert.equal(attributes.get('aria-pressed'), 'true');
    assert.ok(attributes.get('aria-label'));
    remembered = saved.get(storageKey);
    assert.equal(remembered, 'dark');
    changeSystem(true);
    changeSystem(false);
    assert.equal(theme.getTheme(), 'dark');
  });
  await withBrowser({ preference: remembered, systemDark: false }, ({ theme }) => {
    theme.initTheme();
    assert.equal(theme.getTheme(), 'dark');
  });
});

test('saved light mode overrides a dark system and invalid saved values fall back safely', async () => {
  await withBrowser({ preference: 'light', systemDark: true }, ({ theme, changeSystem }) => {
    theme.initTheme();
    assert.equal(theme.getTheme(), 'light');
    changeSystem(false);
    changeSystem(true);
    assert.equal(theme.getTheme(), 'light');
  });
  await withBrowser({ preference: 'obsolete-value', systemDark: true }, ({ theme, writes }) => {
    theme.initTheme();
    assert.equal(theme.getTheme(), 'dark');
    assert.deepEqual(writes, []);
  });
});

test('blocked storage still allows system defaults and an in-session manual choice', async () => {
  await withBrowser({ blockedStorage: true, systemDark: true }, ({ theme, click, changeSystem, meta }) => {
    assert.doesNotThrow(() => theme.initTheme());
    assert.equal(theme.getTheme(), 'dark');
    assert.doesNotThrow(click);
    assert.equal(theme.getTheme(), 'light');
    assert.equal(meta.get('content'), '#fbfcf9');
    changeSystem(false);
    changeSystem(true);
    assert.equal(theme.getTheme(), 'light');
  });
});

test('other-tab changes synchronize and removing the preference resumes system following', async () => {
  await withBrowser({ preference: 'dark', systemDark: false }, ({ theme, receivePreference, changeSystem }) => {
    theme.initTheme();
    receivePreference('light');
    assert.equal(theme.getTheme(), 'light');
    receivePreference('dark');
    assert.equal(theme.getTheme(), 'dark');
    receivePreference(null);
    assert.equal(theme.getTheme(), 'light');
    changeSystem(true);
    assert.equal(theme.getTheme(), 'dark');
  });
});


test('settings can return a manual theme to the device setting without duplicate repaint events', async () => {
  await withBrowser({ preference: 'light', systemDark: false }, ({ theme, choose, changeSystem, saved, select, events }) => {
    theme.initTheme();
    assert.equal(select.value, 'light');
    const previousEvents = events.length;
    choose('system');
    assert.equal(theme.getThemePreference(), 'system');
    assert.equal(select.value, 'system');
    assert.equal(saved.has(storageKey), false);
    assert.equal(events.length, previousEvents);
    changeSystem(true);
    assert.equal(theme.getTheme(), 'dark');
    choose('light');
    assert.equal(select.value, 'light');
    assert.equal(saved.get(storageKey), 'light');
    changeSystem(false);
    changeSystem(true);
    assert.equal(theme.getTheme(), 'light');
  });
});

test('returning to automatic theme still works when preference storage is blocked', async () => {
  await withBrowser({ blockedStorage: true, systemDark: true }, ({ theme, choose, changeSystem, select }) => {
    theme.initTheme();
    choose('light');
    assert.equal(theme.getTheme(), 'light');
    assert.doesNotThrow(() => choose('system'));
    assert.equal(select.value, 'system');
    assert.equal(theme.getTheme(), 'dark');
    changeSystem(false);
    assert.equal(theme.getTheme(), 'light');
  });
});
