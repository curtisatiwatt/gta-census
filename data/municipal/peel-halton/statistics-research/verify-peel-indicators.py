"""Reproduce rejected Peel indicators for audit only; never publish these averages.

Uses pinned official CT/HDZ values and the preserved geometric CT-to-HDZ assignment.
No network, dependencies, or output mutation.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read(name):
    return json.loads((HERE / name).read_text())


tracts = {f["properties"]["CTUID"]: f["properties"] for f in read("brampton-census-tracts-income.geojson")["features"]}
zones = {f["properties"]["PHDZ"]: f["properties"] for f in read("peel-hdz-all.geojson")["features"]}
comparisons = read("peel-hdz-income-household-weight-diagnostic.json")["results"]
comparisons = [r for r in comparisons if r["weightField"] == "TOTAL_PRIV_HH_2020_100"]
assert len(comparisons) == 17
for row in comparisons:
    parts = [tracts[code] for code in row["tractIds"]]
    weighted_mean = sum(p["TOTAL_MED_HH_INC_2020"] * p["TOTAL_PRIV_HH_2020_100"] for p in parts) / sum(p["TOTAL_PRIV_HH_2020_100"] for p in parts)
    published = zones[row["zone"]]["Income_MedHH"]
    assert round(weighted_mean) == published
    assert abs(weighted_mean - row["diagnosticWeightedMeanOfTractMedians"]) < 1e-6

fields = ["VM_SouthAsian", "VM_Chinese", "VM_Black", "VM_Filipino", "VM_Arab", "VM_LatinAmerican", "VM_SoutheastAsian", "VM_WestAsian", "VM_Korean_1", "VM_Japanese_1", "VM_Other", "VM_Multiple", "VM_No"]
differences = [sum(z[f] for f in fields) - z["VM_Total"] for z in zones.values()]
assert len(differences) == 40 and min(differences) == 240 and max(differences) == 3140
print("Reproduced 17/17 household-weighted means of CT medians; these are not zone medians.")
print("Confirmed 40/40 published VM denominators disagree with category totals by 240–3140.")
