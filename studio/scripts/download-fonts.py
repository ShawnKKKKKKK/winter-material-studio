from pathlib import Path
from urllib.request import urlretrieve
from concurrent.futures import ThreadPoolExecutor
from fontTools.ttLib import TTFont
OUT=Path('public/fonts')
def fetch(spec):
 name,repo,folder=spec
 otf=OUT/(name+'.otf'); target=OUT/(name+'.woff2')
 if target.exists():return
 url=f'https://raw.githubusercontent.com/adobe-fonts/{repo}/release/{folder}/{name}.otf'
 urlretrieve(url,otf)
 f=TTFont(otf);f.flavor='woff2';f.save(target);otf.unlink();print(name,flush=True)
items=[(f'SourceHanSansCN-{w}','source-han-sans','SubsetOTF/CN') for w in ['Bold','Heavy','Medium','Regular']]+[(f'SourceHanSansSC-{w}','source-han-sans','OTF/SimplifiedChinese') for w in ['Bold','Medium','Regular']]+[(f'SourceHanSerifCN-Heavy','source-han-serif','SubsetOTF/CN'),('SourceHanSerifSC-Heavy','source-han-serif','OTF/SimplifiedChinese'),('SourceHanSerifSC-SemiBold','source-han-serif','OTF/SimplifiedChinese')]
with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,items))
for repo in ['source-han-sans','source-han-serif']:
 urlretrieve(f'https://raw.githubusercontent.com/adobe-fonts/{repo}/release/LICENSE.txt',OUT/(repo+'-LICENSE.txt'))
