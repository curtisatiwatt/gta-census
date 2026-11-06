"""Retrieve selected municipal community boundaries, without inventing statistics."""
import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEST = Path(__file__).resolve().parent
RETRIEVED = '2026-11-06'
SOURCES = [
    dict(municipalityCode='3521005', municipality='Mississauga', filename='mississauga-neighbourhoods-2021.geojson',
         nameField='Geog', idField='OBJECTID', geographyType='neighbourhood', publisher='City of Mississauga',
         sourceUrl='https://www.arcgis.com/home/item.html?id=f189743f279b4d06945689dce525b746',
         downloadUrl='https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/2021_Census_Mapping_City_Ward_MTSA_Neighbourhood/FeatureServer/0',
         where="GeogCat = 'Neighbourhood'", fields='OBJECTID,GeogCat,Geog',
         license='Statistics Canada Open Licence; City of Mississauga open data terms',
         licenseUrl='https://www.statcan.gc.ca/en/reference/licence', partialCoverage=False,
         profilesPath='data/municipal/peel-halton/profiles-selected.json',
         profileJoin='records keyed by source geometry OBJECTID; source CSV joined exactly on Geog and filtered GEN=All',
         boundaryReference='Municipal neighbourhood geography used for the City\'s custom 2021 Census profiles; not the 2026 Official Plan 2051 map.',
         statistics='Official custom 2021 Census neighbourhood tabulation. Match Geog; GEN=All. Household income is unavailable in the selected table.'),
    dict(municipalityCode='3521010', municipality='Brampton', filename='brampton-neighbourhoods.geojson',
         nameField='NEIGHBOURHOOD_NAME', idField='OBJECTID', geographyType='neighbourhood', publisher='City of Brampton',
         sourceUrl='https://geohub.brampton.ca/maps/nnp-neighbourhood-boundary-areas',
         itemId='404d43d1f5be4e23a3ee421132539379',
         downloadUrl='https://services3.arcgis.com/rl7ACuZkiFsmDA2g/arcgis/rest/services/NNP_Neighbourhood_Layers_OpenData/FeatureServer/2',
         fields='OBJECTID,NEIGHBOURHOOD_NAME', license='CC BY', licenseUrl='https://www.arcgis.com/home/item.html?id=404d43d1f5be4e23a3ee421132539379', partialCoverage=True,
         boundaryReference='Nurturing Neighbourhoods Program boundaries; major roads, natural features and historic settlement areas.',
         statistics='No matching neighbourhood Census profile found. City Census dashboards publish census tracts; Peel Health Data Zones are a different geography.'),
    dict(municipalityCode='3521024', municipality='Caledon', filename='caledon-settlements.geojson',
         nameField='NAME', idField='SettlementCode', geographyType='planning_area', publisher='Town of Caledon',
         sourceUrl='https://www.arcgis.com/home/item.html?id=191ce073f90040628dec42b292664a30',
         itemId='191ce073f90040628dec42b292664a30',
         downloadUrl='https://services3.arcgis.com/AbUjpCl3KckkXVBh/ArcGIS/rest/services/Zone_Map_Index_Layers/FeatureServer/3',
         fields='OBJECTID,NAME,STRUCTURE,SettlementCode', license='No separate licence statement in the public municipal layer metadata; credited to Town of Caledon',
         licenseUrl='https://www.arcgis.com/home/item.html?id=191ce073f90040628dec42b292664a30', partialCoverage=True,
         boundaryReference='Current Official Plan Settlement Area Boundary, as named by the municipal map service; only settlement extents, not surrounding rural land.',
         statistics='No matching settlement-level 2021 income and population-group profile found.'),
    dict(municipalityCode='3524001', municipality='Oakville', filename='oakville-planning-communities.geojson',
         nameField='COMMUNITY', idField='GISID', geographyType='planning_area', publisher='Town of Oakville',
         sourceUrl='https://maps.oakville.ca/oakgis/rest/services/PGISREF_BULK/Admin_OP_Community_Boundary/FeatureServer/5',
         downloadUrl='https://maps.oakville.ca/oakgis/rest/services/PGISREF_BULK/Admin_OP_Community_Boundary/FeatureServer/5',
         fields='OBJECTID,COMMUNITY,PLANNING_COMMUNITY,GISID', license='Open Government Licence - Town of Oakville',
         licenseUrl='https://www.oakville.ca/town-hall/plans-strategies/open-data/open-data-licence/', partialCoverage=True,
         attribution='Contains information licensed under the Open Government Licence – Town of Oakville.',
         boundaryReference='Municipal Admin_OP_Community_Boundary layer, including residential and industrial planning communities.',
         statistics='No matching planning-community 2021 income and population-group profile found. Town demographic dashboard uses census areas.'),
    dict(municipalityCode='3524002', municipality='Burlington', filename='burlington-planning-communities.geojson',
         nameField='PLANNING_COMMUNITY', idField='OBJECTID', geographyType='planning_area', publisher='City of Burlington',
         sourceUrl='https://www.arcgis.com/home/item.html?id=1afaa4cd5c1148f89480817fce4c0469',
         itemId='1afaa4cd5c1148f89480817fce4c0469',
         downloadUrl='https://mapping.burlington.ca/arcgisweb/rest/services/COB/PlanningCommunities/MapServer/1',
         fields='OBJECTID,PLANNING_COMMUNITY', license='City of Burlington Open Data Terms of Use',
         licenseUrl='https://opendata.burlington.ca/opendata-terms-of-use/City%20of%20Burlington%20-%20Open%20Data%20Terms%20of%20Use.pdf', partialCoverage=False,
         boundaryReference='Official Planning Communities, including Rural and Employment. Preferred to the unrelated 2020 holiday-route neighbourhood layer.',
         statistics='No matching planning-community 2021 income and population-group profile found.'),
    dict(municipalityCode='3524009', municipality='Milton', filename='milton-neighbourhoods.geojson',
         nameField='NAME', idField='OBJECTID', geographyType='neighbourhood', publisher='Town of Milton',
         sourceUrl='https://www.arcgis.com/home/item.html?id=6c26ff98c86c48e38a01860c264b4eab',
         itemId='6c26ff98c86c48e38a01860c264b4eab',
         downloadUrl='https://api.milton.ca/arcgis/rest/services/Datasets/Neighbourhoods/MapServer/0',
         fields='OBJECTID,NAME', license='Town of Milton disclaimer and terms of use',
         licenseUrl='https://discover-milton.hub.arcgis.com/pages/disclaimer-and-terms-of-use', partialCoverage=False,
         boundaryReference='Town Neighbourhoods dataset, described as updated on a daily schedule; includes rural and industrial named areas.',
         statistics='No matching neighbourhood 2021 income and population-group profile found. Census Information Hub uses dissemination areas.'),
    dict(municipalityCode='3524015', municipality='Halton Hills', filename='halton-hills-settlements.geojson',
         nameField='AreaName', idField='OBJECTID', geographyType='planning_area', publisher='Town of Halton Hills',
         sourceUrl='https://www.haltonhills.ca/Live/Maps',
         downloadUrl='https://map.haltonhills.ca/awse/rest/services/eP/MapServer/9',
         fields='OBJECTID,AreaName,AreaType', license='Town of Halton Hills website: content may be shared or reproduced with proper attribution',
         licenseUrl='https://www.haltonhills.ca/Live/Maps', partialCoverage=True,
         boundaryReference='Public MapLinks Urban, Hamlet, Rural Area layer; includes Acton, Georgetown, Glen Williams, Norval and rural clusters. Rural land outside settlements is not assigned a fabricated neighbourhood.',
         statistics='No matching settlement-level 2021 income and population-group profile found.'),
]

