# -*- coding: utf-8 -*-
import json, sys, math, base64
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
res=json.load(open('veins3.json'))
W,H=3200,1486
polys=[]
for r in res:
    flat=[]
    for x,y,w,pk in r:
        flat += [int(round(x*4)),int(round(y*4)),int(round(min(w,14)*8)),int(round(min(pk,255)))]
    polys.append(flat)
# фон: низкочастотное поле яркости листа без жил (карта 160x74, байты)
im=Image.open('board3200.png').convert('RGB'); t=np.array(im).astype(np.float32)
g=t.mean(2)
op=ndi.gaussian_filter(ndi.grey_opening(g,size=(21,21)),10)
gw,gh=160,74
small=np.array(Image.fromarray(op.astype(np.float32),mode='F').resize((gw,gh),Image.BILINEAR))
med=float(np.median(small))
bg=np.clip(np.round(small/med*128),0,255).astype(np.uint8)
print('bg ratio range',bg.min()/128,bg.max()/128,'median lum',med)
base=[round(float(np.median(t[...,c][g<np.percentile(g,60)])),1) for c in range(3)]
print('base',base)
spec={"code":"LINK-1790249477980","exact":True,"w":W,"h":H,"tileMM":[2800,1300],"seed":206,
 "exposure":0.62,"base":[round(b) for b in base],"tint":[172,167,158],"gain":0.8,"period":1310.75,"lwK":0.95,"aK":0.8,"glow":0.6,
 "bgW":gw,"bgH":gh,"bg":base64.b64encode(bg.tobytes()).decode(),"veins":polys,"mott":[0.4,0.5,1.0]}
out="/* GENERATED convertor output (full Egger sheet -> vector veins + cloud map). Do not edit by hand. */\n(function(){'use strict';var r=window.Modul3D=window.Modul3D||{};var s="+json.dumps(spec,separators=(',',':'))+";r.decorData={byCode:{'LINK-1790249477980':s,'CTOP-COMPACT12-F206ST9':s}};})();\n"
open(sys.argv[1],'w',encoding='utf-8').write(out)
print('paths',len(polys),'verts',sum(len(p)//4 for p in polys),'bytes',len(out))
