"""Extract unchanged PSD layers into browser compositing assets; never save source PSDs."""
from pathlib import Path
from psd_tools import PSDImage
from PIL import Image
import json,re,shutil,logging,gc
logging.getLogger('psd_tools').setLevel(logging.ERROR)
ROOT=Path('/Users/shawn/Downloads/【食饮】冬藏季·双11')
OUT=Path('public/catalog'); OUT.mkdir(exist_ok=True)
entries=[]
import runpy
extract_text=runpy.run_path('scripts/text-layers.py')['extract_text']

def image_entry(path,name,category,mode='overlay',**extra):
 i=f't{len(entries)+1:02d}'; ext=path.suffix.lower(); dest=OUT/(i+ext);shutil.copyfile(path,dest)
 im=Image.open(path); w,h=im.size
 thumb=im.copy();thumb.thumbnail((320,240));thumb.save(OUT/(i+'-thumb.png'))
 e=dict(id=i,name=name,category=category,mode=mode,width=w,height=h,url='catalog/'+dest.name,thumb='catalog/'+i+'-thumb.png',source=str(path.relative_to(ROOT)),**extra)
 entries.append(e);return e

# Exact exported PNGs; branding/stickers are overlays positioned over the client's canvas.
for f,n in [('冬藏季—食品专属.png','冬藏季 Logo · 组合版'),('冬藏季—食品专属 横版.png','冬藏季 Logo · 横版')]:
 image_entry(ROOT/'logo'/f,n,'Logo','badge',canvasWidth=1280,canvasHeight=720,overlayWidth=.30,overlayX=.035,overlayY=.035)
for k in range(1,4):image_entry(ROOT/'直播间贴片'/f'sticker {k}.png',f'直播贴纸 {k}','直播贴纸','badge',canvasWidth=720,canvasHeight=1280,overlayWidth=.38,overlayX=.60,overlayY=.50)
for f,n in [('冬藏季-食品饮料.png','竖版视频框 · 食品饮料'),('冬藏季-美妆.png','竖版视频框 · 美妆')]:image_entry(ROOT/'竖版视频边框/导出贴片'/f,n,'视频边框','overlay')
for f,n in [('食品饮料.png','食品饮料 · 行业贴片'),('美妆.png','美妆 · 行业贴片')]:image_entry(ROOT/'竖版视频边框/导出贴片'/f,n,'行业贴片','badge',canvasWidth=720,canvasHeight=1280,overlayWidth=.40,overlayX=.56,overlayY=.15)
for k in range(1,6):image_entry(ROOT/'主题大图'/f'{k}.jpg',f'主题大图 {k}','主题与 KV','original')
image_entry(ROOT/'KV/冬藏节-通用版.jpg','冬藏季 · 通用 KV','主题与 KV','original')

# Keep the existing exact transparent frames, extracted from the supplied workbook.
for source,name,cat in [(Path('public/templates/square.png'),'商品主图框','商品图框'),(Path('public/templates/landscape.png'),'横版视频边框','视频边框')]:
 i=f't{len(entries)+1:02d}';im=Image.open(source);thumb=im.copy();thumb.thumbnail((320,240));thumb.save(OUT/(i+'-thumb.png'))
 entries.append(dict(id=i,name=name,category=cat,mode='overlay',width=im.width,height=im.height,url=str(source.relative_to('public')),thumb='catalog/'+i+'-thumb.png',source='原需求表独立透明导出'))

def leaves(group):
 out=[]
 for l in group:
  if not l.is_visible():continue
  if l.is_group():out+=leaves(l)
  else:out.append(l)
 return out

def ancestors(l):
 while l.parent and l.parent.kind!='psdimage':
  l=l.parent;yield l.name

