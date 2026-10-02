import numpy as np, json, sys
from scipy import ndimage as ndi
from skimage.morphology import skeletonize
from skan import Skeleton, summarize
import cv2
from PIL import Image
SPUR=float(sys.argv[1])
im=Image.open('board3200.png').convert('RGB'); t=np.array(im).astype(np.float32)
g=t@np.array([.299,.587,.114],dtype=np.float32); H,W=g.shape
pad=30; gp=np.pad(g,pad,mode='reflect')
op=ndi.gaussian_filter(ndi.grey_opening(gp,size=(15,15)),2)
v=np.clip((gp-op)[pad:-pad,pad:-pad],0,None)
mask=np.load('mask3.npy')
sk=skeletonize(mask)
def clean(sk):
    for _ in range(2):
        s=Skeleton(sk); df=summarize(s,separator='_')
        bad=df[(df['branch_type']==1)&(df['branch_distance']<SPUR)]
        if bad.empty: break
        sk=sk.copy(); nb=ndi.convolve(sk.astype(np.uint8),np.ones((3,3),np.uint8),mode='constant')
        for i in bad.index:
            c=s.path_coordinates(i); ends=[c[0],c[-1]]
            d=[int(nb[tuple(e.astype(int))])-1 for e in ends]
            keep=ends[int(np.argmax(d))]
            for p in c:
                if tuple(p)!=tuple(keep): sk[tuple(p.astype(int))]=False
        sk=skeletonize(sk)
    return sk
sk=clean(sk)
lab,n=ndi.label(sk,structure=np.ones((3,3))); cnt=ndi.sum(sk,lab,range(1,n+1))
sk=np.isin(lab,[i+1 for i,c in enumerate(cnt) if c>=35])
print('skel px',sk.sum())
dist,(iy,ix)=ndi.distance_transform_edt(~sk,return_indices=True)
region=(dist<=5)&(v>3)
S=np.zeros(sk.shape,np.float32); Pk=np.zeros(sk.shape,np.float32)
ys,xs=np.nonzero(region)
np.add.at(S,(iy[ys,xs],ix[ys,xs]),v[ys,xs]); np.maximum.at(Pk,(iy[ys,xs],ix[ys,xs]),v[ys,xs])
s=Skeleton(sk)
def sm1(a,w):
    if len(a)<2: return a
    return np.convolve(np.pad(a,w//2,mode='edge'),np.ones(w)/w,'valid')
res=[]
for i in range(s.n_paths):
    c=s.path_coordinates(i).astype(np.float32)
    if len(c)<4: continue
    arr=c.copy()
    for k in range(2): arr[:,k]=np.convolve(np.pad(c[:,k],2,mode='edge'),np.ones(5)/5,'valid')
    arr[0]=c[0]; arr[-1]=c[-1]
    ap=cv2.approxPolyDP(arr[:,::-1].reshape(-1,1,2).astype(np.float32),0.9,False).reshape(-1,2)
    yy=c[:,0].astype(int); xx=c[:,1].astype(int)
    pk=sm1(Pk[yy,xx],13); ss=sm1(S[yy,xx],13)
    wq=np.where(pk>1,ss/np.maximum(pk,1),1.0)
    pts=[]
    for x,y in ap:
        j=int(np.argmin((arr[:,1]-x)**2+(arr[:,0]-y)**2))
        pts.append((float(x),float(y),float(min(wq[j],14)),float(pk[j])))
    if len(pts)>=2: res.append(pts)
print('polys',len(res),'verts',sum(len(r) for r in res))
allw=np.array([p[2] for r in res for p in r]); allp=np.array([p[3] for r in res for p in r])
print('width pct',np.percentile(allw,[5,25,50,75,95]),'peak pct',np.percentile(allp,[5,25,50,75,95,100]))
json.dump(res,open('veins3.json','w'))
