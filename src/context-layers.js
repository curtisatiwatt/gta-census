import L from 'leaflet';
import { t, currentLanguage, localizeHtml } from './i18n.js';
import { isDarkTheme } from './theme.js';
import { escapeHtml as esc, safeUrl } from './map-utils.js';
import { displayMapName, groupRoadLabels, roadPriority, visibleLineAnchors, visibleWaterAnchors } from './label-placement.js';

const lineName = (id, lines) => lines.find(line => line.id === id)?.name || id;
const lineColor = (id, lines, dark = false) => {
  const line = lines.find(item => item.id === id);
  return (dark ? line?.darkColor || line?.color : line?.color) || '#397458';
};
const statusName = status => ({ operating: '运营中', construction: '建设中 · 未运营', planned: '规划中 · 未运营' }[status] || '未运营');
const features = data => data?.type === 'FeatureCollection' && Array.isArray(data.features) ? data.features : [];

export function stationContent(properties, lines = []) {
  const names = (properties.lineIds || []).map(id => lineName(id, lines)).join(' / ');
  const approximate = properties.geometryQuality === 'approximate' || properties.geometryQuality === 'schematic';
  const source = safeUrl(properties.sourceUrl);
  return localizeHtml(`<strong>${esc(properties.name)}</strong><span class="station-lines">${esc(names)}</span><span class="station-status${properties.status === 'operating' ? '' : ' future-status'}">${esc(statusName(properties.status))}</span>${properties.phaseLabel ? `<span class="station-phase">${esc(properties.phaseLabel)}${properties.funding === 'unfunded' ? ' · 远期规划 / 未获建设资金' : ''}</span>` : ''}${approximate ? '<span class="station-position-note">规划示意位置，非最终站位</span>' : ''}${properties.locationNote ? `<span class="station-position-note">${esc(properties.locationNote)}</span>` : ''}${properties.note ? `<span class="station-position-note">${esc(properties.note)}</span>` : ''}${source ? `<a class="station-source" href="${source}" target="_blank" rel="noopener noreferrer">官方线路资料 ↗</a>` : ''}`);
}

