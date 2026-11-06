async function readJson(path) {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${path}`);
  if (!response.ok) throw new Error(`无法载入 ${path}（${response.status}）`);
  return response.json();
}

export async function loadData() {
  const [metadata, communities, populationData, basemap, operatingTransit, greenTransit, geographicContext, orientationLandmarks, transitLines, neighbourhoods, neighbourhoodData] = await Promise.all([
    readJson('metadata.json'),
    readJson('communities.geojson'),
    readJson('population-groups.json'),
    readJson('basemap.geojson').catch(() => null),
    readJson('transit-operating.geojson').catch(() => null),
    readJson('transit-future.geojson').catch(() => null),
    readJson('geographic-context.geojson').catch(() => null),
    readJson('orientation-landmarks.geojson').catch(() => null),
    readJson('transit-lines.json').catch(() => []),
    readJson('neighbourhoods.geojson'),
    readJson('neighbourhood-data.json'),
  ]);
  if (communities.type !== 'FeatureCollection' || !communities.features?.length) {
    throw new Error('社区边界数据格式不完整');
  }
  if (populationData.schemaVersion !== 1 || !populationData.groups?.length || !populationData.communities) {
    throw new Error('社区人口分类数据格式不完整');
  }
  const prepare = collection => collection.features.map(feature => {
    const p = feature.properties;
    if (!p.name || p.code === undefined || !Array.isArray(p.centroid)) {
      throw new Error('社区身份或显示坐标缺失');
    }
    return { ...feature, properties: { ...p, code: String(p.code) } };
  });
  if (neighbourhoods.type !== 'FeatureCollection' || !neighbourhoods.features?.length || neighbourhoodData.schemaVersion !== 1) {
    throw new Error('市政社区资料格式不完整');
  }
  const geographies = {
    neighbourhoods: { features: prepare(neighbourhoods), records: neighbourhoodData.communities },
    census: { features: prepare(communities), records: populationData.communities },
  };
  const combinedMetadata = {
    ...metadata, ...neighbourhoodData.metadata,
    english: { ...metadata.english, ...neighbourhoodData.metadata.english },
    sources: [...neighbourhoodData.metadata.sources, ...metadata.sources],
  };
  return { metadata: combinedMetadata, geographies, populationData, basemap, operatingTransit, greenTransit, geographicContext, orientationLandmarks, transitLines };
}
