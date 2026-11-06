import { addTranslations, t } from './i18n.js';

addTranslations({
  '返回菜单': 'Back to menu', '菜单': 'Menu', '关闭菜单': 'Close menu',
  '返回地图设置': 'Back to menu', '数据说明': 'About the data',
  '道路、轻轨与地标': 'Roads, transit and landmarks',
  '统计口径与官方来源': 'Definitions and official sources',
  '显示偏好': 'Display preferences', '地图与资料': 'Map and data',
  '地图视图': 'Map view', '数据与图层': 'Data and layers',
  '更多': 'More', '地图设置': 'Map menu', '关闭设置': 'Close menu',
  '图例': 'Legend', '关闭图例': 'Close legend', '查看详情': 'Details', '收起': 'Collapse',
  '语言': 'Language', '外观': 'Appearance',
  '跟随系统': 'System default', '白天': 'Light', '夜间': 'Dark', '常用五类': 'Top five groups',
  '搜索 GTA 社区': 'Search GTA communities',
});

const $ = id => document.getElementById(id);
let activeUI;
export function getMobileMapInsets() {
  return activeUI?.insets() || { top: 0, right: 0, bottom: 0, left: 0 };
}

export function initMobileUI({ onLayoutChange = () => {} } = {}) {
  const media = matchMedia('(max-width: 760px)');
  const sidebar = document.querySelector('.sidebar');
  const header = document.querySelector('.app-header');
  const viewbar = document.querySelector('.viewbar');
  const tabs = document.querySelector('.view-tabs');
  const controls = document.querySelector('.view-controls');
  const pager = document.querySelector('.comparison-pager');
  const more = $('mobile-more-dialog');
  const legend = $('mobile-legend-dialog');
  const filters = $('mobile-filter-dialog');
  const portals = new Map();
  let measured = { top: 0, right: 0, bottom: 0, left: 0 };
  let scheduled = 0;
  let moved = false;

  // Legends belong to one on-demand dialog on every screen size.
  for (const id of ['composition-key', 'income-legend', 'transit-legend']) $('mobile-composition-legend').append($(id));
  $('mobile-distribution-legend').append($('population-legend'));

  function move(node, destination) {
    if (!node || !destination) return;
    if (!portals.has(node)) {
      const marker = document.createComment('mobile control origin');
      node.before(marker); portals.set(node, marker);
    }
    destination.append(node);
  }
  function restore() { for (const [node, marker] of portals) marker.after(node); }
  function closeDialog(dialog) { if (dialog.open) dialog.close(); }
  function closeFilters() {
    if (!$('groups-panel').hidden) $('close-groups').click();
    if (!$('layers-panel').hidden) $('close-layers').click();
    closeDialog(filters);
  }
  function closeTransient() { closeDialog(more); closeDialog(legend); closeFilters(); }
  function openDialog(dialog) {
    closeTransient();
    if (!dialog.open) dialog.showModal();
    $('mobile-more').setAttribute('aria-expanded', String(more.open));
    $('mobile-legend-button').setAttribute('aria-expanded', String(legend.open));
  }
  function syncFilterDialog() {
    if (!media.matches) return;
    const panel = !$('groups-panel').hidden ? $('groups-panel') : !$('layers-panel').hidden ? $('layers-panel') : null;
    if (!panel) return closeDialog(filters);
    closeDialog(more); closeDialog(legend);
    filters.setAttribute('aria-label', panel.getAttribute('aria-label') || '');
    if (!filters.open) {
      filters.showModal();
      (panel.id === 'groups-panel' ? $('close-groups') : $('close-layers')).focus({ preventScroll: true });
    }
  }
  function readInsets() {
    if (!media.matches) return { top: 0, right: 0, bottom: 0, left: 0 };
    const picker = $('mobile-map-switcher');
    const top = Math.ceil(Math.max(header.getBoundingClientRect().bottom, picker.hidden ? 0 : picker.getBoundingClientRect().bottom)) + 12;
    const bottom = sidebar.dataset.sheetSnap === 'closed' ? 0 : Math.ceil(sidebar.getBoundingClientRect().height);
    return { top, bottom: bottom + 14, left: 12, right: 12 };
  }
  function measure() {
    scheduled = 0;
    if (!media.matches) { measured = { top: 0, right: 0, bottom: 0, left: 0 }; return; }
    document.body.classList.toggle('mobile-extra-large', parseFloat(getComputedStyle(document.documentElement).fontSize) >= 28);
    document.documentElement.style.setProperty('--mobile-header-bottom', `${Math.ceil(header.getBoundingClientRect().bottom)}px`);
    const next = readInsets();
    document.documentElement.style.setProperty('--mobile-ui-top', `${next.top}px`);
    document.documentElement.style.setProperty('--mobile-sheet-height', `${next.bottom - 14}px`);
    if (Object.keys(next).some(key => next[key] !== measured[key])) { measured = next; onLayoutChange(next); }
  }
  function scheduleMeasure() { if (!scheduled) scheduled = requestAnimationFrame(measure); }
  function refresh() {
    const mobile = media.matches;
    const comparing = document.querySelector('.map-workspace').classList.contains('comparing');
    const groups = Number($('group-count').textContent) || 0;
    document.body.classList.toggle('mobile-map-ui', mobile);
    document.body.classList.toggle('mobile-comparing', mobile && comparing);
    if (mobile && !moved) {
      moved = true;
      move(tabs, $('mobile-view-slot'));
      move(controls, $('mobile-controls-slot'));
      move(pager, $('mobile-map-switcher'));
      move($('groups-panel'), filters);
      move($('layers-panel'), filters);
    } else if (!mobile && moved) { closeTransient(); restore(); moved = false; }
    $('search').placeholder = t('搜索城市或普查区');
    $('mobile-map-switcher').hidden = !mobile || !comparing || !groups;
    pager.hidden = mobile && (!comparing || !groups);
    $('mobile-composition-legend').hidden = comparing;
    $('mobile-distribution-legend').hidden = !comparing;
    const hasLegend = comparing ? groups > 0 : groups > 0 || $('income-toggle').checked || $('transit-toggle').checked;
    $('mobile-legend-button').hidden = !hasLegend;
    if (!hasLegend) closeDialog(legend);
    for (const node of document.querySelectorAll('[data-mobile-text]')) node.textContent = t(node.dataset.mobileText);
    const binColors = [...$('population-ramp').children].map(node => node.style.background);
    document.querySelectorAll('.population-bin-labels>span').forEach((node, index) => node.style.setProperty('--bin-color', binColors[index] || '#ddd'));
    $('mobile-more').setAttribute('aria-label', t('菜单'));
    $('mobile-more').title = t('菜单');
    $('mobile-more').setAttribute('aria-expanded', String(more.open));
    $('mobile-legend-button').setAttribute('aria-expanded', String(legend.open));
    syncFilterDialog(); scheduleMeasure();
  }

  $('mobile-more').addEventListener('click', () => openDialog(more));
  $('back-layers')?.addEventListener('click', () => { closeFilters(); openDialog(more); });
  $('back-groups')?.addEventListener('click', () => { closeFilters(); openDialog(more); });
  $('back-method')?.addEventListener('click', () => { $('method-dialog').close(); openDialog(more); });
  $('layers-button').addEventListener('click', () => closeDialog(more), true);
  tabs.addEventListener('click', () => { if (media.matches) closeDialog(more); });
  $('mobile-legend-button').addEventListener('click', () => openDialog(legend));
  $('close-mobile-more').addEventListener('click', () => closeDialog(more));
  $('close-mobile-legend').addEventListener('click', () => closeDialog(legend));
  $('method-button').addEventListener('click', () => closeDialog(more), true);
  for (const dialog of [more, legend, filters]) {
    dialog.addEventListener('close', () => { if (dialog === filters) closeFilters(); refresh(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) {
        if (dialog === filters) closeFilters(); else closeDialog(dialog);
      }
    });
  }
  filters.addEventListener('cancel', event => { event.preventDefault(); closeFilters(); });
  const layoutObserver = new ResizeObserver(scheduleMeasure);
  for (const node of [header, sidebar, $('mobile-map-switcher')]) layoutObserver.observe(node);
  const stateObserver = new MutationObserver(refresh);
  stateObserver.observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  stateObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  stateObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  stateObserver.observe(document.querySelector('.map-workspace'), { attributes: true, attributeFilter: ['class'] });
  for (const panel of [$('groups-panel'), $('layers-panel'), $('income-legend'), $('transit-legend')]) stateObserver.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  stateObserver.observe($('group-count'), { childList: true, characterData: true, subtree: true });
  media.addEventListener('change', refresh);
  activeUI = { insets: readInsets };
  refresh();
  return { refresh, closeTransient };
}
