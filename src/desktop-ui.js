import { addTranslations, t } from './i18n.js';

addTranslations({
  '展开菜单': 'Expand menu', '收起菜单': 'Collapse menu',
  '显示社区详情': 'Show community details', '隐藏社区详情': 'Hide community details',
  '先在地图上选择一个社区': 'Select a community on the map first',
  '设置': 'Settings', '详情': 'Details', '说明': 'Guide', '收入': 'Income',
  '关闭社区详情': 'Close community details', '数据说明': 'About the data',
});

const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  composition: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12l6 6"/>',
  compare: '<path d="M4 20V9h4v11M10 20V4h4v16M16 20v-8h4v8"/>',
  groups: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2"/>',
  income: '<path d="M12 3v18M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7" transform="translate(0 -2)"/>',
  details: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M13 9h4M13 13h4"/>',
  guide: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 7h.01"/>',
  settings: '<path d="m10 3-1 3-3 1-2 3 2 2v3l2 3 3-1 3 1 3-2v-3l2-2-1-3-3-1-1-3z"/><circle cx="11.5" cy="11" r="3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const $ = id => document.getElementById(id);

/** Desktop controls float over one full-window map; mobile keeps its own sheet. */
export function initDesktopUI({ onLayoutChange = () => {} } = {}) {
  const desktop = matchMedia('(min-width: 761px)');
  const nav = document.querySelector('.viewbar');
  const sidebar = document.querySelector('.sidebar');
  const content = $('detail-body');
  const railItems = [$('method-button'), $('mobile-language-slot'), $('mobile-theme-slot')];
  const railOrigins = new Map(railItems.map(node => {
    const marker = document.createComment('desktop preference origin');
    node.before(marker); return [node, marker];
  }));
  let expanded = false;
  let detailsOpen = false;
  let hasSelection = false;
  let appliedDesktop = false;
  let frame = 0;

  function makeButton(id, iconName, label, action) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.className = 'desktop-nav-button desktop-only';
    button.innerHTML = `<span class="desktop-nav-icon">${icon(iconName)}</span><span class="desktop-nav-label" data-desktop-label="${label}"></span>`;
    button.addEventListener('click', action);
    return button;
  }

  const railHeader = document.createElement('div');
  railHeader.className = 'desktop-rail-header desktop-only';
  const menuButton = makeButton('desktop-menu-toggle', 'menu', '展开菜单', () => {
    expanded = !expanded;
    refresh();
  });
  menuButton.setAttribute('aria-controls', 'desktop-navigation');
  const city = document.createElement('span');
  city.className = 'desktop-city-name';
  city.textContent = document.querySelector('.brand strong')?.textContent.match(/GTA/)?.[0] || 'Community Atlas';
  railHeader.append(menuButton, city);
  nav.prepend(railHeader);
  nav.id ||= 'desktop-navigation';

  // Preserve the original controls and listeners; only add desktop presentation.
  for (const [id, name] of [['composition-tab', 'composition'], ['distribution-tab', 'compare'], ['groups-button', 'groups']]) {
    const button = $(id);
    const glyph = document.createElement('span');
    glyph.className = 'desktop-nav-icon desktop-only';
    glyph.innerHTML = icon(name);
    button.prepend(glyph);
    if (id.endsWith('-tab')) {
      const textNodes = [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const label = document.createElement('span');
      label.className = 'desktop-tab-label';
      for (const node of textNodes) label.append(node);
      button.append(label);
    }
  }
  const incomeIcon = document.createElement('span');
  incomeIcon.className = 'desktop-nav-icon desktop-only';
  incomeIcon.innerHTML = icon('income');
  $('income-control').prepend(incomeIcon);

  const footer = document.createElement('div');
  footer.className = 'desktop-rail-footer desktop-only';
  const detailsButton = makeButton('desktop-details-toggle', 'details', '详情', () => {
    if (hasSelection) detailsOpen ? closeDetails() : openDetails();
  });
  detailsButton.setAttribute('aria-controls', 'detail-panel');
  footer.append(detailsButton);
  nav.append(footer);

  const closeButton = makeButton('desktop-detail-close', 'close', '关闭社区详情', event => {
    event.preventDefault();
    event.stopPropagation();
    closeDetails();
  });
  closeButton.className = 'desktop-detail-close desktop-only';
  document.querySelector('.community-sheet-header').append(closeButton);

  function notifyLayout() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      onLayoutChange(getInsets());
    });
  }

  function refresh() {
    const active = desktop.matches;
    document.body.classList.toggle('desktop-map-ui', active);
    document.body.classList.toggle('desktop-menu-expanded', active && expanded);
    document.body.classList.toggle('desktop-details-open', active && detailsOpen);
    if (active) {
      appliedDesktop = true;
      for (const node of railItems) if (node.parentNode !== footer) footer.append(node);
      sidebar.inert = !detailsOpen;
      sidebar.setAttribute('aria-hidden', String(!detailsOpen));
      content.inert = false;
    } else if (appliedDesktop) {
      appliedDesktop = false;
      for (const [node, marker] of railOrigins) marker.after(node);
      // Match the mobile sheet state when crossing the breakpoint. Its module
      // remains the only owner of mobile height and drag behaviour.
      const snap = sidebar.dataset.sheetSnap;
      sidebar.inert = snap === 'closed';
      if (snap === 'closed') sidebar.setAttribute('aria-hidden', 'true');
      else sidebar.removeAttribute('aria-hidden');
      content.inert = snap === 'closed' || snap === 'peek';
    }
    menuButton.setAttribute('aria-expanded', String(expanded));
    menuButton.setAttribute('aria-label', t(expanded ? '收起菜单' : '展开菜单'));
    menuButton.title = t(expanded ? '收起菜单' : '展开菜单');
    detailsButton.disabled = !hasSelection;
    detailsButton.setAttribute('aria-expanded', String(detailsOpen));
    const detailsLabel = !hasSelection ? '先在地图上选择一个社区' : detailsOpen ? '隐藏社区详情' : '显示社区详情';
    detailsButton.setAttribute('aria-label', t(detailsLabel));
    detailsButton.title = t(detailsLabel);
    closeButton.setAttribute('aria-label', t('关闭社区详情'));
    closeButton.title = t('关闭社区详情');
    for (const node of railItems) {
      const label = node.id === 'method-button' ? '数据说明' : node.id === 'mobile-language-slot' ? '语言' : '外观';
      node.title = t(label);
    }
    for (const node of nav.querySelectorAll('[data-desktop-label]')) node.textContent = t(node.dataset.desktopLabel);
    closeButton.querySelector('[data-desktop-label]').textContent = t('关闭社区详情');
    notifyLayout();
  }

  function openDetails() {
    hasSelection = true;
    detailsOpen = true;
    refresh();
  }

  function setSelection() {
    hasSelection = true;
    refresh();
  }

  function closeDetails() {
    const hadFocus = sidebar.contains(document.activeElement);
    detailsOpen = false;
    refresh();
    if (desktop.matches && hadFocus) detailsButton.focus({ preventScroll: true });
  }

  function getInsets() {
    if (!desktop.matches) return { top: 0, right: 0, bottom: 0, left: 0 };
    const railRight = nav.getBoundingClientRect().right;
    const left = detailsOpen ? sidebar.getBoundingClientRect().right + 12 : railRight + 12;
    return { top: 76, right: 24, bottom: 24, left: Math.ceil(left) };
  }

  desktop.addEventListener('change', refresh);
  window.addEventListener('atlas-languagechange', refresh);
  window.addEventListener('resize', notifyLayout);
  refresh();
  return { openDetails, closeDetails, setSelection, clearSelection() { hasSelection = false; closeDetails(); }, refresh, getInsets };
}
