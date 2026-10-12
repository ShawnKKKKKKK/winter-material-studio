from pathlib import Path
from psd_tools import PSDImage
import runpy,json
extract_text=runpy.run_path('scripts/text-layers.py')['extract_text']
root=Path('/Users/shawn/Downloads/【食饮】冬藏季·双11');out=Path('public/catalog');entries=json.loads((out/'manifest.json').read_text())
def extend(doc,art,e):
 layers=[l for l in art.descendants() if l.is_visible() and not l.is_group()]
 viewport=art.bbox if art is not doc else (0,0,doc.width,doc.height)
 ids=extract_text(art,layers,viewport,e,out,set())
 if not ids:return
 def filt(l):return l.is_visible() and (any(id(c) not in ids and not c.is_group() and c.is_visible() for c in l.descendants()) if l.is_group() else id(l) not in ids)
 im=art.composite(viewport=viewport,layer_filter=filt,alpha=0);im.save(out/(e['id']+'-textclean.png'));e['textClean']='catalog/'+e['id']+'-textclean.png'
doc=PSDImage.open(root/'直播间贴片/侧边栏贴纸.psd')
for n,art in enumerate(doc):extend(doc,art,entries[n+2])
doc=PSDImage.open(root/'竖版视频转横横版视频边框/竖版视频转横横版视频边框.psd');extend(doc,doc,entries[56])
(out/'manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2))
print('text templates',sum(bool(e.get('texts')) for e in entries),'fields',sum(len(e.get('texts',[])) for e in entries))