def extract(doc,art,name,category,kind):
 all_layers=leaves(art)
 if kind=='person': targets=[l for l in all_layers if (l.name.startswith('人物') or l.name in ['达人更换','达人'])]
 elif kind=='wide-product':targets=[l for l in all_layers if l.name=='产品样例']
 elif kind=='product-one':targets=[l for l in all_layers if l.name.startswith('图层 575') or l.name in ['图层 574','图层 572'] or l.name.startswith('形状 1 拷贝')]
 elif kind=='product-two':
  targets=[l for l in all_layers if (('曲奇' in list(ancestors(l)) or '饼干' in list(ancestors(l))) and l.name!='图片 63') or l.name.startswith('对图片进行抠图处理 (9)') or l.name in ['图层 17','图层 18','图层 19']]
 else:targets=[]
 i=f't{len(entries)+1:02d}'
 viewport=art.bbox if art is not doc else (0,0,doc.width,doc.height)
 x,y,x2,y2=viewport;w=x2-x;h=y2-y
 original=doc.topil().crop(viewport) if art is not doc else doc.topil()
 original.save(OUT/(i+'-original.png'))
 thumb=original.copy();thumb.thumbnail((320,240));thumb.save(OUT/(i+'-thumb.png'))
 e=dict(id=i,name=name,category=category,width=w,height=h,mode='layered' if targets else 'original',thumb='catalog/'+i+'-thumb.png',source=str(doc._catalog_source),url='catalog/'+i+'-original.png')
 if targets:
  ids={id(l) for l in targets};cut=min(all_layers.index(l) for l in targets)
  text_ids=extract_text(art,all_layers,viewport,e,OUT,ids) or set()
  lower={id(l) for l in all_layers[:cut] if id(l) not in ids};upper={id(l) for l in all_layers[cut:] if id(l) not in ids}
  def filt(allowed):
   def f(l):
    if not l.is_visible():return False
    return any(id(c) in allowed for c in l.descendants()) if l.is_group() else id(l) in allowed
   return f
  bg=art.composite(viewport=viewport,layer_filter=filt(lower),alpha=0)
  fg=art.composite(viewport=viewport,layer_filter=filt(upper),alpha=0)
  if bg is None:bg=Image.new('RGBA',(w,h))
  if fg is None:fg=Image.new('RGBA',(w,h))
  bg.save(OUT/(i+'-bg.png'));fg.save(OUT/(i+'-fg.png'))
  if text_ids:
   for suffix,allowed in [('bg',lower),('fg',upper)]:
    clean=art.composite(viewport=viewport,layer_filter=filt(allowed-text_ids),alpha=0)
    if clean is None:clean=Image.new('RGBA',(w,h))
    clean.save(OUT/(i+'-textclean-'+suffix+'.png'));e['textClean'+suffix.upper()]='catalog/'+i+'-textclean-'+suffix+'.png'
  # Product reflections/shadows never define the replacement slot.
  actual=[l for l in targets if (l.name.startswith('图层 575') and not l.name.endswith('拷贝')) or l.name in ['图层 574','人物','达人更换','达人','产品样例'] or l.name.startswith('对图片进行抠图处理 (9)') or l.name in ['图层 9','图层 10','图层 11','图层 12','图层 13','图层 14']]
  if kind=='person': actual=targets
  if not actual:actual=targets
  sx=max(0,min(l.left for l in actual)-x);sy=max(0,min(l.top for l in actual)-y)
  ex=min(w,max(l.right for l in actual)-x);ey=min(h,max(l.bottom for l in actual)-y)
  e.update(bg='catalog/'+i+'-bg.png',fg='catalog/'+i+'-fg.png',slot=dict(x=sx,y=sy,width=ex-sx,height=ey-sy),removedLayers=[l.name for l in targets])
 entries.append(e);print('EXPORTED',i,name,e['mode'],flush=True)

specs=[
 ('投放物料（九图）/第一套/投放物料（九图）.psd','商品方图 · 第一套','商品方图','product-one'),
 ('投放物料（九图）/第二套/投放-for商家主图.psd','商品方图 · 第二套','商品方图','product-two'),
 ('投放-for达人/投放-for达人1.psd','达人方图 · 第一套','达人方图','person'),
 ('投放-for达人/投放-for达人2.psd','达人方图 · 第二套','达人方图','person'),
 ('投放物料（横版）/投放物料（横版大图）-商品.psd','横版商品','横版投放','wide-product'),
 ('投放物料（横版）/投放物料（横版大图）-达人.psd','横版达人','横版投放','person'),
 ('竖版图片背景/竖版图片背景.psd','竖版海报 / 封面','海报封面','person'),
]
for path,prefix,category,kind in specs:
 doc=PSDImage.open(ROOT/path);doc._catalog_source=path
 boards=list(doc) if any(l.kind=='artboard' for l in doc) else [doc]
 if kind=='product-one':boards.sort(key=lambda l:int(re.search(r'\d+',l.name)[0]))
 elif kind=='product-two':boards.sort(key=lambda l:int(l.name))
 else:boards.sort(key=lambda l:(l.top,l.left))
 for n,art in enumerate(boards,1):extract(doc,art,prefix+(f' {n:02d}' if len(boards)>1 else ''),category,kind)
 del doc;gc.collect()
# The left video placeholder is a precisely designated panel in the approved source.
# Keep the full raster untouched; crop the client media to the original rounded panel in-browser.
e=image_entry(ROOT/'竖版视频转横横版视频边框/竖版视频转横横版视频边框.jpg','竖视频转横版 · 腾讯营销','视频边框','inset',slot=dict(x=144,y=37,width=361,height=645),radius=27)
(OUT/'manifest.json').write_text(json.dumps(entries,ensure_ascii=False,indent=2))
print('TOTAL',len(entries),flush=True)
