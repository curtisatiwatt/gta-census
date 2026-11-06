"""Extract exact selected rows from Toronto's pinned 2021 neighbourhood workbook.
Requires openpyxl. No medians or populations are spatially estimated.
"""
import json, openpyxl, hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'data/municipal/toronto'
w=openpyxl.load_workbook(p/'profiles-2021.xlsx',read_only=True,data_only=True)
rows=list(w.active.values)
selected={'population':1642,'income':245,'childrenPct':31,'householdSize':232}
groups=['south_asian','chinese','black','filipino','arab','latin_american','southeast_asian','west_asian','korean','japanese','visible_minority_nie','multiple_visible_minorities','not_visible_minority']
selected.update({k:1644+i for i,k in enumerate(groups)})
assert rows[244][0].strip()=='Median total income of household in 2020 ($)'
assert rows[1641][0].strip()=='Total - Visible minority for the population in private households - 25% sample data'
records={}
for c in range(1,len(rows[0])):
 code=str(rows[1][c]); name=rows[0][c]
 def num(key):
  x=rows[selected[key]-1][c]
  return x if isinstance(x,(int,float)) else None
 records[code]={'name':name,'population':num('population'),'income':num('income'),'children':num('childrenPct')/100 if num('childrenPct') is not None else None,'householdSize':num('householdSize'),'totalPopulation':None,'counts':{g:num(g) for g in groups},'sourceUrl':'https://open.toronto.ca/dataset/neighbourhood-profiles/','statisticsMethod':'municipal_profile','caveat':'Toronto市政府发布的2021年社区普查定制表（25%抽样数据）；收入为2020年家庭税前总收入中位数。','caveatEn':'City of Toronto custom 2021 neighbourhood census profile (25% sample data); income is median total before-tax household income in 2020.'}
(p/'profiles-selected.json').write_text(json.dumps({'source':'data/municipal/toronto/profiles-2021.xlsx','sourceSha256':hashlib.sha256((p/'profiles-2021.xlsx').read_bytes()).hexdigest(),'sheet':w.active.title,'rows':{k:{'row':i,'label':rows[i-1][0]} for k,i in selected.items()},'records':records},ensure_ascii=False,indent=2)+'\n')
print(len(records), 'Toronto profiles extracted')
