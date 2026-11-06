"""Prepare published OKN population on its own 2023 neighbourhood boundaries.

No statistical interpolation or aggregation is performed. Run with Shapely and
pyproj available to audit municipal membership; original source geometry stays
unchanged in the output.
"""
import hashlib
import json
from pathlib import Path

from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parent
GEOMETRY_URL = "https://services5.arcgis.com/f65GOlAcHzjG3q3P/ArcGIS/rest/services/Halton_20230822/FeatureServer/18"
POPULATION_URL = "https://maps.healthlandscape.org/hlcdp_api/restore.aspx?metadataID=77416F9F09"
RACIALIZED_URL = "https://maps.healthlandscape.org/hlcdp_api/restore.aspx?metadataID=7573BC59E8"


def load(name):
    return json.loads((ROOT / name).read_text())


def write(name, data):
    (ROOT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def data_rows(name):
    result = load(name)[0]
    assert result["geoKey"] == "HaltonID2"
    headers = result["columns"]["columns_header"]
    return {
        str(row["0"]): {headers[int(k)]: v for k, v in row.items()}
        for row in json.loads(result["data"])
        if row["0"] != ""
    }


pop = data_rows("77416F9F09.json")
racialized = data_rows("7573BC59E8.json")
boundaries = load("layer-18.geojson")["features"]
municipalities = load("layer-12.geojson")["features"]
codes = {"Oakville": "3524001", "Burlington": "3524002", "Milton": "3524009", "Halton Hills": "3524015"}
municipal_names = {code: name for name, code in codes.items()}
project = Transformer.from_crs(4326, 26917, always_xy=True).transform
municipal_shapes = [(m["properties"]["NAME"], make_valid(transform(project, shape(m["geometry"])))) for m in municipalities]
features, records, municipal_audit = [], {}, []
excluded = []
for f in boundaries:
    source_id = f["properties"]["HaltonID"]
    if source_id not in pop:
        excluded.append({"id": source_id, "name": f["properties"]["NbrhdTxt"], "reason": "No published neighbourhood population profile; Bronte Park is separate cartographic polygon."})
        continue
    row = pop[source_id]
    assert row["Neighbourhood"] == f["properties"]["NbrhdTxt"]
    geom = make_valid(transform(project, shape(f["geometry"])))
    overlaps = [(name, geom.intersection(m).area / geom.area) for name, m in municipal_shapes]
    overlaps = sorted(overlaps, key=lambda item: -item[1])
    municipal_codes = [codes[name] for name, fraction in overlaps if fraction > .001]
    # Rural North Halton spans two municipalities. North Oakville has a smaller
    # overlap with Milton in the public layer; retain it without clipping.
    primary_code = None if source_id == "19" else codes[overlaps[0][0]]
    code = "okn-2023-" + source_id
    anchor = make_valid(shape(f["geometry"])).representative_point()
    props = {
        "code": code, "name": row["Neighbourhood"], "municipalityCode": primary_code,
        "municipality": municipal_names.get(primary_code, "Cross-municipal"),
        "municipalityCodes": municipal_codes, "regionCode": "3524",
        "income": None, "totalPopulation": row["Total Population (2021)"],
        "population": None, "sourceUrl": "https://okndataportal.ca/",
        "statisticsMethod": "Our Kids Network published 2021 Census population on 2023 OKN neighbourhoods",
        "censusYear": 2021, "boundaryYear": 2023, "sourceGeographyId": source_id,
        "sourcePublisher": "Our Kids Network", "statisticsDownloadUrl": POPULATION_URL,
        "publisher": "Our Kids Network", "typeLabel": "区域统计社区",
        "centroid": [anchor.x, anchor.y], "anchorMethod": "interior_representative_point",
        "caveat": "Our Kids Network 发布的 2021 年普查总人口，适用于高亮的 2023 年 OKN 统计社区，不能作为相交市政规划社区的整体人口；本表未提供住户收入中位数或 13 类人口构成人数。",
        "caveatEn": "Our Kids Network published 2021 Census population for the highlighted 2023 OKN statistical neighbourhood. It is not the population of an intersecting municipal planning community. This table does not provide median household income or counts for the 13 population groups.",
        "racializedPopulationPercent": float(racialized[source_id]["Racialized Population (%) - 2021"]),
        "populationNote": row["Note"],
    }
    features.append({"type": "Feature", "properties": props, "geometry": f["geometry"]})
    records[code] = {
        "population": None, "counts13": None, "income": None,
        "totalPopulation": props["totalPopulation"],
        "racializedPopulationPercent": props["racializedPopulationPercent"],
        "sourceUrl": "https://okndataportal.ca/", "populationSourceUrl": POPULATION_URL,
        "racializedPercentSourceUrl": RACIALIZED_URL,
    }
    municipal_audit.append({"code": code, "sourceName": row["Neighbourhood"], "municipalAreaFractions": dict(overlaps), "sourceGeometryValid": shape(f["geometry"]).is_valid})

assert len(features) == len(records) == len(pop) == 30
assert len({f["properties"]["code"] for f in features}) == 30
write("supplemental-areas.geojson", {"type": "FeatureCollection", "features": features})
write("supplemental-data.json", {"schemaVersion": 1, "records": records})
write("municipality-intersections.json", municipal_audit)
write("supplemental-manifest.json", {
    "schemaVersion": 1, "retrievedAt": "2026-11-06", "publisher": "Our Kids Network",
    "provider": "HealthLandscape", "regionCode": "3524", "featureCount": 30,
    "geometrySourceUrl": GEOMETRY_URL, "populationSourceUrl": POPULATION_URL,
    "racializedPercentSourceUrl": RACIALIZED_URL,
    "boundaryDescriptionUrl": "https://ourkidsnetwork.ca/wp-content/uploads/2024/01/About-OKN-Neighbourhoods-Halton-Municipalities-Census.pdf",
    "portalDocumentationUrl": "https://ourkidsnetwork.ca/data-portal-2-0/",
    "license": "No separate licence stated in public ArcGIS metadata; OKN portal disclaimer provides data AS IS for community-status information. Census facts credited to Statistics Canada; compiled data and boundaries credited to Our Kids Network.",
    "licenseUrl": "https://ourkidsnetwork.ca/data-portal-2-0/",
    "fields": {
        "sourceGeometryId": "HaltonID", "sourceName": "NbrhdTxt",
        "populationTableJoin": "API geoKey HaltonID2; column 0 HaltonID",
        "totalPopulation": "77416F9F09, column 6: Total Population (2021)",
        "racializedPopulationPercent": "7573BC59E8, column 3: Racialized Population (%) - 2021",
        "income": "Not published in this dataset; null",
        "population": "Visible-minority private-household sample denominator not published; null",
        "counts13": "13 categories not published; null. No back-calculation from rounded percentage."
    },
    "exclusions": excluded,
    "limitations": [
        "Independent OKN statistical geography, not interchangeable with municipal planning communities.",
        "30 neighbourhood population values total 596490, versus published regional benchmark 596635. Preserve published values; do not force balance.",
        "Rural North Halton crosses Milton and Halton Hills; municipalityCode null with both municipalityCodes.",
        "North Oakville source polygon overlaps Milton by approximately 1%; original published geometry is retained.",
        "Only aggregate racialized share is published; it does not provide the 13 groups or the sample-population denominator.",
        "The public portal's demographics and the official data dictionary have no household-income median indicator. Low-income measures and government-transfer shares are distinct metrics."
    ],
    "rawSnapshots": {
        filename: {"sha256": hashlib.sha256((ROOT / filename).read_bytes()).hexdigest(), "bytes": (ROOT / filename).stat().st_size}
        for filename in ["halton-2023-item.json", "halton-2023-service.json", "layer-18.json", "layer-18.geojson", "layer-12.json", "layer-12.geojson", "77416F9F09.json", "7573BC59E8.json", "portal-data-config-excerpt.txt", "portal-bundle-hash.json", "portal-geography-config.json", "municipal-community-geometry-comparison.json"]
    },
    "municipalGeometryComparison": {
        "directPopulationMatches": 0,
        "path": "municipal-community-geometry-comparison.json",
        "nearestMatch": "Milton Beaty vs OKN Lower East Milton; IoU 0.9930444345053591; symmetric difference 21976.509208079307 m2; Hausdorff 10.220200710995512 m; not treated as numerical precision match."
    }
})
print("Validated 30 OKN neighbourhoods with exact HaltonID and name joins.")
