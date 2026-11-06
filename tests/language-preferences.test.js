import test from 'node:test';
import assert from 'node:assert/strict';

const storageKey = 'census-atlas-language';
let moduleId = 0;

async function withBrowser(options, check) {
  const keys = ['window', 'document', 'navigator', 'localStorage'];
  const previous = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const saved = new Map(options.preference === undefined ? [] : [[storageKey, options.preference]]);
  const writes = [];
  const events = [];
  const listeners = new Map();
  const selectListeners = new Map();
  const navigator = { language: options.systemLanguage ?? 'en-CA' };
  const select = { value: '', addEventListener(type, listener) { selectListeners.set(type, listener); } };
  const document = {
    documentElement: { lang: '' },
    getElementById: id => id === 'language-preference' ? select : null,
  };
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    dispatchEvent(event) {
      if (event.type === 'atlas-languagechange') events.push(event.detail.language);
      listeners.get(event.type)?.forEach(listener => listener(event));
      return true;
    },
  };
  const localStorage = {
    getItem(key) { if (options.blockedStorage) throw new Error('Storage disabled'); return saved.get(key) ?? null; },
    setItem(key, value) {
      if (options.blockedStorage) throw new Error('Storage disabled');
      saved.set(key, value); writes.push(['set', key, value]);
    },
    removeItem(key) {
      if (options.blockedStorage) throw new Error('Storage disabled');
      saved.delete(key); writes.push(['remove', key]);
    },
  };
  for (const [key, value] of Object.entries({ window, document, navigator, localStorage })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    const language = await import(`../src/i18n.js?language-preference-test=${++moduleId}`);
    await check({
      language, saved, writes, events, select, document,
      choose(value) { select.value = value; selectListeners.get('change')({ target: select }); },
      changeSystem(value) { navigator.language = value; window.dispatchEvent({ type: 'languagechange' }); },
      receivePreference(value) {
        if (value === null) saved.delete(storageKey); else saved.set(storageKey, value);
        window.dispatchEvent({ type: 'storage', key: storageKey, newValue: value });
      },
      clearStorage() { saved.clear(); window.dispatchEvent({ type: 'storage', key: null, newValue: null }); },
    });
  } finally {
    for (const key of keys) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
  }
}

test('new visitors follow the browser language without creating a manual preference', async () => {
  await withBrowser({ systemLanguage: 'zh-TW' }, ({ language, select, changeSystem, writes, events, document }) => {
    assert.equal(language.LANGUAGE_STORAGE_KEY, storageKey);
    assert.equal(language.currentLanguage(), 'zh');
    language.initLanguagePreference();
    assert.equal(select.value, 'system');
    assert.equal(language.getLanguagePreference(), 'system');
    changeSystem('en-CA');
    assert.equal(language.currentLanguage(), 'en');
    assert.equal(document.documentElement.lang, 'en');
    changeSystem('fr-CA');
    assert.equal(language.currentLanguage(), 'en');
    changeSystem('zh-CN');
    assert.equal(language.currentLanguage(), 'zh');
    assert.equal(document.documentElement.lang, 'zh-CN');
    assert.deepEqual(events, ['en', 'zh']);
    assert.deepEqual(writes, []);
  });
});

test('manual language selection persists and System immediately restores browser following', async () => {
  let remembered;
  await withBrowser({ systemLanguage: 'en-CA' }, ({ language, choose, changeSystem, saved, select, events }) => {
    language.initLanguagePreference();
    language.initLanguagePreference();
    choose('zh');
    assert.equal(language.currentLanguage(), 'zh');
    assert.equal(language.getLanguagePreference(), 'zh');
    remembered = saved.get(storageKey);
    assert.equal(remembered, 'zh');
    changeSystem('zh-CN');
    changeSystem('en-US');
    assert.equal(language.currentLanguage(), 'zh');
    choose('system');
    assert.equal(language.currentLanguage(), 'en');
    assert.equal(language.getLanguagePreference(), 'system');
    assert.equal(select.value, 'system');
    assert.equal(saved.has(storageKey), false);
    changeSystem('zh-HK');
    assert.equal(language.currentLanguage(), 'zh');
    assert.deepEqual(events, ['zh', 'en', 'zh']);
  });
  await withBrowser({ preference: remembered, systemLanguage: 'en-CA' }, ({ language, select }) => {
    language.initLanguagePreference();
    assert.equal(language.currentLanguage(), 'zh');
    assert.equal(select.value, 'zh');
    assert.equal(language.getLanguagePreference(), 'zh');
  });
});

test('changing the preference without changing the visible language emits no redraw event', async () => {
  await withBrowser({ systemLanguage: 'en-CA' }, ({ language, events, select }) => {
    language.initLanguagePreference();
    language.setLanguage('en');
    assert.equal(language.getLanguagePreference(), 'en');
    assert.equal(select.value, 'en');
    language.setLanguagePreference('system');
    assert.equal(select.value, 'system');
    assert.deepEqual(events, []);
  });
});

test('language preferences synchronize from other tabs and storage clearing resumes automatic mode', async () => {
  await withBrowser({ preference: 'zh', systemLanguage: 'en-CA' }, ({ language, receivePreference, clearStorage, changeSystem, select, writes }) => {
    language.initLanguagePreference();
    receivePreference('en');
    assert.equal(language.currentLanguage(), 'en');
    assert.equal(select.value, 'en');
    receivePreference('zh');
    assert.equal(language.currentLanguage(), 'zh');
    receivePreference(null);
    assert.equal(language.currentLanguage(), 'en');
    assert.equal(select.value, 'system');
    changeSystem('zh-CN');
    assert.equal(language.currentLanguage(), 'zh');
    receivePreference('en');
    clearStorage();
    assert.equal(language.currentLanguage(), 'zh');
    assert.equal(language.getLanguagePreference(), 'system');
    assert.deepEqual(writes, []);
  });
});

test('invalid saved preferences and unavailable storage retain useful automatic and manual modes', async () => {
  await withBrowser({ preference: 'old-value', systemLanguage: 'zh-CN' }, ({ language, writes }) => {
    language.initLanguagePreference();
    assert.equal(language.currentLanguage(), 'zh');
    assert.equal(language.getLanguagePreference(), 'system');
    assert.deepEqual(writes, []);
  });
  await withBrowser({ blockedStorage: true, systemLanguage: 'en-CA' }, ({ language, choose, changeSystem }) => {
    assert.doesNotThrow(() => language.initLanguagePreference());
    assert.equal(language.currentLanguage(), 'en');
    assert.doesNotThrow(() => choose('zh'));
    changeSystem('en-US');
    assert.equal(language.currentLanguage(), 'zh');
    assert.doesNotThrow(() => choose('system'));
    assert.equal(language.currentLanguage(), 'en');
    changeSystem('zh-TW');
    assert.equal(language.currentLanguage(), 'zh');
  });
});
