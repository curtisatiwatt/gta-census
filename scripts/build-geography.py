#!/usr/bin/env python3
"""Build display geography from official Ontario, Toronto and federal sources.
Requires Python, Shapely and pyshp for maintenance only.
Run with --source-dir PATH --download once, then omit --download to reproduce.
"""
import argparse,collections,concurrent.futures,hashlib,io,json,math,time,urllib.parse,urllib.request,zipfile
from pathlib import Path
from shapely.geometry import shape,mapping,box,Point
from shapely import affinity,make_valid,set_precision
import shapefile
ROOT=Path(__file__).resolve().parents[1]
BBOX=[-80.1,43.25,-78.35,44.6]
LIO='https://ws.lioservices.lrc.gov.on.ca'
SERVICES={
 'airports':(LIO+'/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer/0',"1=1",'OBJECTID,NAME,AIRPORT_IDENT,AIRPORT_TYPE,STATUS'),
 'roads':('https://services1.arcgis.com/TJH5KDher0W13Kgo/arcgis/rest/services/Ontario_Road_Network_Composite_Service_GeoHub_View_EN/FeatureServer/5',"ROAD_CLASS IN ('Freeway','Expressway / Highway','Arterial')",'OBJECTID,FULL_STREET_NAME,ROAD_CLASS,ROUTE_NUMBER,SHIELD_TYPE'),
 'water':(LIO+'/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01/MapServer/25',"(OFFICIAL_NAME_LABEL IS NOT NULL AND OFFICIAL_NAME_LABEL <> '') OR SYSTEM_CALCULATED_AREA >= 100000",'OBJECTID,OFFICIAL_NAME_LABEL,WATERBODY_TYPE,SYSTEM_CALCULATED_AREA'),
 'rails':(LIO+'/arcgis1071a/rest/services/LIO_OPEN_DATA/LIO_Open04/MapServer/18',"1=1",'OBJECTID,TRACKNAME,TRACKCLASS,STATUS,TRANSPTYPE'),
 'protected':('https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CPCAD/MapServer/0','STATUS IN (1,2,4,5)','OBJECTID,NAME_E,TYPE_E,STATUS,PA_OECM_DF'),
 'reserves':('https://proxyinternet.nrcan-rncan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer/0','1=1','OBJECTID,adminAreaNameEng,distributionTypeEng,representationPurposeEng'),
 'names':(LIO+'/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/36',"1=1",'OBJECTID,OFFICIAL_NAME,LABEL,NATIONAL_CONCISE_CODE,ENTITY_TYPE,GEONAME_STATUS,LATITUDE_DECIMAL_DEGREES,LONGITUDE_DECIMAL_DEGREES,LOWER_TIER_MUNICIPALITY,SINGLE_TIER_MUNICIPALITY'),
}
ATTRACTIONS='https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/965247c0-c72e-49b4-bb1a-879cf98e1a32/resource/d3e9668a-1c2b-4250-8aba-32a80bb2266d/download/places-of-interest-and-attractions-4326.geojson'
TORONTO_PARKS='https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/2aac8903-23ff-4072-ab72-b76cac44ad89/resource/9f53c253-a47e-497f-8a07-528f7d7aad90/download/parks-wgs84.zip'
SOURCES={
 'airports':'https://data.ontario.ca/dataset/2582c87b-03b4-406c-af6b-3cfea418dc7b',
 'roads':'https://data.ontario.ca/dataset/f61ce160-e432-4f4d-a06c-508b3da384f9',
 'water':'https://data.ontario.ca/dataset/423655e0-2bb8-4dc2-a1ec-6d7b25915d18',
 'rails':'https://data.ontario.ca/dataset/5ff2a676-d1a4-4aa1-88ce-0a7d7ac28d75',
 'protected':'https://open.canada.ca/data/en/dataset/6c343726-1e92-451a-876a-76e17d398a1c',
 'reserves':'https://open.canada.ca/data/en/dataset/522b07b9-78e2-4819-b736-ad9208eb1067',
 'names':'https://www.ontario.ca/page/geographic-names',
 'toronto-parks':'https://open.toronto.ca/dataset/parks/',
 'attractions':'https://open.toronto.ca/dataset/places-of-interest-and-toronto-attractions/',
}
def request(url):
 for attempt in range(4):
  try:
   with urllib.request.urlopen(url,timeout=120) as r: return r.read()
  except Exception:
   if attempt==3:raise
   time.sleep(1+attempt)
