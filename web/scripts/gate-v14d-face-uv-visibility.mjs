// Stage 2B-M2 offline gate v2: UV-driven same-visibility reconciliation.
// Samples = pixels where BOTH the Web foreground-UV pass and the HDR pick mask agree
// the pixel is Face; reference computed by direct UV texture sampling (same UV).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
const OUT = path.resolve(process.argv[2] || ".scratch/v14d-face-uv-visibility/gate");
const WEB_DIR = path.resolve(process.argv[3] || ".scratch/v14d-face-uv-visibility/web");
const BLENDER_DIR = path.resolve(process.argv[4] || ".scratch/v14d-face-uv-visibility/blender");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:/mmd/克莱妲原皮";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
const STATE2_MASK = process.env.V14D_STATE2_MASK || "C:/w/rk3-face-v14d/experiments/koleda-v14d-face-shadow/assets/textures/v14d-01234-face-shadow-state-2.png";
const MAE_THRESHOLD = 20;
const COVERAGE_MIN = 0.95;
function srgbToLinear(c){const v=c/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
function percentile(s,p){if(!s.length)return null;return s[Math.min(s.length-1,Math.floor(p/100*s.length))];}
async function loadLinearTex(file,decodeSrgb){const raw=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});const w=raw.info.width,h=raw.info.height,ch=raw.info.channels;const lin=new Float32Array(w*h*3);for(let i=0;i<w*h;i+=1){const r=raw.data[i*ch],g=raw.data[i*ch+1],b=raw.data[i*ch+2];if(decodeSrgb){lin[i*3]=srgbToLinear(r);lin[i*3+1]=srgbToLinear(g);lin[i*3+2]=srgbToLinear(b);}else{lin[i*3]=r/255;lin[i*3+1]=g/255;lin[i*3+2]=b/255;}}return{width:w,height:h,linear:lin};}
function bilinear(tex,u,v){const x=((u%1)+1)%1*tex.width-0.5;const y=((v%1)+1)%1*tex.height-0.5;const x0=Math.floor(x),y0=Math.floor(y);const fx=x-x0,fy=y-y0;const idx=(xx,yy,c)=>tex.linear[((Math.min(tex.height-1,Math.max(0,yy))*tex.width)+Math.min(tex.width-1,Math.max(0,xx)))*3+c];const out=[0,0,0];for(let c=0;c<3;c+=1){out[c]=idx(x0,y0,c)*(1-fx)*(1-fy)+idx(x0+1,y0,c)*fx*(1-fy)+idx(x0,y0+1,c)*(1-fx)*fy+idx(x0+1,y0+1,c)*fx*fy;}return out;}
const WARM=[1.0,0.935,0.89];
const ART_TINT=[0.66,0.58,0.60];
const FRINGE_TINT=[0.70,0.64,0.69];
function mix(a,b,t){return a+(b-a)*t;}
function shadowFactor(mask){const invB=1-mask[2];const art=[0,1,2].map((c)=>mix(1,ART_TINT[c],mask[0]*invB));const fringe=[0,1,2].map((c)=>mix(1,FRINGE_TINT[c],mask[1]*invB));return[art[0]*fringe[0],art[1]*fringe[1],art[2]*fringe[2]];}
function insideTri(px,py,uvs){const[a,b,c]=uvs;const d=(py-b[1])*(a[0]-b[0])-(px-b[0])*(a[1]-b[1]);const e=(py-c[1])*(b[0]-c[0])-(px-c[0])*(b[1]-c[1]);const f=(py-a[1])*(c[0]-a[0])-(px-a[0])*(c[1]-a[1]);return(d>=0&&e>=0&&f>=0)||(d<=0&&e<=0&&f<=0);}
async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  const web=JSON.parse(fs.readFileSync(path.join(WEB_DIR,"web-face-tri-uv.json"),"utf8"));
  const tris=JSON.parse(fs.readFileSync(path.join(BLENDER_DIR,"blender-triangles.json"),"utf8"));
  const faceD=await loadLinearTex(FACE_D,true);
  const mask=await loadLinearTex(STATE2_MASK,false);
  const size=web.width;
  const uv=web.uv,faceMask=web.faceMask;
  const webHdr={};
  for(const mode of ["normal","faceShadowOnly","finalFaceComposite"]){webHdr[mode]=JSON.parse(fs.readFileSync(path.join(WEB_DIR,"web-"+mode+".hdr.json"),"utf8"));}
  const hdrMask=webHdr.normal.faceMask;
  const N=size*size;
  const fails=[];
  const report={coverage:{},layers:{},negatives:{},blenderTriangles:tris.length};
  // formal: both passes agree Face + uv inside some Blender face triangle
  const formal=[];const rejectedNoTri=[];const rejectedMaskMismatch=[];
  for(let i=0;i<N;i+=1){
    if(!faceMask[i]||!hdrMask[i]){if(faceMask[i]||hdrMask[i])rejectedMaskMismatch.push(i);continue;}
    const u=uv[i*2],v=uv[i*2+1];
    let hit=-1;
    for(let t=0;t<tris.length;t+=1){if(insideTri(u,v,tris[t].uvs)){hit=t;break;}}
    if(hit<0){rejectedNoTri.push(i);continue;}
    formal.push(i);
  }
  const faceCount=hdrMask.reduce((a,b)=>a+b,0);
  const bothAgree=formal.length+rejectedNoTri.length;
  report.coverage={
    facePixelsPick:faceCount,
    facePixelsUvPass:faceMask.reduce((a,b)=>a+b,0),
    bothChannelsAgreeFace:bothAgree,
    formalSamples:formal.length,
    rejectedNoTri:rejectedNoTri.length,
    rejectedMaskMismatch:rejectedMaskMismatch.length,
    coverage:+(formal.length/Math.max(1,bothAgree)).toFixed(4),
    coverageNote:"相对双方通道一致判定为 Face 的像素（UV 前景 pass ∩ HDR pick mask）；眼睛/眼睑由 EyeWhite/Eyes 材质接管、刘海遮挡区经深度剔除，均不计入分母。",
  };
  if(report.coverage.coverage<COVERAGE_MIN)fails.push("coverage "+report.coverage.coverage+" < "+COVERAGE_MIN);
  // xform 可选：对采样 UV 做语义变换（错 UV 负测用 u→1−u 镜像，模拟采样到完全不同区域）。
  // 旧实现用 du=1/width 的单 texel 偏移，在平滑肤色区参考色几乎不变，负测无判别力（Gate 假阴）。
  function maeFor(samples,computeRef,webRgb,xform){const errs=[[],[],[]];let n=0;for(const i of samples){let u=uv[i*2],v=uv[i*2+1];if(xform){const t=xform(u,v);u=t[0];v=t[1];}const ref=computeRef(u,v);const r=webRgb[i*3],g=webRgb[i*3+1],b=webRgb[i*3+2];if(![r,g,b,ref[0],ref[1],ref[2]].every(Number.isFinite))continue;n+=1;errs[0].push(Math.abs(r-ref[0]));errs[1].push(Math.abs(g-ref[1]));errs[2].push(Math.abs(b-ref[2]));}return{samples:n,mae:[0,1,2].map((c)=>+(errs[c].reduce((a,b)=>a+b,0)/Math.max(1,n)*255).toFixed(3)),p95:[0,1,2].map((c)=>{const s=errs[c].slice().sort((a,b)=>a-b);const v=percentile(s,95);return v===null?null:+(v*255).toFixed(3);})};}
  const refBase=(u,v)=>bilinear(faceD,u,v);
  const refShadow=(u,v)=>shadowFactor(bilinear(mask,u,v));
  const refComposite=(u,v)=>{const base=bilinear(faceD,u,v);const sf=shadowFactor(bilinear(mask,u,v));return[base[0]*WARM[0]*sf[0],base[1]*WARM[1]*sf[1],base[2]*WARM[2]*sf[2]];};
  report.layers.baseColor=maeFor(formal,refBase,webHdr.normal.rgb);
  report.layers.shadowFactor=maeFor(formal,refShadow,webHdr.faceShadowOnly.rgb);
  report.layers.finalComposite=maeFor(formal,refComposite,webHdr.finalFaceComposite.rgb);
  // 错 UV 负测：u→u+0.5 大偏移。脸部 UV 集中在 u∈[0.04,0.90]，加 0.5 后采到
  // 贴图中完全不同的区域（头发/身体/衣物），参考色显著偏离，可证明 Gate 能识别
  // "采样到错误 UV"的情形。镜像 u→1−u 在近似左右对称的脸部贴图上无判别力（实测
  // 457 vs 351 像素互有胜负），故弃用。
  report.negatives.wrongUv=maeFor(formal,refComposite,webHdr.finalFaceComposite.rgb,(u,v)=>[u+0.5,v]);
  // 错三角形负测：取 UV 质心距离 > 0.25 的远三角形，证明 Gate 能识别错误三角形归属。
  // 相邻三角形在平滑肤色区 UV 接近，无法形成判别；远三角形（如眼睛/发际线）颜色差异大。
  {const errs=[[],[],[]];
   for(const i of formal){
     const u=uv[i*2],v=uv[i*2+1];
     let hit=-1;
     for(let t=0;t<tris.length;t+=1){if(insideTri(u,v,tris[t].uvs)){hit=t;break;}}
     if(hit<0)continue;
     const myC=[(tris[hit].uvs[0][0]+tris[hit].uvs[1][0]+tris[hit].uvs[2][0])/3,(tris[hit].uvs[0][1]+tris[hit].uvs[1][1]+tris[hit].uvs[2][1])/3];
     let best=-1,bestD=0;
     for(let j=0;j<tris.length;j+=1){
       const c=[(tris[j].uvs[0][0]+tris[j].uvs[1][0]+tris[j].uvs[2][0])/3,(tris[j].uvs[0][1]+tris[j].uvs[1][1]+tris[j].uvs[2][1])/3];
       const d=Math.hypot(c[0]-myC[0],c[1]-myC[1]);
       if(d>0.25&&d>bestD){bestD=d;best=j;}
     }
     if(best<0)continue;
     const bc=[(tris[best].uvs[0][0]+tris[best].uvs[1][0]+tris[best].uvs[2][0])/3,(tris[best].uvs[0][1]+tris[best].uvs[1][1]+tris[best].uvs[2][1])/3];
     const ref=refComposite(bc[0],bc[1]);
     errs[0].push(Math.abs(webHdr.finalFaceComposite.rgb[i*3]-ref[0]));
     errs[1].push(Math.abs(webHdr.finalFaceComposite.rgb[i*3+1]-ref[1]));
     errs[2].push(Math.abs(webHdr.finalFaceComposite.rgb[i*3+2]-ref[2]));
   }
   report.negatives.wrongTriangle={samples:errs[0].length,mae:[0,1,2].map((c)=>+(errs[c].reduce((a,b)=>a+b,0)/Math.max(1,errs[c].length)*255).toFixed(3))};}
  for(let c=0;c<3;c+=1){
    if(report.layers.finalComposite.mae[c]>MAE_THRESHOLD)fails.push("finalComposite ch"+c+" MAE "+report.layers.finalComposite.mae[c]+"/255 > 20/255");
    if(!(report.negatives.wrongUv.mae[c]>report.layers.finalComposite.mae[c]*1.5))fails.push("wrong-UV negative weak (ch "+c+")");
    if(!(report.negatives.wrongTriangle.mae[c]>report.layers.finalComposite.mae[c]*1.5))fails.push("wrong-triangle negative weak (ch "+c+")");
  }
  fs.writeFileSync(path.join(OUT,"gate-report.json"),JSON.stringify(report,null,2));
  console.log("===UV-VIS-GATE-REPORT=== "+path.join(OUT,"gate-report.json"));
  console.log(JSON.stringify(report,null,2));
  if(fails.length){console.error("===UV-VIS-GATE-FAIL===\n"+fails.join("\n"));process.exit(1);}
  console.log("===UV-VIS-GATE-OK===");
}
main().catch((e)=>{console.error("===UV-VIS-GATE-ERROR===",e);process.exit(2);});
