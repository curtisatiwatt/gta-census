/**
 * Community outlines live above the geographic basemap. Reordering the original
 * polygon inside Leaflet's overlay pane cannot lift it above roads or water.
 * Separate, noninteractive paths preserve the data fill and underlying hit area.
 */
export function createCommunityHighlight({ L, map, features, isDark = () => false, hoverEnabled = () => true }) {
  const paneName = 'communityHighlights';
  const pane = map.getPane(paneName) || map.createPane(paneName);
  pane.style.zIndex = 447;
  pane.style.pointerEvents = 'none';
  const container = map.getContainer();
  const document = container.ownerDocument;
  const window = document.defaultView;
  const byCode = new Map(features.map(feature => [feature.properties.code, feature]));
  const bindings = new Set();
  let selectedCode = null;
  let selectedPaths = [];
  let hoverPaths = [];
  let active = null;
  let moving = false;
  let zooming = false;
  let destroyed = false;

  function remove(paths) {
    for (const path of paths) map.removeLayer(path);
    paths.length = 0;
  }

  function outline(code, selected) {
    const feature = byCode.get(code);
    if (!feature) return [];
    const dark = isDark();
    const common = {
      pane: paneName, interactive: false, bubblingMouseEvents: false,
      fill: false, opacity: 1, lineCap: 'round', lineJoin: 'round',
      // Keep every source ring and vertex. Clipping a polygon at the viewport
      // can invent a straight edge; simplification can eat narrow boundary turns.
      noClip: true, smoothFactor: 0, dashArray: null,
    };
    const name = selected ? 'selected' : 'hover';
    return [
      L.geoJSON(feature, {
        ...common, color: dark ? '#0f252e' : '#ffffff', weight: selected ? 7 : 5.5,
        className: `community-${name}-halo`,
      }).addTo(map),
      L.geoJSON(feature, {
        ...common, color: selected ? (dark ? '#9bdcf4' : '#075d83') : (dark ? '#ecf4f7' : '#334d5c'),
        weight: selected ? 3.5 : 2.25,
        className: `community-${name}-outline`,
      }).addTo(map),
    ];
  }

  function clearHover() {
    active = null;
    remove(hoverPaths);
  }

  function drawHover() {
    remove(hoverPaths);
    if (active && active.code !== selectedCode) hoverPaths = outline(active.code, false);
    // Selection stays visually stronger along a shared community border.
    for (const path of selectedPaths) path.bringToFront();
  }

  function show(binding, event, keyboard = false) {
    const original = event?.originalEvent;
    if (destroyed || moving || zooming || !map.hasLayer(binding.layer)
      || (!keyboard && (!hoverEnabled() || original?.pointerType === 'touch'
        || original?.sourceCapabilities?.firesTouchEvents || original?.buttons > 0))) return;
    if (active?.binding === binding) return;
    active = { binding, code: binding.code };
    drawHover();
  }

  function bind(layer, code) {
    if (!byCode.has(code)) return () => {};
    const binding = { layer, code };
    bindings.add(binding);
    let element;
    const hover = event => show(binding, event);
    const leave = () => { if (active?.binding === binding) clearHover(); };
    const focus = () => { if (element?.matches(':focus-visible')) show(binding, undefined, true); };
    const detach = () => {
      element?.removeEventListener('focus', focus);
      element?.removeEventListener('blur', leave);
      element = null;
    };
    const attach = () => {
      detach();
      element = layer.getElement?.();
      element?.addEventListener('focus', focus);
      element?.addEventListener('blur', leave);
    };
    const handlers = { mouseover: hover, mousemove: hover, mouseout: leave, add: attach, remove: unbind };
    function unbind() {
      leave(); detach(); layer.off(handlers); bindings.delete(binding);
    }
    binding.unbind = unbind;
    layer.on(handlers);
    attach();
    return unbind;
  }

  function setSelected(code) {
    const next = byCode.has(code) ? code : null;
    if (destroyed || selectedCode === next) return;
    selectedCode = next;
    clearHover();
    remove(selectedPaths);
    selectedPaths = outline(selectedCode, true);
  }

  function refresh() {
    if (destroyed) return;
    remove(selectedPaths);
    selectedPaths = outline(selectedCode, true);
    if (!hoverEnabled()) clearHover();
    else drawHover();
  }

  const startMove = () => { moving = true; clearHover(); };
  const endMove = () => { moving = false; };
  const startZoom = () => { zooming = true; clearHover(); };
  const endZoom = () => { zooming = false; };
  const visibility = () => { if (document.hidden) clearHover(); };
  const keydown = event => { if (event.key === 'Escape') clearHover(); };
  const mapEvents = { movestart: startMove, moveend: endMove, zoomstart: startZoom, zoomend: endZoom, preclick: clearHover, unload: destroy };

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearHover(); remove(selectedPaths);
    for (const binding of [...bindings]) binding.unbind();
    map.off(mapEvents);
    container.removeEventListener('mouseleave', clearHover);
    window.removeEventListener('blur', clearHover);
    window.removeEventListener('resize', clearHover);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('keydown', keydown);
  }

  map.on(mapEvents);
  container.addEventListener('mouseleave', clearHover);
  window.addEventListener('blur', clearHover);
  window.addEventListener('resize', clearHover);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('keydown', keydown);
  return { bind, setSelected, clearHover, refresh, destroy };
}