def query(base,parameters):
 data=json.loads(request(base+'/query?'+urllib.parse.urlencode(parameters)))
 if data.get('error'):raise ValueError(data['error'])
 return data
def download(name,folder):
 if (folder/(name+'.geojson')).exists():return name,'cached'
 service,where,fields=SERVICES[name]
 params=dict(f='json',where=where,geometry=','.join(map(str,BBOX)),geometryType='esriGeometryEnvelope',inSR=4326,spatialRel='esriSpatialRelIntersects',returnIdsOnly='true')
 ids=sorted(query(service,params).get('objectIds') or [])
 assert ids, name+' empty'
 batches=[ids[n:n+150] for n in range(0,len(ids),150)]
 def one(item):
  i,batch=item
  path=folder/f'{name}-chunk-{i}.json'
  if path.exists():data=json.loads(path.read_text())
  else:
   params=dict(f='geojson',objectIds=','.join(map(str,batch)),outFields=fields,outSR=4326,returnGeometry='false' if name=='names' else 'true',geometryPrecision=6)
   data=query(service,params);path.write_text(json.dumps(data))
  assert not data.get('exceededTransferLimit'),name
  if (i+1)%10==0 or i+1==len(batches):print(name,i+1,'/',len(batches),flush=True)
  return data['features']
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
  features=[f for chunk in ex.map(one,enumerate(batches)) for f in chunk]
 assert len(features)==len(ids),(name,len(features),len(ids))
 (folder/(name+'.geojson')).write_text(json.dumps(dict(type='FeatureCollection',features=features)))
 (folder/(name+'-query.json')).write_text(json.dumps(dict(service=service,where=where,fields=fields,bbox=BBOX,ids=ids)))
 return name,len(features)
def round_coords(c):
 if not c:return c
 if isinstance(c[0],(int,float)):return [round(c[0],6),round(c[1],6)]
 return [round_coords(x) for x in c]
CLIP=box(*BBOX)
SX=math.cos(math.radians(44))*111320
def clean(geo,tolerance=7):
 g=make_valid(shape(geo)).intersection(CLIP)
 if g.is_empty:return None
 local=affinity.scale(g,xfact=SX,yfact=111320,origin=(0,0))
 local=local.simplify(tolerance,preserve_topology=True)
 g=affinity.scale(local,xfact=1/SX,yfact=1/111320,origin=(0,0))
 # Snap display coordinates while keeping valid rings and removing sub-grid slivers.
 g=set_precision(g,grid_size=0.000001,mode='valid_output')
 if g.is_empty:return None
 m=mapping(g)
 if 'coordinates' not in m:return None
 return {'type':m['type'],'coordinates':round_coords(m['coordinates'])}
def props(kind,name,source,identifier,geo,**kwargs):
 p=dict(kind=kind,name=name,sourceUrl=SOURCES[source],sourceRecordId=str(identifier),geometryQuality='official_display_simplification',**kwargs)
 if geo['type'] in ('Polygon','MultiPolygon'):
  g=shape(geo);point=g.representative_point();p['labelPoint']=[round(point.x,6),round(point.y,6)];p['areaHa']=round(affinity.scale(g,xfact=SX,yfact=111320,origin=(0,0)).area/10000,2)
 return dict(type='Feature',properties=p,geometry=geo)
