export const INCOME_BINS = [
  { max: 60000, color: '#3979b5', label: '低于 $60,000' },
  { max: 80000, color: '#82b8d6', label: '$60,000–79,999' },
  { max: 100000, color: '#d8e5cb', label: '$80,000–99,999' },
  { max: 125000, color: '#f1d66f', label: '$100,000–124,999' },
  { max: 150000, color: '#efaa5a', label: '$125,000–149,999' },
  { max: 200000, color: '#db714d', label: '$150,000–199,999' },
  { max: Infinity, color: '#b83f42', label: '$200,000 及以上' },
];

export const isNumber = value => typeof value === 'number' && Number.isFinite(value);
export const colorFor = value => isNumber(value)
  ? INCOME_BINS.find(bin => value < bin.max).color
  : '#d6dcd9';
export const number = value => isNumber(value) ? value.toLocaleString('en-CA') : '暂无数据';
export const money = value => isNumber(value) ? `$${number(value)}` : '暂无数据';
export const percent = value => isNumber(value)
  ? `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`
  : '暂无数据';

/** A fixed scale within each mode: circle AREA, not radius, represents the value. */
export function bubbleRadius(value, maximum, mobile = false) {
  if (!isNumber(value) || value <= 0 || !isNumber(maximum) || maximum <= 0) return 0;
  return Math.sqrt(value / maximum) * 24 * (mobile ? 0.7 : 1);
}

export function normalize(value) {
  return String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

export function searchFeatures(features, query) {
  const q = normalize(query);
  if (!q) return [];
  return features.map(feature => {
    const p = feature.properties;
    const name = normalize(p.name);
    const aliases = (p.aliases || []).map(normalize);
    const score = name === q || normalize(p.code) === q ? 0
      : name.startsWith(q) ? 1
      : name.includes(q) ? 2
      : aliases.some(alias => alias.includes(q)) ? 3 : 99;
    return { feature, score };
  }).filter(item => item.score < 99)
    .sort((a, b) => a.score - b.score || a.feature.properties.name.localeCompare(b.feature.properties.name))
    .slice(0, 12)
    .map(item => item.feature);
}

export function summarize(features) {
  const incomes = features.filter(f => isNumber(f.properties.income));
  return {
    total: features.length,
    income: incomes.length,
    chinese: features.filter(f => isNumber(f.properties.chineseCount)).length,
    maxCount: Math.max(1, ...features.map(f => f.properties.chineseCount || 0)),
    maxPercent: Math.max(0.01, ...features.map(f => f.properties.chinesePct || 0)),
  };
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function hashCode(hash, features) {
  try {
    const code = decodeURIComponent(hash.replace(/^#/, ''));
    return features.some(f => String(f.properties.code) === code) ? code : null;
  } catch {
    return null;
  }
}
