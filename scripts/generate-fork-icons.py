#!/usr/bin/env python3
"""Generate fork icons from assets/fork-icon/source.svg. Python: Pillow 11.3.0, CairoSVG 2.7.1.
Run nice -n 19 python3 scripts/generate-fork-icons.py [--check].
"""
from pathlib import Path
from io import BytesIO
import argparse, json, hashlib, struct
import xml.etree.ElementTree as ET
import cairosvg
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'assets/fork-icon/source.svg'
CHECK='--check' in __import__('sys').argv
master=Image.open(BytesIO(cairosvg.svg2png(url=str(SOURCE),output_width=2048,output_height=2048))).convert('RGBA')
paseo=(ROOT/'packages/app').exists()
outputs={}
cache={}
def png(path,size,style='square'):
    key=(size,style)
    if key in cache:
        im,data=cache[key];outputs[path]=data;return im
    art=master
    if style in ('mac','adaptive'):
        art=Image.new('RGBA',master.size)
        extent=1648 if style=='mac' else 1320
        tile=master.resize((extent,extent),Image.Resampling.LANCZOS)
        if style=='mac':
            mask=Image.new('L',tile.size);ImageDraw.Draw(mask).rounded_rectangle((0,0,extent-1,extent-1),radius=370,fill=255);tile.putalpha(mask)
        art.alpha_composite(tile,((2048-extent)//2,)*2)
    im=art.resize(size,Image.Resampling.LANCZOS)
    if style=='square':
        opaque=Image.new('RGBA',size,'black');opaque.alpha_composite(im);im=opaque
    if size==(16,16):
        symbol=ET.parse(SOURCE).getroot().find(".//*[@id='small-badge']")
        svg=b'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">'+ET.tostring(symbol)+b'</svg>'
        overlay=Image.open(BytesIO(cairosvg.svg2png(bytestring=svg))).convert('RGBA');im.alpha_composite(overlay)
    out=BytesIO();im.save(out,format='PNG');outputs[path]=out.getvalue();cache[key]=(im,out.getvalue())
    return im
# Regenerate only application identity assets, preserving illustrations and notification/status glyphs.
if paseo:
    targets=[ROOT/'packages/desktop/assets'/n for n in ['icon.png','icon-dev.png','32x32.png','64x64.png','128x128.png','128x128@2x.png']]
    targets += [ROOT/'packages/app/assets/images'/n for n in ['icon.png','android-icon-foreground.png','favicon.png']]
    targets += list((ROOT/'packages/app/public').glob('*icon*.png'))
    targets += [ROOT/'fastlane/metadata/android/en-US/images/icon.png']
else:
    targets=list((ROOT/'desktop/src-tauri/icons').glob('*.png'))
    targets=[p for p in targets if p.name not in ('buzz-source.png','dmg-background.png')]
    targets+=list((ROOT/'desktop/src-tauri/icons/ios').glob('*.png'))
    targets+=list((ROOT/'desktop/src-tauri/icons/android').glob('mipmap-*/*.png'))
    targets+=list((ROOT/'mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset').glob('*.png'))
    targets+=list((ROOT/'mobile/android/app/src/main/res').glob('mipmap-*/*.png'))
    targets+=[ROOT/'mobile/assets/images/buzz-icon.png',ROOT/'web/src/assets/app-icon@3x.png']
    targets+=list((ROOT/'desktop/public').glob('app-icon*.png'))
for p in targets:
    with Image.open(p) as old:size=old.size
    style='adaptive' if 'foreground' in p.name else 'mac' if ('desktop' in p.parts and p.parent.name in ('assets','icons')) else 'square'
    png(p,size,style)
if paseo:
    ios_images=[]
    for idiom,sizes in [('iphone',[(20,2),(20,3),(29,2),(29,3),(40,2),(40,3),(60,2),(60,3)]),('ipad',[(20,1),(20,2),(29,1),(29,2),(40,1),(40,2),(76,1),(76,2),(83.5,2)]),('ios-marketing',[(1024,1)])]:
      for size,scale in sizes:
        filename=f'{idiom}-{size}@{scale}x.png';png(ROOT/'assets/fork-icon/iOSAppIcon.appiconset'/filename,(int(size*scale),)*2)
        ios_images.append({'idiom':idiom,'size':f'{size}x{size}','scale':f'{scale}x','filename':filename})
    outputs[ROOT/'assets/fork-icon/iOSAppIcon.appiconset/Contents.json']=(json.dumps({'images':ios_images,'info':{'version':1,'author':'xcode'}},indent=2)+'\n').encode()
mac=png(ROOT/'assets/fork-icon/macos-1024.png',(1024,1024),'mac')
for size in (16,32,64,128,256,512):
 for scale in (1,2):
    png(ROOT/f'assets/fork-icon/AppIcon.appiconset/icon_{size}x{size}{"@2x" if scale==2 else ""}.png',(size*scale,)*2,'mac')
contents={'images':[{'idiom':'mac','size':f'{s}x{s}','scale':f'{d}x','filename':f'icon_{s}x{s}{"@2x" if d==2 else ""}.png'} for s in (16,32,128,256,512) for d in (1,2)],'info':{'version':1,'author':'xcode'}}
outputs[ROOT/'assets/fork-icon/AppIcon.appiconset/Contents.json']=(json.dumps(contents,indent=2)+'\n').encode()
base=ROOT/('packages/desktop/assets' if paseo else 'desktop/src-tauri/icons')
for ext in ('icns','ico'):
 out=BytesIO()
 if ext=='icns':
  chunks=[]
  for tag,size in [('icp4',16),('ic11',32),('icp5',32),('ic12',64),('ic07',128),('ic13',256),('ic08',256),('ic14',512),('ic09',512),('ic10',1024)]:
   data=cache[((size,size),'mac')][1];chunks.append(tag.encode()+struct.pack('>I',len(data)+8)+data)
  body=b''.join(chunks);out.write(b'icns'+struct.pack('>I',len(body)+8)+body)
 else:
  sizes=(16,32,64,128,256);frames=[cache[((size,size),'mac')][1] for size in sizes]
  out.write(struct.pack('<HHH',0,1,len(sizes)));offset=6+16*len(sizes)
  for size,data in zip(sizes,frames):
   out.write(struct.pack('<BBBBHHII',size%256,size%256,0,0,1,32,len(data),offset));offset+=len(data)
  for data in frames:out.write(data)
 outputs[base/f'icon.{ext}']=out.getvalue()
# Web favicon identity only; marketing logo is outside scope.
favicon=ROOT/('packages/website/public' if paseo else 'admin-web/public')
outputs[favicon/'favicon.svg']=SOURCE.read_bytes()
if paseo:
 outputs[favicon/'favicon.ico']=outputs[base/'icon.ico']
if paseo:
    for scheme in ('light','dark'):
      for state,color in [('',None),('-running','#3b82f6'),('-attention','#22c55e')]:
        svg=SOURCE.read_text()
        if color:svg=svg.replace('</svg>',f'<circle cx="840" cy="180" r="148" fill="{color}" stroke="#fff" stroke-width="28"/></svg>')
        target=ROOT/f'packages/app/assets/images/favicon-{scheme}{state}'
        outputs[target.with_suffix('.svg')]=svg.encode()
        data=cairosvg.svg2png(bytestring=svg.encode(),output_width=48,output_height=48)
        outputs[target.with_suffix('.png')]=data
else:
    tray=master.resize((64,64),Image.Resampling.LANCZOS)
    outputs[ROOT/'desktop/src-tauri/icons/fork-tray.rgba']=tray.tobytes()
# Native-size before/after on light and dark backgrounds, including full 1024px artwork.
sheet=Image.new('RGB',(2304,2920),'#e5e7eb');draw=ImageDraw.Draw(sheet)
up=Image.open(ROOT/'assets/fork-icon/upstream.png').convert('RGBA')
for row,(size,y) in enumerate([(16,40),(32,130),(64,230),(128,360),(1024,750)]):
 draw.text((20,y),f'{size}px — upstream / fork',fill='black')
 for col,bg in enumerate(('#fff','#15171c')):
  x=30+col*1140;draw.rectangle((x,y+25,x+1100,y+25+size+40),fill=bg)
  for i,img in enumerate((up,mac)):
   tile=cache[((size,size),'mac')][0] if i==1 else img.resize((size,size),Image.Resampling.LANCZOS)
   # At 1024px show upstream then fork vertically to retain true native dimensions.
   px=x+(i*(size+24) if size<1024 else 20);py=y+45+(i*1080 if size==1024 else 0)
   if size==1024:draw.rectangle((x,py-10,x+1100,py+1034),fill=bg)
   sheet.paste(tile,(px,py),tile)
out=BytesIO();sheet.save(out,format='PNG');outputs[ROOT/'assets/fork-icon/contact-sheet.png']=out.getvalue()
manifest={str(p.relative_to(ROOT)):hashlib.sha256(data).hexdigest() for p,data in sorted(outputs.items())}
outputs[ROOT/'assets/fork-icon/manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
for p,data in outputs.items():
 if CHECK:
  if not p.exists() or p.read_bytes()!=data:raise SystemExit(f'Drift: {p.relative_to(ROOT)}')
 else:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
print(f'{"Verified" if CHECK else "Generated"} {len(outputs)} assets from {SOURCE.relative_to(ROOT)}')