def write(name,features):
 path=ROOT/'public/data'/name;path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(dict(type='FeatureCollection',features=features),ensure_ascii=False,separators=(',',':')))
 return dict(file=name,features=len(features),bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest())
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--source-dir',required=True,type=Path);ap.add_argument('--download',action='store_true');args=ap.parse_args();folder=args.source_dir;folder.mkdir(parents=True,exist_ok=True)
 if args.download:
  if not (folder/'attractions.geojson').exists():(folder/'attractions.geojson').write_bytes(request(ATTRACTIONS))
  with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
   print(list(ex.map(lambda name:download(name,folder),SERVICES)))
  if not (folder/'toronto-parks.zip').exists():(folder/'toronto-parks.zip').write_bytes(request(TORONTO_PARKS))
 raw={n:json.loads((folder/(n+'.geojson')).read_text())['features'] for n in SERVICES}
 base,context,landmarks=[],[],[]
 roads=collections.defaultdict(list)
 for f in raw['roads']:
  p=f['properties'];name=p.get('FULL_STREET_NAME') or (f"Highway {p['ROUTE_NUMBER']}" if p.get('ROUTE_NUMBER') else None)
  if not name:continue
  g=clean(f['geometry']);cls=p['ROAD_CLASS'];cls='Arterial Street' if cls=='Arterial' else cls
  if not g:continue
  if g['type']=='LineString':roads[name,cls].append(g['coordinates'])
  elif g['type']=='MultiLineString':roads[name,cls].extend(g['coordinates'])
 for (name,cls),lines in sorted(roads.items()):
  base.append(props('road',name,'roads',name,dict(type='MultiLineString',coordinates=lines),classes=[cls]))
 for f in raw['water']:
  p=f['properties'];g=clean(f['geometry'],5)
  if g and g['type'] in ('Polygon','MultiPolygon'):base.append(props('water',p.get('OFFICIAL_NAME_LABEL') or '', 'water',p['OBJECTID'],g))
 rail_lines=[]
 for f in raw['rails']:
  p=f['properties']
  if p.get('STATUS') != 'Operational':continue
  g=clean(f['geometry'])
  if g and g['type']=='LineString':rail_lines.append(g['coordinates'])
  elif g and g['type']=='MultiLineString':rail_lines.extend(g['coordinates'])
 context.append(props('railway','Railway tracks','rails','regional',dict(type='MultiLineString',coordinates=rail_lines)))
 for f in raw['airports']:
  p=f['properties'];names={'CYYZ':'Toronto Pearson International Airport (YYZ)','CYTZ':'Billy Bishop Toronto City Airport (YTZ)'}
  if p.get('AIRPORT_IDENT') not in names:continue
  g=clean(f['geometry'],4)
  if g and g['type'] in ('Polygon','MultiPolygon'):
   context.append(props('airport',names[p['AIRPORT_IDENT']],'airports',p['OBJECTID'],g,named=True,airportId=p['AIRPORT_IDENT'],labelPriority=1000))
 for f in raw['protected']:
  p=f['properties'];g=clean(f['geometry'])
  if g and g['type'] in ('Polygon','MultiPolygon'):
   context.append(props('park',p['NAME_E'],'protected',p['OBJECTID'],g,named=True,protectionType=p.get('TYPE_E')))
 for f in raw['reserves']:
  p=f['properties'];name=p.get('adminAreaNameEng') or '';kind=str(p.get('distributionTypeEng') or '')
  if not ('reserve' in kind.lower() or 'island' in name.lower() or 'scugog' in name.lower()):continue
  g=clean(f['geometry'])
  if g and g['type'] in ('Polygon','MultiPolygon'):context.append(props('reserve',name,'reserves',p['OBJECTID'],g,named=True,administrativeType=kind))
 z=zipfile.ZipFile(folder/'toronto-parks.zip')
 shp=next(n for n in z.namelist() if n.endswith('.shp'));stem=shp[:-4]
 r=shapefile.Reader(shp=io.BytesIO(z.read(stem+'.shp')),shx=io.BytesIO(z.read(stem+'.shx')),dbf=io.BytesIO(z.read(stem+'.dbf')),encoding='utf-8')
 for rec in r.iterShapeRecords():
  if rec.shape.shapeType==0:continue
  p=rec.record.as_dict();g=clean(rec.shape.__geo_interface__,4)
  if not g or g['type'] not in ('Polygon','MultiPolygon'):continue
  name=p.get('NAME') or p.get('Name') or p.get('AREA_NAME') or p.get('PARK_NAME') or ''
  f=props('park',name,'toronto-parks',p.get('OBJECTID',p.get('AREA_ID','')),g,named=bool(name))
  if f['properties']['areaHa']>=5:context.append(f)
 major={'Toronto','Mississauga','Brampton','Vaughan','Markham','Richmond Hill','Oakville','Burlington','Milton','Ajax','Whitby','Oshawa','Pickering','Newmarket','Aurora','Halton Hills','Caledon','Uxbridge','Stouffville','Georgina','King City','Port Perry','Bowmanville'}
 local={'Scarborough','North York','Etobicoke','Unionville','Thornhill','Port Credit','Streetsville','Woodbridge','Maple','Kleinburg','Georgetown','Acton','Bolton','Brooklin','Courtice','Clarington','Keswick','Sutton','Beaverton','Sunderland','Cannington'}
 places={}
 for f in raw['names']:
  p=f['properties'];name=p.get('OFFICIAL_NAME') or p.get('LABEL');x=p.get('LONGITUDE_DECIMAL_DEGREES');y=p.get('LATITUDE_DECIMAL_DEGREES')
  entity=p.get('ENTITY_TYPE','')
  if name not in major|local or not x or not y or 'Township' in entity:continue
  if not CLIP.covers(Point(x,y)):continue
  rank=3 if entity in ('City','Town','Municipality') else 2 if 'Community' in entity else 0
  if not rank or (name in places and places[name][0]>=rank):continue
  places[name]=(rank,props('orientation_landmark',name,'names',p['OBJECTID'],dict(type='Point',coordinates=[round(x,6),round(y,6)]),minZoom=9 if name in major else 11,priority=110 if name in major else 80,placeType='municipality' if name in major else 'locality'))
 landmarks.extend(value[1] for name,value in sorted(places.items()))
 attraction_names={'CN Tower','Casa Loma','Rogers Centre','Royal Ontario Museum','Scotiabank Arena','Toronto City Hall and Nathan Phillips Square','Toronto Zoo'}
 for f in json.loads((folder/'attractions.geojson').read_text())['features']:
  p=f['properties']
  if p['NAME'] not in attraction_names:continue
  g=f['geometry'];coordinates=g['coordinates'][0] if g['type']=='MultiPoint' else g['coordinates']
  landmarks.append(props('orientation_landmark',p['NAME'],'attractions',p['_id'],dict(type='Point',coordinates=coordinates),minZoom=12 if p['NAME']=='CN Tower' else 13,priority=100 if p['NAME']=='CN Tower' else 70,websiteUrl=p.get('WEBSITE')))
 outputs=[write('basemap.geojson',base),write('geographic-context.geojson',context),write('orientation-landmarks.geojson',landmarks)]
 audit=dict(snapshotDate='2026-11-06',bounds=BBOX,displaySimplificationMeters=7,sources=[dict(id=n,url=SOURCES[n],service=SERVICES[n][0],license='Open Government Licence – Canada' if n in ('protected','reserves') else 'Open Government Licence – Ontario',rawFeatures=len(raw[n]),sha256=hashlib.sha256((folder/(n+'.geojson')).read_bytes()).hexdigest()) for n in SERVICES]+[dict(id='toronto-parks',url=SOURCES['toronto-parks'],download=TORONTO_PARKS,license='Open Government Licence – Toronto'),dict(id='attractions',url=SOURCES['attractions'],download=ATTRACTIONS,license='Open Government Licence – Toronto')],outputs=outputs,notes=['Display geometry is clipped to the GTA context window; census geometry and values are processed separately.','The park layer combines protected and conserved areas with Toronto parks of at least five hectares. It is not an exhaustive municipal parks inventory.','Place labels use official geographic name coordinates; they do not redefine census tract boundaries.'])
 p=ROOT/'data/audit/geography.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(audit,indent=2))
 print(json.dumps(outputs,indent=2))
if __name__=='__main__':main()