/** Context geometry never changes census statistics or the heat-map scale. */
export function createContextLayers({ context, basemap, geography, operatingTransit, greenTransit, orientationLandmarks, transitLines = [], communityNames = [], visible, onStationOpen, getLabelObstacles }) {
  const map = context.map;
  const definitions = [['geography', 405], ['water', 410], ['roads', 420], ['roadLabels', 460], ['waterLabels', 465], ['transit', 440], ['stations', 480], ['stationLabels', 485], ['placeLabels', 468], ['landmarkLabels', 490]];
  for (const [name, zIndex] of definitions) {
    if (!map.getPane(name)) map.createPane(name);
    const pane = map.getPane(name);
    pane.style.zIndex = zIndex;
    if (name !== 'stations') pane.style.pointerEvents = 'none';
  }
  const roadLabels = L.layerGroup().addTo(map);
  const waterLabels = L.layerGroup().addTo(map);
  const stationLabels = L.layerGroup().addTo(map);
  const landmarkLabels = L.layerGroup().addTo(map);
  const placeLabels = L.layerGroup().addTo(map);
  const transitFeatures = [...features(operatingTransit), ...features(greenTransit)];
  const routes = transitFeatures.filter(f => f.properties.kind === 'transit_route');
  const stations = transitFeatures.filter(f => f.properties.kind === 'transit_station' && f.geometry?.type === 'Point');
  const roadFeatures = features(basemap).filter(f => f.properties.kind === 'road');
  const roadLabelGroups = groupRoadLabels(roadFeatures);
  const waterFeatures = features(basemap).filter(f => f.properties.kind === 'water' && f.properties.name && !/facility|storm.?water|management|industrial|energy park|pond [0-9]/i.test(f.properties.name))
    .sort((a, b) => waterPriority(b.properties.name) - waterPriority(a.properties.name));
  const orientationFeatures = features(orientationLandmarks).filter(f => f.properties.kind === 'orientation_landmark' && f.geometry?.type === 'Point' && f.properties.name)
    .sort((a, b) => (b.properties.priority || 0) - (a.properties.priority || 0));
  const project = coordinate => map.latLngToContainerPoint([coordinate[1], coordinate[0]]);
  function waterPriority(name) { return /river/i.test(name) ? 4 : /reservoir/i.test(name) ? 3 : /creek/i.test(name) ? 2 : 1; }
  const areaFeatures = features(geography).filter(f => ['airport', 'park', 'reserve'].includes(f.properties.kind));
  const normalizeName = name => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const parkLabelsByName = new Map();
  const iconicParks = new Set(['highpark', 'rougenationalurbanpark', 'torontoislandpark', 'tommythompsonpark', 'brontecreekprovincialpark']);
  for (const feature of areaFeatures.filter(f => f.properties.kind === 'park' && f.properties.named !== false)) {
    const p = feature.properties;
    // A single descriptive park label, not depot/school/parcel names from the same site.
    const name = String(p.name || '').split(';').map(part => part.trim()).find(part => /\bpark\b|natural area|sanctuary|wetland|garden|ravine/i.test(part));
    if (!name) continue;
    const key = normalizeName(name);
    const existing = parkLabelsByName.get(key);
    if (!existing || (p.areaHa || 0) > (existing.feature.properties.areaHa || 0)) parkLabelsByName.set(key, { feature, name, key, iconic: iconicParks.has(key) });
  }
  const parkLabelCandidates = [...parkLabelsByName.values()].sort((a, b) => Number(b.iconic) - Number(a.iconic) || (b.feature.properties.areaHa || 0) - (a.feature.properties.areaHa || 0));
  const roads = [];
  const railways = [];
  const routeLayers = [];
  const routeCasings = [];
  const stationLayers = [];
  const labelBoxes = [];
  const collection = items => ({ type: 'FeatureCollection', features: items });
  const textMeasure = document.createElement('canvas').getContext('2d');

  function roadStyle(feature, casing, zoomBucket, dark) {
    const priority = roadPriority(feature.properties);
    const primary = priority >= 3;
    const inner = zoomBucket === 2 ? (primary ? 3.4 : 2.2)
      : zoomBucket === 1 ? (primary ? 2.2 : 1.5) : (primary ? 1.6 : .9);
    return {
      color: casing ? (dark ? '#15212c' : primary ? '#818b94' : '#9da5aa')
        : (dark ? primary ? '#a2b2bf' : '#7f929f' : '#ffffff'),
      weight: inner + (casing ? (zoomBucket === 2 ? 1.6 : 1.1) : 0),
      opacity: casing ? .9 : 1,
      lineCap: 'round', lineJoin: 'round',
    };
  }

  const areasLayer = L.geoJSON(collection(areaFeatures), {
    pane: 'geography', interactive: false,
    style: feature => {
      const kind = feature.properties.kind;
      return kind === 'airport' ? { color: '#9585ad', weight: .8, opacity: .55, fillColor: '#c3b9da', fillOpacity: .42 }
        : kind === 'reserve' ? { color: '#af926b', weight: 1, dashArray: '5 4', opacity: .6, fillColor: '#ded0b7', fillOpacity: .35 }
          : { color: '#80a777', weight: .4, opacity: .4, fillColor: '#a5c898', fillOpacity: .42 };
    },
  }).addTo(map);
  const waterLayer = L.geoJSON(basemap || collection([]), { filter: f => f.properties.kind === 'water', pane: 'water', interactive: false, style: { color: '#75a7b5', weight: .85, fillColor: '#a5cad4', fillOpacity: .9 } }).addTo(map);
  for (const casing of [true, false]) {
    const layer = L.geoJSON(collection(roadFeatures), { pane: 'roads', interactive: false, style: feature => roadStyle(feature, casing, 0, isDarkTheme()) }).addTo(map);
    roads.push({ layer, casing });
  }
  for (const casing of [true, false]) {
    const layer = L.geoJSON(geography || collection([]), { filter: f => f.properties.kind === 'railway', pane: 'roads', interactive: false, style: { color: casing ? '#65716e' : '#f5f6ed', weight: casing ? 2.1 : 1.2, opacity: .85, dashArray: casing ? null : '7 5' } }).addTo(map);
    railways.push({ layer, casing });
  }
  // Draw route casings before coloured lines so intersecting routes stay legible.
  for (const feature of routes) {
    const layer = L.geoJSON(feature, { pane: 'transit', interactive: false, style: { color: '#fffef7', weight: 4, opacity: .8 } }).addTo(map);
    routeCasings.push({ layer, lineId: feature.properties.lineId, future: feature.properties.status !== 'operating' });
  }
  for (const lineId of [...new Set(routes.map(feature => feature.properties.lineId))]) {
    for (const feature of routes.filter(f => f.properties.lineId === lineId)) {
      const future = feature.properties.status !== 'operating';
      const layer = L.geoJSON(feature, { pane: 'transit', interactive: false, style: { color: lineColor(lineId, transitLines), weight: future ? 2.2 : 3.1, opacity: future ? .72 : .94, dashArray: future ? '5 5' : null, lineCap: 'round', lineJoin: 'round' } }).addTo(map);
      routeLayers.push({ layer, lineId, future });
    }
  }
  for (const feature of stations) {
    const p = feature.properties;
    const ids = p.lineIds || [];
    const shared = ids.length > 1;
    const color = lineColor(ids[0], transitLines);
    const future = p.status !== 'operating';
    const marker = L.circleMarker([feature.geometry.coordinates[1], feature.geometry.coordinates[0]], { pane: 'stations', className: 'transit-station', radius: shared ? 4.7 : 3.7, color: shared ? '#42535d' : color, weight: 1.9, fillColor: '#fffef8', fillOpacity: 1, dashArray: future ? '2 2' : null, bubblingMouseEvents: false }).addTo(map);
    const open = () => {
      onStationOpen?.();
      context.tooltip.close();
      L.popup({ className: 'station-popup', maxWidth: 280, autoPan: true, autoPanPaddingTopLeft: [12, 48], autoPanPaddingBottomRight: [12, window.matchMedia('(max-width: 760px)').matches ? 145 : 24], closeButton: true, autoClose: true, closeOnClick: true })
        .setLatLng(marker.getLatLng()).setContent(stationContent(p, transitLines)).openOn(map);
    };
    marker.on('click', open);
    const keydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } };
    let element = null;
    const detachElement = () => { element?.removeEventListener('keydown', keydown); element = null; };
    const attachElement = () => {
      detachElement();
      element = marker.getElement();
      element?.setAttribute('data-station-id', p.id);
      element?.setAttribute('aria-label', `${p.name} · ${ids.map(id => lineName(id, transitLines)).join(' / ')} · ${statusName(p.status)}`);
      element?.setAttribute('tabindex', '0');
      element?.setAttribute('role', 'button');
      element?.addEventListener('keydown', keydown);
    };
    marker.on('add', attachElement);
    marker.on('remove', detachElement);
    attachElement();
    context.tooltip.bind(marker, { content: () => stationContent(p, transitLines), anchor: () => marker.getLatLng(), offset: [0, -8] });
    stationLayers.push({ marker, shared, properties: p });
  }

  function setVisible(next) {
    visible = { ...visible, ...next };
    for (const name of ['roads', 'roadLabels', 'placeLabels']) map.getPane(name).style.display = visible.roads ? '' : 'none';
    for (const name of ['transit', 'stations', 'stationLabels']) map.getPane(name).style.display = visible.transit ? '' : 'none';
    for (const name of ['geography', 'landmarkLabels']) map.getPane(name).style.display = visible.landmarks ? '' : 'none';
    if (!visible.transit) { context.tooltip.close(); map.closePopup(); }
  }

  let lastStyleBucket = null;
  function update() {
    if (!map._loaded) return;
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const size = map.getSize();
    const dark = isDarkTheme();
    // Match rem-based map fonts, including an enlarged browser/system text size.
    // Collision boxes use measured glyph widths instead of the old 9px estimate.
    const rootStyle = getComputedStyle(document.documentElement);
    const textScale = (parseFloat(rootStyle.fontSize) || 16) / 16;
    const family = getComputedStyle(map.getContainer()).fontFamily;
    const measureLabel = (text, size = 12, extra = 0) => {
      const fontSize = size * textScale;
      if (textMeasure) textMeasure.font = `500 ${fontSize}px ${family}`;
      return { width: Math.ceil((textMeasure?.measureText(text).width ?? text.length * fontSize * .62) + 4 + extra), height: Math.ceil(fontSize * 1.4) };
    };
    const zoomBucket = zoom < 11.5 ? 0 : zoom < 13 ? 1 : 2;
    const styleBucket = `${zoomBucket}:${dark}`;
    if (styleBucket !== lastStyleBucket) {
      lastStyleBucket = styleBucket;
      const detail = zoomBucket === 2;
      areasLayer.setStyle(feature => {
        const kind = feature.properties.kind;
        return kind === 'airport' ? { color: dark ? '#77718c' : '#9585ad', fillColor: dark ? '#3d3c57' : '#c3b9da' }
          : kind === 'reserve' ? { color: dark ? '#81765d' : '#af926b', fillColor: dark ? '#484333' : '#ded0b7' }
          : { color: dark ? '#416850' : '#80a777', fillColor: dark ? '#27483a' : '#a5c898' };
      });
      waterLayer.setStyle({ color: dark ? '#648caa' : '#648fa9', weight: .9, fillColor: dark ? '#294d68' : '#acd2e3' });
      roads.forEach(({ layer, casing }) => layer.setStyle(feature => roadStyle(feature, casing, zoomBucket, dark)));
      railways.forEach(({ layer, casing }) => layer.setStyle({ color: casing ? (dark ? '#83918d' : '#65716e') : (dark ? '#20343a' : '#f5f6ed'), weight: casing ? (detail ? 1.6 : 1) : (detail ? .9 : .6), opacity: detail ? .6 : .32 }));
      const routeWeight = (lineId, future) => future ? (detail ? 2.3 : 1.6) : (detail ? 3.2 : 2.3);
      routeCasings.forEach(({ layer, lineId, future }) => layer.setStyle({ color: dark ? '#14272e' : '#fffef7', weight: routeWeight(lineId, future) + (detail ? 1.8 : 1.2) }));
      routeLayers.forEach(({ layer, lineId, future }) => layer.setStyle({ color: lineColor(lineId, transitLines, dark), weight: routeWeight(lineId, future) }));
      stationLayers.forEach(({ marker, shared, properties }) => {
        marker.setRadius(detail ? (shared ? 4.7 : 3.8) : (shared ? 3.1 : 2.4));
        const id = properties.lineIds?.[0];
        marker.setStyle({color: shared ? (dark ? '#b7c7cf' : '#42535d') : lineColor(id, transitLines, dark), fillColor: dark ? '#20343a' : '#fffef8'});
      });
    }
    // At overview scales, neighbouring downtown dots merge visually. Reveal them
    // progressively instead of drawing a dense string of overlapping targets.
    const stationPoints = [];
    for (const { marker, properties } of stationLayers) {
      const point = map.latLngToContainerPoint(marker.getLatLng());
      const minGap = zoom < 11.5 ? 13 : zoom < 13 ? 8 : 0;
      const shown = bounds.contains(marker.getLatLng()) && !stationPoints.some(p => Math.hypot(p.x - point.x, p.y - point.y) < minGap);
      if (shown) stationPoints.push(point);
      const element = marker.getElement();
      if (element) {
        element.style.display = shown ? '' : 'none';
        element.setAttribute('tabindex', shown ? '0' : '-1');
        element.setAttribute('aria-label', `${properties.name} · ${(properties.lineIds || []).map(id => lineName(id, transitLines)).join(' / ')} · ${t(statusName(properties.status))}`);
      }
    }
    roadLabels.clearLayers();
    waterLabels.clearLayers();
    stationLabels.clearLayers();
    landmarkLabels.clearLayers();
    placeLabels.clearLayers();
    labelBoxes.length = 0;
    labelBoxes.push(...(getLabelObstacles?.() || []));
    const reserveBox = box => {
      if (box.x < 8 || box.y < 8 || box.x + box.w > size.x - 8 || box.y + box.h > size.y - 8) return false;
      if (labelBoxes.some(a => box.x < a.x + a.w + 9 && box.x + box.w + 9 > a.x && box.y < a.y + a.h + 6 && box.y + box.h + 6 > a.y)) return false;
      labelBoxes.push(box);
      return true;
    };
    // Geographic names use the portion currently on screen, not a fixed city-wide midpoint.
    // Reserve their boxes before community labels are placed by the main renderer.
    let watersShown = 0;
    const placedWaterNames = new Set();
    const waterLimit = zoom < 13 ? 2 : 4;
    for (const feature of waterFeatures) {
      const waterNameKey = normalizeName(feature.properties.name);
      if (placedWaterNames.has(waterNameKey)) continue;
      const priority = waterPriority(feature.properties.name);
      if (zoom < (priority === 4 ? 11 : priority === 3 ? 11.5 : 13) || watersShown >= waterLimit) continue;
      const text = displayMapName(feature.properties.name);
      const { width, height } = measureLabel(text);
      const pixel = visibleWaterAnchors(feature.geometry, project, size, width)
        .find(point => reserveBox({ x: point.x - width / 2, y: point.y - height / 2, w: width, h: height }));
      if (!pixel) continue;
      watersShown++;
      placedWaterNames.add(waterNameKey);
      L.marker(map.containerPointToLatLng([pixel.x, pixel.y]), { pane: 'waterLabels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'water-label', html: `<span>${esc(text)}</span>`, iconSize: [width, height], iconAnchor: [width / 2, height / 2] }) }).addTo(waterLabels);
    }
    let placesShown = 0;
    const placedPlaceNames = [];
    const placeLimit = Math.min(6, Math.max(2, Math.floor(size.x * size.y / 170000)));
    if (visible.landmarks || visible.roads) for (const feature of orientationFeatures) {
      const p = feature.properties;
      const isPlace = p.placeType === 'municipality' || p.placeType === 'locality';
      if (isPlace ? !visible.roads : !visible.landmarks) continue;
      if (zoom < (p.minZoom || 12) || placesShown >= placeLimit) continue;
      const [lng, lat] = feature.geometry.coordinates;
      if (!bounds.contains([lat, lng])) continue;
      const pixel = project([lng, lat]);
      const { width, height } = measureLabel(p.name, 12, 10);
      if (!reserveBox({ x: pixel.x - 3, y: pixel.y - height / 2, w: width, h: height })) continue;
      placesShown++;
      placedPlaceNames.push(normalizeName(p.name));
      L.marker([lat, lng], { pane: isPlace ? 'placeLabels' : 'landmarkLabels', interactive: false, keyboard: false, icon: L.divIcon({ className: isPlace ? 'place-label' : 'orientation-label', html: `<span>${esc(p.name)}</span>`, iconSize: [width, height], iconAnchor: [3, height / 2] }) }).addTo(isPlace ? placeLabels : landmarkLabels);
    }
    let parksShown = 0;
    const candidates = [
      ...areaFeatures.filter(f => f.properties.kind !== 'park').map(feature => ({ feature, name: feature.properties.name, iconic: true })),
      ...parkLabelCandidates,
    ];
    if (visible.landmarks) for (const { feature, name, iconic } of candidates) {
      const p = feature.properties;
      if (p.kind === 'park') {
        const parkKey = normalizeName(name);
        if (placedPlaceNames.some(key => key === parkKey || (Math.min(key.length, parkKey.length) >= 10 && (key.startsWith(parkKey) || parkKey.startsWith(key))))) continue;
        if (zoom < 11 || (zoom < 13 && (!iconic || parksShown >= 3))) continue;
        if (zoom >= 13 && !iconic && !(p.areaHa >= 20)) continue;
      }
      const coordinates = p.labelPoint || p.centroid;
      const point = Array.isArray(coordinates) && coordinates.length >= 2
        ? L.latLng(coordinates[1], coordinates[0]) : L.geoJSON(feature).getBounds().getCenter();
      if (!bounds.contains(point)) continue;
      const pixel = map.latLngToContainerPoint(point);
      const text = p.displayName || name;
      const { width, height } = measureLabel(text, 11);
      if (!reserveBox({ x: pixel.x - width / 2, y: pixel.y - height / 2, w: width, h: height })) continue;
      if (p.kind === 'park') parksShown++;
      L.marker(point, { pane: 'landmarkLabels', interactive: false, keyboard: false, icon: L.divIcon({ className: `landmark-label ${p.kind}-label`, html: `<span>${esc(text)}</span>`, iconSize: [width, height], iconAnchor: [width / 2, height / 2] }) }).addTo(landmarkLabels);
    }
    let roadsShown = 0;
    const roadLimit = Math.min(zoom < 13 ? 10 : zoom < 14 ? 18 : 25, Math.max(3, Math.floor(size.x * size.y / ((zoom < 13 ? 85000 : 60000) * textScale))));
    if (visible.roads && zoom >= 11) for (const group of roadLabelGroups) {
      if (roadsShown >= roadLimit) break;
      if (zoom < 12 && group.priority < 3 || zoom < 13 && group.priority < 2) continue;
      const { width, height } = measureLabel(group.name);
      const pixel = visibleLineAnchors(group.lines, project, size, width)
        .find(point => reserveBox({ x: point.x - width / 2, y: point.y - height / 2, w: width, h: height }));
      if (!pixel) continue;
      roadsShown++;
      L.marker(map.containerPointToLatLng([pixel.x, pixel.y]), { pane: 'roadLabels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'road-label', html: `<span>${esc(group.name)}</span>`, iconSize: [width, height], iconAnchor: [width / 2, height / 2] }) }).addTo(roadLabels);
    }
    if (visible.transit && zoom >= 13) for (const feature of stations) {
      const [lng, lat] = feature.geometry.coordinates;
      if (!bounds.contains([lat, lng])) continue;
      const p = feature.properties;
      const point = map.latLngToContainerPoint([lat, lng]);
      const text = `${p.name}${p.status === 'operating' ? '' : currentLanguage() === 'en' ? ' · not in service' : ' · 未运营'}`;
      const { width, height } = measureLabel(text, 11);
      if (!reserveBox({ x: point.x + 7, y: point.y - height / 2, w: width, h: height })) continue;
      L.marker([lat, lng], { pane: 'stationLabels', interactive: false, keyboard: false, icon: L.divIcon({ className: `station-label${p.status === 'operating' ? '' : ' future-station-label'}`, html: `<span>${esc(text)}</span>`, iconSize: [width, height], iconAnchor: [-7, height / 2] }) }).addTo(stationLabels);
    }

  }
  setVisible(visible);
  return { setVisible, update, labelBoxes, stationCount: stations.length };
}
