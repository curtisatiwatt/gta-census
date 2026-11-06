const boundaryMode = mode => mode === 'census' ? 'census' : 'neighbourhoods';

/** Read both original city links and links that preserve the selected boundaries. */
export function parseScopeHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#scope=')) return null;
  try {
    const params = new Map();
    for (const pair of hash.slice(1).split('&')) {
      const separator = pair.indexOf('=');
      const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
      const key = decode(separator < 0 ? pair : pair.slice(0, separator));
      const value = decode(separator < 0 ? '' : pair.slice(separator + 1));
      if (params.has(key)) return null;
      params.set(key, value);
    }
    const scopeId = params.get('scope');
    if (!scopeId?.trim()) return null;
    return { scopeId, mode: boundaryMode(params.get('boundary')) };
  } catch {
    // decodeURIComponent rejects malformed escapes and invalid UTF-8.
    return null;
  }
}

export function scopeHash(id, mode) {
  const scopeId = String(id ?? '');
  if (!scopeId.trim()) throw new TypeError('Scope ID is required');
  return `#scope=${encodeURIComponent(scopeId)}&boundary=${boundaryMode(mode)}`;
}

/** A published zero is data; absent, suppressed and invalid values are not. */
export function hasPopulationRecord(record) {
  if (typeof record?.population !== 'number' || !Number.isFinite(record.population) || record.population <= 0) return false;
  if (!record.counts || typeof record.counts !== 'object' || Array.isArray(record.counts)) return false;
  return Object.values(record.counts).some(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
}
