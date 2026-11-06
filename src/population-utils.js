/** Mutually classified categories in Calgary's 2021 community profile table. */
export const POPULATION_GROUP_IDS = Object.freeze([
  'south_asian', 'chinese', 'black', 'filipino', 'arab', 'latin_american',
  'southeast_asian', 'west_asian', 'korean', 'japanese',
  'visible_minority_nie', 'multiple_visible_minorities', 'not_visible_minority',
]);

// A single, absolute scale shared by every community and comparison panel.
export const POPULATION_BINS = Object.freeze([
  { min: 0, max: 0.05, color: '#edf8f5', label: '0–<5%' },
  { min: 0.05, max: 0.1, color: '#c4e5dc', label: '5–<10%' },
  { min: 0.1, max: 0.2, color: '#8ccdbd', label: '10–<20%' },
  { min: 0.2, max: 0.3, color: '#4cae98', label: '20–<30%' },
  { min: 0.3, max: 0.4, color: '#21836f', label: '30–<40%' },
  { min: 0.4, max: Infinity, color: '#095746', label: '40% 及以上' },
]);

export const POPULATION_NO_DATA_COLOR = '#d6dcd9';
export const COMPOSITION_OTHER_COLOR = '#d2d8d5';
export const COMPOSITION_GAP_COLOR = '#ffffff';

const validCount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validPopulation = record => typeof record?.population === 'number'
  && Number.isFinite(record.population) && record.population > 0;

/** Exact source count divided by its table denominator, not its rounded printed %. */
export function populationShare(record, id) {
  if (!validPopulation(record) || !POPULATION_GROUP_IDS.includes(id)) return null;
  const count = record.counts?.[id];
  return validCount(count) ? count / record.population : null;
}

/**
 * Published category counts can fall short of or exceed the table population.
 * Under-counts get their own visible gap, preserving the real group shares.
 * Only an over-count is scaled down to fit the ring. Exact statistics remain
 * count / table population via populationShare().
 */
export function compositionSegments(record, selectedIds) {
  if (!validPopulation(record) || !record.counts
      || !POPULATION_GROUP_IDS.every(id => validCount(record.counts[id]))) return [];
  const selected = [...new Set(Array.isArray(selectedIds) ? selectedIds : [])]
    .filter(id => POPULATION_GROUP_IDS.includes(id));
  if (!selected.length) return [];
  const total = POPULATION_GROUP_IDS.reduce((sum, id) => sum + record.counts[id], 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  const denominator = Math.max(record.population, total);
  const selectedSet = new Set(selected);
  const segments = selected.filter(id => record.counts[id] > 0)
    .map(id => ({ id, count: record.counts[id], share: record.counts[id] / denominator }));
  const other = POPULATION_GROUP_IDS.filter(id => !selectedSet.has(id))
    .reduce((sum, id) => sum + record.counts[id], 0);
  if (other > 0) segments.push({ id: 'other', count: other, share: other / denominator });
  if (total < record.population) {
    const gap = record.population - total;
    segments.push({ id: 'statistical_gap', count: gap, share: gap / denominator });
  }
  return segments;
}

export function populationColor(share) {
  return validCount(share)
    ? POPULATION_BINS.find(bin => share < bin.max).color
    : POPULATION_NO_DATA_COLOR;
}

const safeColor = color => typeof color === 'string'
  && /^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(color)
  ? color : '#4c7870';

/** Decorative SVG; its interactive map marker supplies the accessible name. */
export function donutSvg(record, selectedIds, colorById = {}, size = 32) {
  const segments = compositionSegments(record, selectedIds);
  if (!segments.length) return '';
  const dimension = typeof size === 'number' && Number.isFinite(size)
    ? Math.max(14, Math.min(96, size)) : 32;
  // Circumference uses pathLength=100 so percentages are independent of size.
  let offset = 0;
  const circles = segments.map(segment => {
    const length = segment.share * 100;
    const color = segment.id === 'other' ? COMPOSITION_OTHER_COLOR
      : segment.id === 'statistical_gap' ? COMPOSITION_GAP_COLOR : safeColor(colorById[segment.id]);
    let circle = `<circle cx="20" cy="20" r="14" fill="none" stroke="${color}" stroke-width="9" pathLength="100" stroke-dasharray="${length.toFixed(6)} ${(100 - length).toFixed(6)}" stroke-dashoffset="${(-offset).toFixed(6)}" transform="rotate(-90 20 20)"/>`;
    if (segment.id === 'statistical_gap') {
      // An unfilled, dashed arc is distinct from real unselected people (gray).
      const point = value => {
        const angle = value / 100 * 2 * Math.PI - Math.PI / 2;
        return `${(20 + 14 * Math.cos(angle)).toFixed(6)} ${(20 + 14 * Math.sin(angle)).toFixed(6)}`;
      };
      circle += `<path d="M ${point(offset)} A 14 14 0 ${length > 50 ? 1 : 0} 1 ${point(offset + length)}" fill="none" stroke="#a6b4ac" stroke-width="1.4" stroke-dasharray="1.2 2.2"/>`;
    }
    offset += length;
    return circle;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dimension}" height="${dimension}" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="19" fill="#fff" fill-opacity="0.96"/>${circles}<circle cx="20" cy="20" r="9.5" fill="#fff" fill-opacity="0.96"/></svg>`;
}
