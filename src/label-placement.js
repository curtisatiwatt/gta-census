/** Screen-space placement for geographic reference labels. No Leaflet dependency. */
export function displayMapName(name) {
  const acronyms = new Set(['NW', 'NE', 'SW', 'SE', 'YYZ', 'YTZ', 'QEW', 'DVP', 'GO', 'TTC', 'UP']);
  const abbreviations = { AV: 'Ave', AVE: 'Ave', ST: 'St', TR: 'Trail', TRL: 'Trail', RD: 'Rd', DR: 'Dr', BV: 'Blvd', BLVD: 'Blvd', HWY: 'Hwy' };
  return String(name || '').replace(/\s+/g, ' ').trim().split(' ').map(word => {
    const upper = word.toUpperCase();
    return acronyms.has(upper) ? upper : abbreviations[upper] || (word === upper ? word.charAt(0) + word.slice(1).toLowerCase() : word);
  }).join(' ');
}

export function roadLabelName(name) {
  return displayMapName(String(name || '').replace(/\b(?:NB|SB|EB|WB)\b/gi, '').replace(/\s+/g, ' ').trim());
}

export function roadPriority(properties) {
  const name = String(properties.name || '');
  const classes = (properties.classes || []).join(' ');
  if (/\b(?:Highway|Hwy)\s*40[0-9]\b|\bQEW\b|Gardiner|Don Valley Parkway/i.test(name)) return 4;
  if (/Arterial-Class A|Skeletal Road|Freeway|Expressway/i.test(classes)) return 3;
  if (/Arterial-Class B|Arterial Street|Industrial Arterial/i.test(classes)) return 2;
  return 1;
}

export function groupRoadLabels(features) {
  const grouped = new Map();
  for (const feature of features) {
    const name = roadLabelName(feature.properties?.name);
    const lines = feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [];
    if (!name || !lines.length) continue;
    const key = name.toLowerCase();
    if (!grouped.has(key)) grouped.set(key, { name, priority: 0, lines: [] });
    const group = grouped.get(key);
    group.priority = Math.max(group.priority, roadPriority(feature.properties));
    group.lines.push(...lines);
  }
  return [...grouped.values()].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

/** Liang–Barsky clipping also catches a line crossing a viewport with both ends outside. */
export function clipSegment(a, b, rect) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let lo = 0, hi = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - rect.left, rect.right - a.x, a.y - rect.top, rect.bottom - a.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return [{ x: a.x + dx * lo, y: a.y + dy * lo }, { x: a.x + dx * hi, y: a.y + dy * hi }];
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function pointAlong(points, length, fraction) {
  let target = length * fraction;
  for (let i = 1; i < points.length; i++) {
    const segment = distance(points[i - 1], points[i]);
    if (target <= segment && segment > 0) {
      const t = target / segment;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
    target -= segment;
  }
  return points.at(-1);
}

/** Candidates stay on visible road geometry, even far from a feature's global midpoint. */
export function visibleLineAnchors(lines, project, size, labelWidth = 100) {
  const rect = { left: labelWidth / 2 + 10, right: size.x - labelWidth / 2 - 10, top: 22, bottom: size.y - 22 };
  if (rect.left >= rect.right || rect.top >= rect.bottom) return [];
  const pieces = [];
  for (const line of lines) {
    let piece = [];
    let length = 0;
    const flush = () => { if (length > 5) pieces.push({ points: piece, length }); piece = []; length = 0; };
    for (let i = 1; i < line.length; i++) {
      const clipped = clipSegment(project(line[i - 1]), project(line[i]), rect);
      if (!clipped) { flush(); continue; }
      if (piece.length && distance(piece.at(-1), clipped[0]) > .5) flush();
      if (!piece.length) piece.push(clipped[0]);
      piece.push(clipped[1]);
      length += distance(clipped[0], clipped[1]);
    }
    flush();
  }
  const center = { x: size.x / 2, y: size.y / 2 };
  return pieces.flatMap(piece => (piece.length > 180 ? [.5, .25, .75] : [.5]).map(fraction => ({
    ...pointAlong(piece.points, piece.length, fraction), length: piece.length,
  }))).sort((a, b) => Math.min(b.length, 300) - Math.min(a.length, 300) || distance(a, center) - distance(b, center)).slice(0, 24);
}

/** Interior scanline points avoid placing a river label in the bend's empty bounding-box centre. */
export function visibleWaterAnchors(geometry, project, size, labelWidth = 100) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
  const left = labelWidth / 2 + 10, right = size.x - labelWidth / 2 - 10;
  const top = 22, bottom = size.y - 22;
  if (left >= right || top >= bottom) return [];
  const candidates = [];
  for (const polygon of polygons) {
    const rings = polygon.map(ring => ring.map(project));
    const outer = rings[0] || [];
    if (!outer.length) continue;
    const minX = Math.min(...outer.map(p => p.x)), maxX = Math.max(...outer.map(p => p.x));
    const minY = Math.max(top, Math.min(...outer.map(p => p.y))), maxY = Math.min(bottom, Math.max(...outer.map(p => p.y)));
    if (maxX < left || minX > right || maxY < minY) continue;
    const steps = Math.min(24, Math.max(3, Math.ceil((maxY - minY) / 24)));
    for (let scan = 0; scan < steps; scan++) {
      const y = minY + (maxY - minY) * (scan + .5) / steps;
      const intersections = [];
      for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j], b = ring[i];
        if ((a.y > y) !== (b.y > y)) intersections.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
      }
      intersections.sort((a, b) => a - b);
      for (let i = 1; i < intersections.length; i += 2) {
        const x1 = Math.max(left, intersections[i - 1]), x2 = Math.min(right, intersections[i]);
        if (x2 > x1) candidates.push({ x: (x1 + x2) / 2, y, span: x2 - x1 });
      }
    }
  }
  const center = { x: size.x / 2, y: size.y / 2 };
  return candidates.sort((a, b) => Math.min(b.span, labelWidth) - Math.min(a.span, labelWidth) || distance(a, center) - distance(b, center)).slice(0, 32);
}
