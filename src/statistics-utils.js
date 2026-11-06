import { isNumber } from './map-utils.js';

/** Related areas retain their own complete boundaries and published values. */
export function relatedStatistics(code, relationships, byCode) {
  return (relationships[code] || []).flatMap(relation => {
    const feature = byCode.get(relation.code);
    return feature ? [{ ...relation, feature }] : [];
  });
}

export function statisticPopulation(properties) {
  return isNumber(properties.totalPopulation) ? properties.totalPopulation : properties.population;
}

export function statisticAvailable(feature, records, groupId = null) {
  if (!feature) return false;
  if (!groupId) return isNumber(feature.properties.income);
  const record = records[feature.properties.code];
  return record?.population > 0 && isNumber(record.counts?.[groupId]);
}
