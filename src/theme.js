import { t } from './i18n.js';

export const THEME_STORAGE_KEY = 'census-atlas-theme';
const themes = new Set(['light', 'dark']);
const sun = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.6"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const moon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2Z"/></svg>';
let explicitTheme = null;
let mediaQuery = null;
let initialized = false;

/** Invalid or unavailable preferences safely fall back to the operating system. */
export function resolveTheme(preference, systemDark = false) {
  return themes.has(preference) ? preference : systemDark ? 'dark' : 'light';
}

export function getTheme() {
  return typeof document === 'undefined' ? 'light'
    : resolveTheme(document.documentElement.dataset.theme, mediaQuery?.matches);
}

export const isDarkTheme = () => getTheme() === 'dark';
export const getThemePreference = () => explicitTheme || 'system';

export function refreshThemeControl() {
  if (typeof document === 'undefined') return;
  const select = document.getElementById('theme-preference');
  if (select) select.value = getThemePreference();
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  const dark = isDarkTheme();
  const action = t(dark ? 'theme.toLight' : 'theme.toDark');
  button.innerHTML = dark ? sun : moon;
  button.setAttribute('aria-label', action);
  button.setAttribute('title', action);
  button.setAttribute('aria-pressed', String(dark));
}

function applyTheme(theme) {
  const previous = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#11232a' : '#fbfcf9');
  refreshThemeControl();
  if (previous !== theme) window.dispatchEvent(new CustomEvent('atlas-themechange', { detail: { theme } }));
}

export function setTheme(theme) {
  if (theme !== 'system' && !themes.has(theme)) return;
  explicitTheme = theme === 'system' ? null : theme;
  try {
    if (explicitTheme) localStorage.setItem(THEME_STORAGE_KEY, explicitTheme);
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch { /* Private mode may disable storage. */ }
  applyTheme(resolveTheme(explicitTheme, mediaQuery?.matches));
}

export function initTheme() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    explicitTheme = themes.has(stored) ? stored : null;
  } catch { explicitTheme = null; }
  applyTheme(resolveTheme(explicitTheme, mediaQuery.matches));
  document.getElementById('theme-toggle')?.addEventListener('click', () => setTheme(isDarkTheme() ? 'light' : 'dark'));
  document.getElementById('theme-preference')?.addEventListener('change', event => setTheme(event.target.value));
  const followSystem = () => { if (!explicitTheme) applyTheme(resolveTheme(null, mediaQuery.matches)); };
  if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', followSystem);
  else mediaQuery.addListener?.(followSystem);
  window.addEventListener('storage', event => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    explicitTheme = themes.has(event.newValue) ? event.newValue : null;
    applyTheme(resolveTheme(explicitTheme, mediaQuery.matches));
  });
}
