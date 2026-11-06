"""Verify/recreate separately labelled official Mississauga 2021 sample population.

The AG field is a 25% sample tabulation; it does not replace VM's denominator.
Default does not modify the selected file. --output writes a separate artifact.
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read(path):
    return json.loads(path.read_text())


def build():
    geometry = read(HERE.parent / "mississauga-neighbourhoods-2021.geojson")
    names = {f["properties"]["Geog"]: str(f["properties"]["OBJECTID"]) for f in geometry["features"]}
    rows = [f["attributes"] for f in read(HERE / "mississauga-census-esri-neighbourhoods.json")["features"]]
    records = {}
    for row in rows:
        if row["Geog"] not in names:
            continue
        records[names[row["Geog"]]] = {
            "sourceName": row["Geog"], "populationEstimate": row["AG"], "populationEstimateYear": 2021,
            "populationEstimateDefinition": "Total - Age groups of the population - 25% sample data",
            "sourceMethod": "Official City of Mississauga custom 2021 Census neighbourhood tabulation; AG is also displayed as Census Population by the city's official 2021 Population dashboard. Does not replace the separately defined visible-minority denominator.",
            "childrenCountSample": row["AG_0_14"], "income": None,
            "sourceUrl": "https://www.arcgis.com/apps/dashboards/791f128b7aa54f6fb9c02e6710d95af7",
        }
    assert len(records) == 56
    return {"records": records, "join": "Exact Geog name -> existing geometry OBJECTID, excludes All Neighbourhoods aggregate", "count": len(records)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = build()
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    else:
        assert result == read(HERE / "mississauga-population-selected.json")
    print("Verified 56 municipal AG sample-population records and original IDs.")