def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()

def main():
    for source in SOURCES:
        params = dict(where=source.get('where', '1=1'), outFields=source['fields'], outSR=4326,
                      returnGeometry='true', f='geojson', resultRecordCount=2000)
        url = source['downloadUrl'] + '/query?' + urllib.parse.urlencode(params)
        raw = get(url)
        collection = json.loads(raw)
        assert collection['type'] == 'FeatureCollection' and collection['features'], source['municipality']
        assert not collection.get('exceededTransferLimit'), source['municipality']
        assert len({f['properties'][source['idField']] for f in collection['features']}) == len(collection['features'])
        path = DEST / source.pop('filename')
        path.write_bytes(raw)
        source.update(path=str(path.relative_to(ROOT)), retrieved=RETRIEVED,
                      featureCount=len(collection['features']), sha256=hashlib.sha256(raw).hexdigest(), requestUrl=url)
        meta = json.loads(get(source['downloadUrl'] + '?f=json'))
        (DEST / (path.stem + '-layer.json')).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + '\n')
        if source.get('itemId'):
            item = json.loads(get('https://www.arcgis.com/sharing/rest/content/items/' + source['itemId'] + '?f=json'))
            (DEST / (path.stem + '-item.json')).write_text(json.dumps(item, ensure_ascii=False, indent=2) + '\n')
        print(source['municipality'], source['featureCount'], path.name)
    (DEST / 'sources.json').write_text(json.dumps({'retrieved': RETRIEVED, 'municipalities': SOURCES}, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
