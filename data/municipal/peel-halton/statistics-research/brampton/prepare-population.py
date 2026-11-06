"""Regenerate 53 municipal-published 2022 population estimates from pinned raw data.

Default: verify the committed selected file without modifying it.
Use --output PATH to produce a separate regenerated file.
"""
import argparse
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read(path):
    return json.loads(path.read_text())


def build():
    config = read(HERE / "population-estimates-metadata.json")
    current = read(HERE.parent.parent / "brampton-neighbourhoods.geojson")["features"]
    raw = read(HERE / config["rawSnapshot"])["features"]
    name_field = config["joinNameField"]
    source = {f["properties"][name_field]: f["properties"] for f in raw}
    assert len(source) == len(raw) == len(current) == 53
    result = dict(config["metadata"])
    result["records"] = {}
    for feature in current:
        p = feature["properties"]
        match = source[p[name_field]]
        record = dict(config["recordDefaults"])
        record.update(name=p[name_field], populationEstimate=match[config["populationField"]], sourceRecordId=match["OBJECTID"])
        result["records"][str(p["OBJECTID"])] = record
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, help="Write a regenerated file; default only verifies the selected file")
    args = parser.parse_args()
    result = build()
    if args.output:
        args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    else:
        assert result == read(HERE / "population-estimates-selected.json"), "Selected data differ from pinned source and regeneration metadata"
    print("Verified 53 exact name/ID joins, 2022 population values, sourcePath and display caveats.")
