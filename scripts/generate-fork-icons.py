#!/usr/bin/env python3
"""Generate fork icons from assets/fork-icon/source.svg. Python: Pillow 11.3.0, CairoSVG 2.7.1.
Run nice -n 19 python3 scripts/generate-fork-icons.py [--check].
"""
from pathlib import Path
from io import BytesIO
import argparse, json, hashlib, struct
import xml.etree.ElementTree as ET
import cairosvg
from PIL import Image, ImageDraw, ImageChops
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'assets/fork-icon/source.svg'
CHECK='--check' in __import__('sys').argv
def raster_source(data):
    # CairoSVG does not evaluate viewport media queries like browsers. Select the
    # bitmap optical variant explicitly after padding, leaving CSS to SVG viewers.
    root=ET.fromstring(data)
    for child in list(root):
        if child.tag.endswith('style') or child.get('id') in ('badge16-responsive','badge32-responsive'):
            root.remove(child)
    return ET.tostring(root)
master=Image.open(BytesIO(cairosvg.svg2png(bytestring=raster_source(SOURCE.read_bytes()),output_width=2048,output_height=2048))).convert('RGBA')
plain_svg=ET.fromstring(raster_source(SOURCE.read_bytes()))
for child in list(plain_svg):
 if child.get('id')=='fork-badge':plain_svg.remove(child)
