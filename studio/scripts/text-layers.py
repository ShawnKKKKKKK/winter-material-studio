"""Read PSD typography and cached glyph pixels without modifying the source."""
from PIL import Image
import math

def scalar(v,default=0):
 try:return float(v)
 except:return default

def color(c,alpha=1):
 return 'rgba(%s,%s)' % (','.join(str(round(scalar(c.get(k)))) for k in [b'Rd  ',b'Grn ',b'Bl  ']),alpha)

def extract_text(art,all_layers,viewport,entry,out,excluded):
 candidates=[l for l in all_layers if l.kind=='type' and l.text.strip() not in ['@','￥','稿定','竖版视频','诚意·欢享']]
 if not candidates:return
 x,y,x2,y2=viewport; w=x2-x;h=y2-y
 fields=[]
 for n,l in enumerate(sorted(candidates,key=lambda l:(l.top,l.left)),1):
  ed=l.engine_dict; styles=ed['StyleRun']['RunArray'];s=styles[0]['StyleSheet']['StyleSheetData']
  base=l.resource_dict['StyleSheetSet'][0]['StyleSheetData']; merged=dict(base);merged.update(s);s=merged
  font=l.resource_dict['FontSet'][int(s.get('Font',0))]['Name'].value
  transform=list(l.transform);transform[4]-=x;transform[5]-=y
  text=l.text.replace('\r','\n');vertical=int(ed['Rendered']['Shapes']['WritingDirection'])==2
  rgba=[scalar(v) for v in s['FillColor']['Values']]
  align=int(ed['ParagraphRun']['RunArray'][0]['ParagraphSheet']['Properties'].get('Justification',0))
  fs=scalar(s['FontSize']);leading=scalar(s.get('Leading',fs*1.2)) if not bool(s.get('AutoLeading',True)) else fs*1.2
  if leading<=0:leading=fs*1.2
  label=('达人名称' if '达人' in text else '优惠金额' if text.strip().isdigit() else '按钮文案' if ('立即' in text or '点击进入' in text) else '活动标题' if '双十一利益' in text or '大额' in text else '活动信息' if '活动利益' in text else '使用条件' if text.startswith('满') else '适用商品' if text.startswith('限XXX') else f'文案 {n}')
  f=dict(id=f'text{n}',label=label,original=text,font=font,fontSize=fs,transform=transform,box=[l.left-x,l.top-y,l.width,l.height],vertical=vertical,align=['left','right','center'][align] if align<3 else 'left',leading=leading,tracking=scalar(s.get('Tracking'))*fs/1000,fill='rgba(%s,%s)'%(','.join(str(round(v*255)) for v in rgba[1:4]),rgba[0]),opacity=l.opacity/255,effects=[])
  for e in l.effects:
   if not e.enabled:continue
   if e.name=='DropShadow':f['effects'].append(dict(type='shadow',color=color(e.color,scalar(e.opacity)/100),angle=scalar(e.angle),distance=scalar(e.distance),blur=scalar(e.size)))
   elif e.name=='GradientOverlay':
    g=e.gradient;f['effects'].append(dict(type='gradient',angle=scalar(e.angle),scale=scalar(e.scale)/100,reverse=bool(e.reversed),offset=[scalar(e.offset.get(b'Hrzn')),scalar(e.offset.get(b'Vrtc'))],stops=[[scalar(c[b'Lctn'])/4096,color(c[b'Clr '],scalar(e.opacity)/100)] for c in g[b'Clrs']]))
  # Cache original glyphs, including effects. Unedited fields use these exact pixels.
  im=l.composite(viewport=viewport,alpha=0)
  if im is None:continue
  bounds=im.getbbox()
  if not bounds:continue
  dest=out/(entry['id']+f'-text{n}.png');im.crop(bounds).save(dest)
  f.update(url='catalog/'+dest.name,rasterBox=list(bounds));fields.append(f)
 entry['texts']=fields
 return {id(l) for l in candidates}
