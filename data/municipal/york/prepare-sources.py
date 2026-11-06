"""Document the official York neighbourhood snapshots without reallocating statistics.

Run with Python + shapely; output keeps all official EDI boundaries intact. Municipal
membership is only a UI/filter aid, not a statistical reaggregation or a boundary edit.
"""
import gzip
import hashlib
import json
from pathlib import Path
from shapely.geometry import shape
from shapely.ops import unary_union

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
read = lambda name: json.loads((HERE / name).read_text())
write = lambda name, value: (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
assignments = [
    ('3519036', 'Markham', 'AI AK AT AU AV AW AX AY AZ BA BB CD CE CF'),
    ('3519038', 'Richmond Hill', 'BP BQ BR BS BT BU BV BW CC'),
    ('3519028', 'Vaughan', 'AA AJ AQ AR AS BZ CG CH CI CJ CK CL'),
    ('3519046', 'Aurora', 'AB AC AD AE AF AG'),
    ('3519048', 'Newmarket', 'AL BD BE BF BG BH BI BJ BK'),
    ('3519044', 'Whitchurch-Stouffville', 'AH CA'),
    ('3519049', 'King', 'AP BL BY'),
    ('3519054', 'East Gwillimbury', 'BC BN'),
    ('3519070', 'Georgina', 'AM AN AO BM BO BX CB'),
]
primary = {code: (municipality_code, name) for municipality_code, name, codes in assignments for code in codes.split()}
municipalities = json.loads(gzip.decompress((ROOT / 'data/census/geometry/municipalities-raw.geojson.gz').read_bytes()))['features']
municipalities = [(f['properties']['CSDUID'], f['properties']['CSDNAME'], shape(f['geometry'])) for f in municipalities if f['properties']['CSDUID'].startswith('3519')]
raw = read('york-edi-demographics.geojson')
features = []
overlap_audit = []
for f in raw['features']:
    p = f['properties']; code = p['NBHDCODE']; municipality_code, municipality = primary[code]
    g = shape(f['geometry'])
    overlaps = sorted([{'municipalityCode': c, 'municipality': n, 'areaFraction': round(g.intersection(h).area / g.area, 8)} for c,n,h in municipalities if g.intersects(h)], key=lambda r:-r['areaFraction'])
    membership = [municipality_code] + [r['municipalityCode'] for r in overlaps if r['areaFraction'] >= .01 and r['municipalityCode'] != municipality_code]
    features.append({'type': 'Feature', 'id': code, 'properties': {
        'NBHDCODE': code, 'NBHDNAME': p['NBHDNAME'], 'Total_Pop': p['Total_Pop'],
        'municipalityCode': municipality_code, 'municipality': municipality,
        'municipalityCodes': membership, 'crossMunicipality': len(membership)>1,
        'geographyType': 'neighbourhood', 'geographyLabel': 'York Region EDI neighbourhood',
    }, 'geometry': f['geometry']})
    overlap_audit.append({'code':code, 'name':p['NBHDNAME'], 'primaryMunicipalityCode':municipality_code, 'overlaps':overlaps})
assert len(primary) == len(features) == 64
(HERE / 'york-neighbourhoods.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':'))+'\n')
source = {
    'id':'york-edi-2021',
    'title':'Early Development Instrument (EDI) Neighbourhoods and Demographics (2021 Census)',
    'path':'data/municipal/york/york-neighbourhoods.geojson',
    'rawPath':'data/municipal/york/york-edi-demographics.geojson',
    'nameField':'NBHDNAME','idField':'NBHDCODE','geographyType':'neighbourhood',
    'geographyLabel':'York Region EDI neighbourhood',
    'publisher':'The Regional Municipality of York',
    'sourceUrl':'https://www.arcgis.com/home/item.html?id=1ee128ff00154af5876b241e5abae15c',
    'boundarySourceUrl':'https://www.arcgis.com/home/item.html?id=424f0630283a452db5ac90db5d784422',
    'downloadUrl':'https://services1.arcgis.com/GzvOwaQBbX7KLiuG/arcgis/rest/services/EDI_Demo_Dan/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson',
    'license':'York Region Open Data Licence 1.0',
    'licenseUrl':'https://www.arcgis.com/sharing/rest/content/items/78cc02388af248c0b7a30eda6adfade0/data',
    'attribution':"Contains public sector information made available under The Regional Municipality of York's Open Data Licence",
    'retrievedDate':'2026-11-06','statisticalReferenceYear':2021,
    'totalPopulationField':'Total_Pop',
    'statistics':{'totalPopulation':{'field':'Total_Pop','definition':'Total population including institutional residents','year':2021},'income':None,'populationGroups':None,'children':None,'householdSize':None},
    'statisticsLimitations':'Med_Income is economic-family income, not household income; visible-minority fields refer only to children aged 0–5, not all residents. These incompatible fields must not be used for the app household-income or population-composition charts. Total_Pop applies only to the entire unchanged EDI polygon.',
    'boundaryNote':'Official regional social-planning neighbourhoods, developed with community consultation and based on whole dissemination areas. Names are preserved verbatim; some official names are broad (e.g. Richmond Hill B/C). EDI boundaries cross municipal limits. Keep whole polygons for their total population; if clipping to a city, discard full-area statistics.',
    'membershipNote':'municipalityCode is a primary community/name-based UI assignment audited against CSD boundaries. municipalityCodes adds municipalities sharing at least 1% of the EDI area. This field does not modify geometry or assert EDI follows municipal borders.',
}
entries=[]
for code,name,codes in assignments:
    entries.append({**source,'municipalityCode':code,'municipalityName':name,'filterField':'NBHDCODE','filterValues':codes.split(),'partialCoverage':True,'coverageNote':'Primary neighbourhood assignment. Several EDI polygons extend across city boundaries; use all-region source with municipalityCodes membership when displaying city scopes.'})
write('sources.json',{'schemaVersion':1,'sharedSource':source,'municipalities':entries,'research':[
 {'municipality':'Markham','officialSources':['https://data-markham.opendata.arcgis.com/','https://www.arcgis.com/home/item.html?id=69a4a292d99b4cf082d9f4b992b36369','https://www.markham.ca/sites/default/files/MAP%2015%20Area%20and%20Site%20Specific%20Policies.pdf'],'finding':'Secondary Plans exposes 58 polygons with named SEC_PLAN_1 and statutory/non-statutory status, but is not a complete single neighbourhood partition; preserved as a candidate, EDI used for continuous named neighbourhood coverage.'},
 {'municipality':'Richmond Hill','officialSources':['https://www.richmondhill.ca/en/learn-more/official-plan-update.aspx','https://www.richmondhill.ca/en/resources/Development-Planning/2025-01-20-ZoneRH-Richmond-Hill-Neighbourhood-Areas.pdf','https://www.arcgis.com/sharing/rest/search?q=owner%3ATRHAdmin&f=json'],'finding':'City neighbourhood land-use designation maps do not provide a complete downloadable partition into named communities. Ward boundaries are election districts and were rejected. Use official regional EDI neighbourhoods, preserving their actual names.'},
 {'municipality':'Vaughan','officialSources':['https://www.vaughan.ca/explore-vaughan/communities','https://www.arcgis.com/home/item.html?id=62c4688d7d3849a98eed15d681a85e83'],'finding':'City recognizes Concord, Kleinburg, Maple, Thornhill and Woodbridge. Public Planning Blocks have numeric BLOCK_NUMB rather than named neighbourhoods, and ratepayer association areas are not an exhaustive planning partition. Use regional EDI polygons.'},
 {'municipality':'Aurora','officialSources':['https://www.arcgis.com/home/item.html?id=8b4521fddcab408e8401e702101af4c8','https://www.arcgis.com/sharing/rest/search?q=owner%3ATownOfAurora&f=json'],'finding':'Secondary plan source is a partial downtown/promenade designation scheme, not a citywide named neighbourhood partition. Use regional EDI polygons.'},
 {'municipality':'Newmarket','officialSources':['https://www.arcgis.com/home/item.html?id=0c9b8c7f02c3410a810d715d44d1acc1','https://services3.arcgis.com/tSwsWwbYRimLwcCZ/arcgis/rest/services/Official_Plan/FeatureServer/191'],'finding':'Official Plan residential character polygons group types such as Traditional Suburban Character Area, not neighbourhood names. Regional EDI provides College Manor, Armitage, Stonehaven, Glenway, Quaker Hill/Haskett Park etc.'},
 {'municipality':'Whitchurch-Stouffville','officialSources':['https://www.arcgis.com/sharing/rest/search?q=owner%3Atownofws-gis&f=json','https://www.arcgis.com/home/item.html?id=57de1bac6ffd4a80a50730b424d57e38'],'finding':'Public municipality layers inspected were municipal boundary, parks, heritage and tourism, without a citywide named neighbourhood partition; use regional EDI.'},
 {'municipality':'King','officialSources':['https://www.king.ca/development-growth/planning-land-use/official-plan','https://www.king.ca/maps'],'finding':'Official village/hamlet secondary plans exist (King City, Nobleton, Schomberg, Kettleby, Laskay, Pottageville, Snowball), but are partial settlement schedules, not a complete downloadable neighbourhood partition. Use regional EDI and retain cross-municipality membership.'},
 {'municipality':'East Gwillimbury','officialSources':['https://www.eastgwillimbury.ca/en/government/official-plan-review.aspx','https://www.arcgis.com/sharing/rest/search?q=owner%3AEastGwillimbury&f=json'],'finding':'Official plan review and town structure maps include community/settlement land use. July 2026 adopted plan was pending provincial approval on retrieval date; no complete named-neighbourhood polygon service found. Use regional EDI.'},
 {'municipality':'Georgina','officialSources':['https://www.georgina.ca/living-here/fire-and-rescue-services/community-risk-portal','https://services7.arcgis.com/H9DyU85EnErZGhsY/arcgis/rest/services/CRA_Boundary/FeatureServer/0','https://www.georgina.ca/living-here/planning-and-development/official-plan-and-secondary-plans'],'finding':'City publishes 8 named Community Risk Assessment neighbourhood polygons, an excellent local alternative. Its source item has no licence text and the population reference year is not labelled, so regional open-licensed EDI remains selected; candidate recorded for review.'}
]})
gs=[shape(f['geometry']) for f in features];union=unary_union(gs)
write('audit.json',{'featureCount':len(features),'allGeometriesValid':all(g.is_valid for g in gs),'pairwiseAreaOverlapProportion':(sum(g.area for g in gs)-union.area)/union.area,'totalPopulationSum':sum(f['properties']['Total_Pop'] for f in features),'municipalityOverlapMethod':'Area fractions in longitude/latitude coordinate space are diagnostics only, not population allocations. Full official geometries preserved.','municipalityOverlaps':overlap_audit,'hashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(HERE.glob('*')) if p.suffix in ['.json','.geojson','.pdf'] and p.name!='audit.json'}})
print('Prepared 64 official EDI neighbourhoods, 9 primary municipal groups and explicit multi-city membership.')
