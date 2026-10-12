from pathlib import Path
from psd_tools import PSDImage
import json
root=Path('/Users/shawn/Downloads/【食饮】冬藏季·双11')
out=[]
for p in sorted(root.rglob('*')):
 if p.suffix.lower() not in ['.psd','.psb']: continue
 psd=PSDImage.open(p)
 def scan(layers):
  return [dict(name=l.name,kind=l.kind,visible=l.visible,bbox=l.bbox,text=l.text if l.kind=='type' else None,children=scan(l) if l.is_group() else None) for l in layers]
 info=dict(file=str(p.relative_to(root)),width=psd.width,height=psd.height,layers=scan(psd))
 out.append(info)
 print(info['file'],psd.size, 'top-level',[(l.name,l.kind,l.visible,l.bbox) for l in psd],flush=True)
Path('test-artifacts/psd-inventory.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
