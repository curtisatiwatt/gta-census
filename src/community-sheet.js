import { addTranslations, t } from './i18n.js';
import { clampSheetHeight, releaseSheetSnap, sheetHeights, stepSheetSnap } from './community-sheet-utils.js';

addTranslations({
  '关闭社区详情': 'Close community details',
  '社区详情，摘要。向上滑动展开': 'Community details, summary. Swipe up to expand',
  '社区详情，半屏。向上滑动展开，向下滑动收起': 'Community details, half screen. Swipe up to expand or down to collapse',
  '社区详情，展开。向下滑动收起': 'Community details, expanded. Swipe down to collapse',
  '使用上下方向键调整高度，Home 收起，End 展开，Escape 关闭。': 'Use the up and down arrow keys to resize, Home to collapse, End to expand, and Escape to close.',
});

const LABELS = {
  peek: '社区详情，摘要。向上滑动展开',
  half: '社区详情，半屏。向上滑动展开，向下滑动收起',
  full: '社区详情，展开。向下滑动收起',
};
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [contenteditable="true"]';

/** A nonmodal mobile sheet: the uncovered map stays interactive at every stop. */
export function initCommunitySheet({ onChange = () => {}, onClose = () => {} } = {}) {
  const sidebar = document.querySelector('.sidebar');
  const panel = document.getElementById('detail-panel');
  const handle = document.getElementById('mobile-detail-handle');
  const title = document.getElementById('community-name');
  const summary = document.getElementById('collapsed-summary');
  const meta = document.getElementById('community-meta');
  const content = document.getElementById('detail-body');
  const mobile = window.matchMedia('(max-width: 760px)');
  const header = document.createElement('div');
  header.className = 'community-sheet-header';
  panel.insertBefore(header, title);
  header.append(handle, title, summary, meta);
  handle.type = 'button';
  handle.replaceChildren();
  const bar = document.createElement('span');
  bar.className = 'handle-bar';
  bar.setAttribute('aria-hidden', 'true');
  handle.append(bar);
  const instructions = document.createElement('span');
  instructions.id = 'community-sheet-instructions';
  instructions.className = 'sr-only';
  header.append(instructions);
  handle.setAttribute('aria-describedby', instructions.id);
  const closeButton = document.createElement('button');
  closeButton.id = 'mobile-sheet-close';
  closeButton.type = 'button';
  closeButton.className = 'community-sheet-close';
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  header.append(closeButton);

  let snap = 'closed';
  let mobileApplied = false;
  let drag = null;
  let scrollHandoff = null;
  let suppressClickUntil = 0;
  let heights = sheetHeights(window.innerHeight, 150);
  let refreshFrame = 0;
  const viewportHeight = () => Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight);
  const isVisible = () => mobile.matches && snap !== 'closed' && !document.body.classList.contains('map-focus');

  function measure() {
    // The header remains natural height even when the body is clipped or scrolled.
    // Using its actual typography keeps the summary usable with enlarged text.
    const style = getComputedStyle(panel);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const headerHeight = header.getBoundingClientRect().height;
    heights = sheetHeights(viewportHeight(), headerHeight + padding + 1);
  }

  function updateLabels() {
    handle.setAttribute('aria-label', `${t(LABELS[snap] || LABELS.peek)} · ${title.textContent}`);
    handle.setAttribute('aria-expanded', String(snap === 'half' || snap === 'full'));
    closeButton.setAttribute('aria-label', t('关闭社区详情'));
    instructions.textContent = t('使用上下方向键调整高度，Home 收起，End 展开，Escape 关闭。');
  }

  function apply() {
    sidebar.dataset.sheetSnap = snap;
    if (mobile.matches) {
      mobileApplied = true;
      sidebar.classList.toggle('collapsed', snap === 'peek' || snap === 'closed');
      sidebar.classList.remove('sheet-dragging');
      if (snap !== 'closed') measure();
      sidebar.style.setProperty('--community-sheet-height', `${snap === 'closed' ? 0 : heights[snap]}px`);
      sidebar.inert = snap === 'closed';
      if (snap === 'closed') sidebar.setAttribute('aria-hidden', 'true');
      else sidebar.removeAttribute('aria-hidden');
      content.inert = snap === 'peek' || snap === 'closed';
    } else if (mobileApplied) {
      // The desktop shell owns visibility there. Clean up our mobile state once,
      // then leave its ARIA, inert state and collapsed class alone on refresh.
      mobileApplied = false;
      sidebar.classList.remove('collapsed', 'sheet-dragging');
      sidebar.style.removeProperty('--community-sheet-height');
      sidebar.inert = false;
      content.inert = false;
      sidebar.removeAttribute('aria-hidden');
    }
    updateLabels();
  }

  function refresh() {
    if (drag) return;
    apply();
  }

  function cancelGesture() {
    const previous = drag;
    drag = null;
    scrollHandoff = null;
    if (previous?.capture && previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id);
  }

  function setSnap(next) {
    if (!['peek', 'half', 'full', 'closed'].includes(next)) return;
    cancelGesture();
    snap = next;
    if (next === 'peek') content.scrollTop = 0;
    apply();
    onChange(snap);
  }

  function open(next = 'half') {
    content.scrollTop = 0;
    setSnap(next === 'closed' ? 'half' : next);
  }

  function close(event) {
    // Consume the activation before removing its target from hit testing.
    event?.preventDefault();
    event?.stopPropagation();
    const hadFocus = sidebar.contains(document.activeElement);
    setSnap('closed');
    if (hadFocus) {
      const map = document.querySelector('.map-view:not([hidden]) .map-canvas, .map-view:not([hidden]) .comparison-map');
      map?.focus({ preventScroll: true });
    }
    onClose();
  }

  function beginDrag({ id, target, y, time, capture = true }) {
    measure();
    drag = {
      id, target, capture, startY: y,
      startHeight: sidebar.getBoundingClientRect().height, height: sidebar.getBoundingClientRect().height,
      snap, moved: false, samples: [{ y, time }],
    };
    // Capture on the header/body rather than globally: the map remains independent.
    if (capture) target.setPointerCapture(id);
  }

  function startDrag(event) {
    if (!isVisible() || event.isPrimary === false || event.button !== 0 || drag) return;
    const interactive = event.target.closest(INTERACTIVE);
    if (interactive && interactive !== handle) return;
    const fromContent = content.contains(event.target);
    if (fromContent && snap !== 'half') return;
    beginDrag({
      id: event.pointerId, target: handle.contains(event.target) ? handle : event.currentTarget,
      y: event.clientY, time: event.timeStamp,
    });
  }

  function updateDrag(y, time) {
    const delta = drag.startY - y;
    if (!drag.moved && Math.abs(delta) < 6) return;
    drag.moved = true;
    sidebar.classList.add('sheet-dragging');
    // Show the body while a peek is being pulled upwards, without changing state.
    content.inert = false;
    drag.height = clampSheetHeight(drag.startHeight + delta, heights);
    sidebar.style.setProperty('--community-sheet-height', `${drag.height}px`);
    drag.samples.push({ y, time });
    drag.samples = drag.samples.filter(sample => time - sample.time <= 100);
  }

  function finishDrag({ y, time, cancelled = false }) {
    const finished = drag;
    drag = null;
    if (finished.capture && finished.target.hasPointerCapture(finished.id)) finished.target.releasePointerCapture(finished.id);
    if (!finished.moved) return;
    suppressClickUntil = performance.now() + 400;
    const first = finished.samples[0];
    const elapsed = time - first.time;
    const velocity = elapsed > 0 && elapsed < 160 ? (first.y - y) / elapsed : 0;
    setSnap(cancelled ? finished.snap : releaseSheetSnap({
      snap: finished.snap, startHeight: finished.startHeight, height: finished.height, velocity, heights,
    }));
  }

  function moveDrag(event) {
    if (drag?.id === event.pointerId) updateDrag(event.clientY, event.timeStamp);
  }

  function endDrag(event) {
    if (drag?.id === event.pointerId) finishDrag({ y: event.clientY, time: event.timeStamp, cancelled: event.type === 'pointercancel' });
  }

  for (const region of [header, content]) {
    region.addEventListener('pointerdown', startDrag);
    region.addEventListener('pointermove', moveDrag);
    region.addEventListener('pointerup', endDrag);
    region.addEventListener('pointercancel', endDrag);
    region.addEventListener('lostpointercapture', event => {
      if (drag?.id === event.pointerId) endDrag({ ...event, type: 'pointercancel', pointerId: event.pointerId });
    });
  }
  // Once expanded, the body uses native scrolling. A downward touch that starts
  // at its top transfers to the sheet; upward gestures and an already-scrolled
  // body remain native. This listener is confined to the detail body, never map.
  content.addEventListener('touchstart', event => {
    scrollHandoff = null;
    if (!isVisible() || snap !== 'full' || drag || content.scrollTop > 1 || event.touches.length !== 1 || event.target.closest(INTERACTIVE)) return;
    const touch = event.touches[0];
    scrollHandoff = { id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
  }, { passive: true });
  content.addEventListener('touchmove', event => {
    if (!isVisible()) { scrollHandoff = null; return; }
    if (!scrollHandoff || event.touches.length !== 1) return;
    const touch = [...event.touches].find(item => item.identifier === scrollHandoff.id);
    if (!touch) return;
    if (drag?.id === `touch-${touch.identifier}`) {
      if (event.cancelable) event.preventDefault();
      updateDrag(touch.clientY, event.timeStamp);
      return;
    }
    const dy = touch.clientY - scrollHandoff.y;
    const dx = touch.clientX - scrollHandoff.x;
    if (dy < -6 || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))) { scrollHandoff = null; return; }
    if (dy < 6 || !event.cancelable || snap !== 'full' || content.scrollTop > 1) return;
    event.preventDefault();
    beginDrag({ id: `touch-${touch.identifier}`, target: content, y: scrollHandoff.y, time: scrollHandoff.time, capture: false });
    updateDrag(touch.clientY, event.timeStamp);
  }, { passive: false });
  for (const type of ['touchend', 'touchcancel']) {
    content.addEventListener(type, event => {
      const touch = [...event.changedTouches].find(item => `touch-${item.identifier}` === drag?.id);
      if (touch) finishDrag({ y: touch.clientY, time: event.timeStamp, cancelled: type === 'touchcancel' });
      scrollHandoff = null;
    }, { passive: true });
  }
  sidebar.addEventListener('click', event => {
    const interactive = event.target.closest(INTERACTIVE);
    if (performance.now() < suppressClickUntil && (!interactive || interactive === handle)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  handle.addEventListener('click', () => setSnap(snap === 'full' ? 'half' : stepSheetSnap(snap, 1)));
  handle.addEventListener('keydown', event => {
    const next = {
      ArrowUp: stepSheetSnap(snap, 1), ArrowDown: stepSheetSnap(snap, -1), Home: 'peek', End: 'full',
    }[event.key];
    if (!next) return;
    event.preventDefault();
    setSnap(next);
  });
  closeButton.addEventListener('click', close);
  sidebar.addEventListener('keydown', event => {
    if (mobile.matches && event.key === 'Escape') close(event);
  });
  const scheduleRefresh = () => {
    cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(refresh);
  };
  const headerObserver = new ResizeObserver(scheduleRefresh);
  headerObserver.observe(header);
  window.addEventListener('resize', scheduleRefresh);
  window.visualViewport?.addEventListener('resize', scheduleRefresh);
  window.addEventListener('atlas-languagechange', scheduleRefresh);
  mobile.addEventListener('change', () => { cancelGesture(); apply(); onChange(snap); });
  apply();

  return {
    open, setSnap, close, refresh,
    getState: () => snap,
    getInset: () => isVisible() ? sidebar.getBoundingClientRect().height : 0,
    getTargetInset: () => isVisible() ? heights[snap] : 0,
  };
}
