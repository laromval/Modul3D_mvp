import numpy as np, sys, json
from PIL import Image
from scipy import ndimage as ndi
from skimage.filters import sato, apply_hysteresis_threshold
from skimage.morphology import skeletonize, remove_small_holes
Image.MAX_IMAGE_PIXELS=None
W=3200
im=Image.open('board.png').convert('RGB'); H=round(im.size[1]*W/im.size[0]); im=im.resize((W,H),Image.LANCZOS)
im.save('board3200.png')
t=np.array(im).astype(np.float32); g=t@np.array([.299,.587,.114],dtype=np.float32)
pad=30
gp=np.pad(g,pad,mode='reflect')
r=sato(gp,sigmas=[1.2,1.8,2.6],black_ridges=False)[pad:-pad,pad:-pad]
print('ridge pct',[round(float(x),2) for x in np.percentile(r,[50,80,90,95,98,99])])
lo=np.percentile(r,float(sys.argv[1])); hi=np.percentile(r,float(sys.argv[2]))
m=apply_hysteresis_threshold(r,lo,hi)
lab,n=ndi.label(m,structure=np.ones((3,3))); sz=ndi.sum(m,lab,range(1,n+1))
m=np.isin(lab,[i+1 for i,s in enumerate(sz) if s>=int(sys.argv[3])])
m=remove_small_holes(m,max_size=60)
print('mask frac',m.mean(),'H',H)
np.save('mask3.npy',m); np.save('ridge3.npy',r)
Image.fromarray((m*255).astype(np.uint8)).resize((1000,round(H*1000/W))).save('mask3_preview.png')
