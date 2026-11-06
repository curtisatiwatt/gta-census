"""Normalize downloaded official Durham snapshots. No statistical interpolation."""
from pathlib import Path
import json, gzip, hashlib
ROOT = Path(__file__).resolve().parent

def read(name):
    p = ROOT / name
    return json.loads(gzip.decompress(p.read_bytes()) if p.suffix == '.gz' else p.read_text())
def write(name, obj):
    (ROOT / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n')
def sha(name):
    return hashlib.sha256((ROOT / name).read_bytes()).hexdigest()

# Preserve raw supplier NAME; repair only the display name using the same
# feature's PROFILE_2018 text and the Town's Site Plan Review Technical Guidelines.
ajax = read('ajax-communities.geojson')
for f in ajax['features']:
    p=f['properties']; p['displayName']='Pickering Village' if p['OBJECTID']==337 else p['NAME']
write('ajax-neighbourhoods.geojson',ajax)
oshawa = read('oshawa-communities.geojson')
for f in oshawa['features']:
    n=f['properties']['COMMNAME']
    f['properties']['displayName']='McLaughlin' if n=='MCLAUGHLIN' else n.title()
write('oshawa-neighbourhoods.geojson',oshawa)

health = read('durham-health-neighbourhoods.geojson')
profile_geom=read('health-population-2021-geometry.geojson.gz')
base = {f['properties']['MUNICIPAL_ID']:f['geometry'] for f in health['features']}
assert len(base)==50 and len(profile_geom['features'])==50
assert all(f['geometry']==base[f['properties']['MUNICIPAL_ID']] for f in profile_geom['features'])
rawpath=ROOT/'health-profiles-2021-raw.json'
if rawpath.exists():
    (ROOT/'health-profiles-2021-raw.json.gz').write_bytes(gzip.compress(rawpath.read_bytes(),mtime=0))
rows=read('health-profiles-2021-raw.json.gz')['features']
assert len(rows)==1600
statistics={}
for f in rows:
    p=f['attributes']; r=statistics.setdefault(p['MUNICIPAL_ID'], {'populationYear':2021,'sourceUrl':'https://www.durham.ca/health-and-wellness/health-information-services/health-neighbourhoods/','totalPopulation':None,'children':None,'income':None,'householdSize':None,'population':None})
    if p['INDICATOR']=='CENSUS_PopulationDensity':r['totalPopulation']=int(p['NUMERATOR']) if p['NUMERATOR'] is not None else None
    if p['INDICATOR']=='CENSUS_Population0-14':r['children']=p['VALUE']/100 if p['VALUE'] is not None else None
assert len(statistics)==50 and all(r['totalPopulation'] is not None for r in statistics.values())
write('health-statistics-2021.json',{'schemaVersion':1,'censusYear':2021,'sourcePath':'data/municipal/durham/health-profiles-2021-raw.json.gz','records':statistics,'notes':['Income in the Health Neighbourhoods source is after-tax and is deliberately not assigned to the atlas before-tax income metric.','Only the total visible-minority count is published; the 13 category counts and their private-household denominator are not supplied here.','All 50 2021 population profile geometries exactly match the separate official health boundary download.']})
for city in ['Whitby','Clarington','Uxbridge','Scugog','Brock']:
    features=[f for f in health['features'] if f['properties']['MUNICIPALITY']==city]
    assert features,city
    write(city.lower()+'-health-neighbourhoods.geojson',{'type':'FeatureCollection','features':features})
print('Prepared Ajax/Oshawa display names and five regional health-neighbourhood subsets; 50 exact profile-boundary matches.')