plain=Image.open(BytesIO(cairosvg.svg2png(bytestring=ET.tostring(plain_svg),output_width=2048,output_height=2048))).convert('RGBA')
paseo=(ROOT/'packages/app').exists()
outputs={}
cache={}
def png(path,size,style='square'):
    key=(size,style)
    if key in cache:
        im,data=cache[key];outputs[path]=data;return im
    optical=(size[0]==size[1] and size[0]<=32 and style in ('mac','web','square')) or style=='tray'
    source_art=plain if optical else master
    art=source_art
    if style in ('mac','adaptive','round','maskable'):
        art=Image.new('RGBA',master.size)
        extent={'mac':1648,'adaptive':1000,'round':1648,'maskable':1320}[style]
        tile=source_art.resize((extent,extent),Image.Resampling.LANCZOS)
        if style=='mac':
            mask=Image.new('L',tile.size);ImageDraw.Draw(mask).rounded_rectangle((0,0,extent-1,extent-1),radius=370,fill=255);tile.putalpha(mask)
        art.alpha_composite(tile,((2048-extent)//2,)*2)
    im=art.resize(size,Image.Resampling.LANCZOS)
    if style in ('square','round','maskable'):
        opaque=Image.new('RGBA',size,'black');opaque.alpha_composite(im);im=opaque
    if optical:
        dimension=32 if style=='tray' or size[0]>16 else 16
        symbol=ET.parse(SOURCE).getroot().find(f".//*[@id='small-badge-{dimension}']")
        svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{size[0]}" height="{size[1]}" viewBox="0 0 {dimension} {dimension}">'.encode()+ET.tostring(symbol)+b'</svg>'
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
    if 'foreground' in p.name:style='adaptive'
    elif 'ic_launcher' in p.name:style='round'
    elif p.name.startswith('pwa-icon'):style='maskable'
    elif 'desktop' in p.parts and p.parent.name in ('assets','icons'):style='mac'
    elif 'web' in p.parts or p.name=='favicon.png':style='web'
    else:style='square'
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
        data=cairosvg.svg2png(bytestring=raster_source(svg.encode()),output_width=48,output_height=48)
        outputs[target.with_suffix('.png')]=data
else:
    tray=png(ROOT/'assets/fork-icon/previews/tray-64.png',(64,64),'tray')
    outputs[ROOT/'desktop/src-tauri/icons/fork-tray.rgba']=tray.tobytes()
# Every review sample is a generated output; small badges are applied after padding.
for style in ('mac','web','square','adaptive','round','maskable'):
 for size in (16,32,64,128,1024):
  png(ROOT/f'assets/fork-icon/previews/{style}-{size}.png',(size,size),style)
# Verify the complete badge against Android's documented66/108 safe-zone diameter.
svgroot=ET.parse(SOURCE).getroot()
badge=svgroot.find(".//*[@id='fork-badge']")
badge_svg=b'<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="0 0 1024 1024">'+ET.tostring(badge)+b'</svg>'
badge_image=Image.open(BytesIO(cairosvg.svg2png(bytestring=badge_svg))).convert('RGBA')
mask_report={}
for style,extent,safe_ratio in [('adaptive',1000,66/108),('round',1648,1.0),('maskable',1320,0.8)]:
 layer=Image.new('RGBA',(2048,2048));layer.alpha_composite(badge_image.resize((extent,extent),Image.Resampling.LANCZOS),((2048-extent)//2,)*2)
 safe=Image.new('L',(2048,2048));margin=2048*(1-safe_ratio)/2
 ImageDraw.Draw(safe).ellipse((margin,margin,2048-margin-1,2048-margin-1),fill=255)
 # Ignore sub-unit Lanczos ringing in transparent pixels; visible badge coverage must be intact.
 alpha=layer.getchannel('A').point(lambda a:255 if a>8 else 0)
 outside=ImageChops.subtract(alpha,safe)
 if outside.getbbox():raise SystemExit(f'{style}: badge leaves safe circle')
 mask_report[style]={'safeDiameterRatio':safe_ratio,'badgeClipped':False}
outputs[ROOT/'assets/fork-icon/mask-check.json']=(json.dumps(mask_report,indent=2)+'\n').encode()
# macOS upstream/fork comparison, with full-size 1024 entries rather than thumbnails.
sheet=Image.new('RGB',(2304,2920),'#e5e7eb');draw=ImageDraw.Draw(sheet)
up=Image.open(ROOT/'assets/fork-icon/upstream.png').convert('RGBA')
for size,y in [(16,40),(32,130),(64,230),(128,360),(1024,750)]:
 draw.text((20,y),f'{size}px — upstream / actual macOS fork export',fill='black')
 for col,bg in enumerate(('#fff','#15171c')):
  x=30+col*1140
  for i in (0,1):
   tile=cache[((size,size),'mac')][0] if i else up.resize((size,size),Image.Resampling.LANCZOS)
   px=x+(i*(size+24) if size<1024 else 20);py=y+45+(i*1080 if size==1024 else 0)
   if size==1024 or i==0:draw.rectangle((x,py-10,x+1100,py+size+10),fill=bg)
   sheet.paste(tile,(px,py),tile)
out=BytesIO();sheet.save(out,format='PNG');outputs[ROOT/'assets/fork-icon/contact-sheet.png']=out.getvalue()
# Per-platform actual generated outputs at native 16/32/64/128/1024, light and dark.
for style,label in [('web','Web rounded'),('square','iOS opaque'),('adaptive','Android adaptive foreground'),('round','Android legacy round'),('maskable','PWA maskable')]:
 sheet=Image.new('RGB',(2304,1800),'#e5e7eb');draw=ImageDraw.Draw(sheet)
 for size,y in [(16,35),(32,120),(64,220),(128,360),(1024,680)]:
  draw.text((20,y),f'{label}: actual generated {size}px export — light / dark',fill='black')
  for col,bg in enumerate(('#fff','#15171c')):
   x=30+col*1140;draw.rectangle((x,y+25,x+1100,y+size+55),fill=bg)
   tile=cache[((size,size),style)][0];sheet.paste(tile,(x+20,y+40),tile)
 out=BytesIO();sheet.save(out,format='PNG');outputs[ROOT/f'assets/fork-icon/contact-sheet-{style}.png']=out.getvalue()
# Circle/squircle masks use the generated Android foreground, with its actual inset.
sheet=Image.new('RGB',(2304,2920),'#e5e7eb');draw=ImageDraw.Draw(sheet)
for size,y in [(16,35),(32,120),(64,220),(128,360),(1024,650)]:
 draw.text((20,y),f'Android {size}px circle / squircle masks — badge safe-zone check passed',fill='black')
 for col,bg in enumerate(('#fff','#15171c')):
  x=30+col*1140;draw.rectangle((x,y+25,x+1100,y+size+55),fill=bg)
  for i,shape in enumerate(('circle','squircle')):
   tile=Image.new('RGBA',(size,size),'black');tile.alpha_composite(cache[((size,size),'adaptive')][0])
   mask=Image.new('L',(size,size));md=ImageDraw.Draw(mask)
   if shape=='circle':md.ellipse((0,0,size-1,size-1),fill=255)
   else:md.rounded_rectangle((0,0,size-1,size-1),radius=size*0.22,fill=255)
   tile.putalpha(mask)
   # Full-size mask previews are stacked so every exported pixel remains inspectable.
   px=x+20+(i*(size+24) if size<1024 else 0);py=y+40+(i*1080 if size==1024 else 0)
   if size==1024:draw.rectangle((x,py-10,x+1100,py+size+10),fill=bg)
   sheet.paste(tile,(px,py),tile)
 out=BytesIO()
 # Native-sized circle and squircle PNGs accompany the sheet at every scale.
 for shape in ('circle','squircle'):
  tile=Image.new('RGBA',(size,size),'black');tile.alpha_composite(cache[((size,size),'adaptive')][0])
  mask=Image.new('L',(size,size));md=ImageDraw.Draw(mask)
  if shape=='circle':md.ellipse((0,0,size-1,size-1),fill=255)
  else:md.rounded_rectangle((0,0,size-1,size-1),radius=size*0.22,fill=255)
  tile.putalpha(mask);out=BytesIO();tile.save(out,format='PNG');outputs[ROOT/f'assets/fork-icon/previews/android-{shape}-{size}.png']=out.getvalue()
out=BytesIO();sheet.save(out,format='PNG');outputs[ROOT/'assets/fork-icon/contact-sheet-masks.png']=out.getvalue()
manifest={str(p.relative_to(ROOT)):hashlib.sha256(data).hexdigest() for p,data in sorted(outputs.items())}
outputs[ROOT/'assets/fork-icon/manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
for p,data in outputs.items():
 if CHECK:
  if not p.exists() or p.read_bytes()!=data:raise SystemExit(f'Drift: {p.relative_to(ROOT)}')
 else:p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
print(f'{"Verified" if CHECK else "Generated"} {len(outputs)} assets from {SOURCE.relative_to(ROOT)}')
