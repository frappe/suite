import hashlib,json,os,statistics,subprocess,time
from pathlib import Path
bench=Path.home()/'pilot/benches/frappe-bench';source=bench/'apps/frappe/frappe/commands/utils.py';original=source.read_text()
old='\t\tbuild_framework_islands(production=mode == "production")\n\n';assert original.count(old)==1
fixed=original.replace(old,'',1).replace('\t\tfor app in apps:\n','\t\tif "frappe" in apps:\n\t\t\tbuild_framework_islands(production=mode == "production")\n\n\t\tfor app in apps:\n',1)
output=Path(os.environ['GITHUB_WORKSPACE'])/'island-comparison';output.mkdir()
def chart_snapshot():
 public=bench/'apps/frappe/frappe/public/dist/island'
 files={str(p.relative_to(public)):hashlib.sha256(p.read_bytes()).hexdigest() for p in public.rglob('*') if p.is_file()}
 maps=json.loads((bench/'sites/assets/assets.json').read_text())
 return files,{k:v for k,v in maps.items() if 'frappe.chart' in k}
results=[]
try:
 for i in range(3):
  for mode in (['before','after'] if i%2==0 else ['after','before']):
   source.write_text(original if mode=='before' else fixed)
   before=chart_snapshot();start=time.perf_counter()
   r=subprocess.run(['pilot','-b','frappe-bench','frappe','build','--app','suite','--production'],text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
   elapsed=time.perf_counter()-start;(output/f'{mode}-{i+1}.log').write_text(r.stdout)
   if r.returncode:raise RuntimeError(r.stdout[-5000:])
   if mode=='after':
    assert chart_snapshot()==before,'Restored chart assets or registrations changed'
    assert '[island] frappe.chart:' not in r.stdout,'Framework chart still rebuilt'
   else:assert '[island] frappe.chart:' in r.stdout,'Baseline did not build chart'
   results.append({'mode':mode,'iteration':i+1,'seconds':round(elapsed,3)})
 source.write_text(fixed)
 data={'runs':results,'median_seconds':{m:statistics.median(r['seconds'] for r in results if r['mode']==m) for m in ['before','after']}}
 (output/'metrics.json').write_text(json.dumps(data,indent=2));print(json.dumps(data))
finally:source.write_text(original)
