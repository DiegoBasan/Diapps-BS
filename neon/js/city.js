/* Ciudad procedural infinita. La rejilla de manzanas es determinista (hash con semilla), así que la ciudad
   siempre es la misma. Se genera por chunks de 3×3 manzanas alrededor de la nave y se descarga lo lejano.
   Cada chunk = 1 malla de edificios (ventanas por shader), 1 de neón, 1 de anuncios holográficos,
   1 de balizas, 1 de árboles; los modelos de Sketchfab (rascacielos, letreros) van en InstancedMesh compartidos. */
import * as THREE from "../../shared/vendor/three/three.module.min.js";
import {hash2,rng,noise,clamp,lerp,pick} from "./util.js";
import {U,FOG_GLSL,fogUniforms} from "./world.js";

export const BLOCK=120,ROAD=24,CB=3,CHUNK=BLOCK*CB,HALF_ROAD=ROAD/2;
export const PYR={x:60,z:60,w:300,h:300}; // megaestructura del centro (3×3 manzanas)

/* densidad urbana 0..1.2: centro + otros núcleos por ruido */
export function density(x,z){
  const r=Math.hypot(x-60,z-60);
  let d=Math.exp(-r/1100)*0.95;
  d+=0.6*Math.max(0,noise.noise(x/1600+3.1,z/1600-7.3));
  d+=0.18*noise.noise(x/380,z/380);
  return clamp(d,0.05,1.2);
}
/* barrio con más neón (letreros, anuncios) */
export function neonness(x,z){return clamp(0.5+0.6*noise.noise(x/900-11,z/900+5),0,1)}

/* tipo de manzana: 0 edificios, 1 parque, 2 plaza (pirámide), 3 hito (modelo de Sketchfab) */
export function blockInfo(bi,bj){
  const cx=bi*BLOCK+BLOCK/2,cz=bj*BLOCK+BLOCK/2;
  const d=density(cx,cz),h=hash2(bi,bj,1);
  if(bi>=-1&&bi<=1&&bj>=-1&&bj<=1)return {type:2,d,h};
  if(d<0.75&&hash2(bi,bj,2)<0.07+(d<0.35?0.06:0))return {type:1,d,h};
  if(d>0.55&&hash2(bi,bj,3)<0.05+d*0.05)return {type:3,d,h};
  return {type:0,d,h};
}

const NEON=[0xff2bd6,0x19e6ff,0xff7a1a,0x7a5cff,0xff3355,0x2bff9e,0xffe14a].map(c=>new THREE.Color(c));
const FACADE=[0x8a8f96,0x5d636b,0x3d4148,0x9c9488,0x2a2d33,0xb7b9bc,0x6f6a63,0x474d57].map(c=>new THREE.Color(c));

/* --- buffers de geometría --- */
class Buf{
  constructor(){this.p=[];this.n=[];this.f=[];this.b=[];this.c=[]}
  v(x,y,z,nx,ny,nz,fu,fv,bld,col){this.p.push(x,y,z);this.n.push(nx,ny,nz);this.f.push(fu,fv);this.b.push(bld[0],bld[1],bld[2],bld[3]);this.c.push(col.r,col.g,col.b)}
  geo(){
    if(!this.p.length)return null;
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(this.p,3));
    g.setAttribute("normal",new THREE.Float32BufferAttribute(this.n,3));
    g.setAttribute("aFac",new THREE.Float32BufferAttribute(this.f,2));
    g.setAttribute("aBld",new THREE.Float32BufferAttribute(this.b,4));
    g.setAttribute("color",new THREE.Float32BufferAttribute(this.c,3));
    g.computeBoundingSphere();g.computeBoundingBox();return g;
  }
}
function area(pts){let a=0;for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p[0]*q[1]-q[0]*p[1]}return a/2}
function shape(kind,cx,cz,w,d){
  if(kind===0)return [[cx-w/2,cz-d/2],[cx+w/2,cz-d/2],[cx+w/2,cz+d/2],[cx-w/2,cz+d/2]];
  const n=kind===1?8:kind===2?6:18,rx=w/2,rz=d/2,o=kind===1?Math.PI/8:0,pts=[];
  for(let i=0;i<n;i++){const a=o+i/n*Math.PI*2;pts.push([cx+Math.cos(a)*rx,cz+Math.sin(a)*rz])}
  return pts;
}
/* prisma vertical con caras exteriores, tapa superior y coordenadas de fachada (u = perímetro, v = altura) */
function prism(B,pts,y0,y1,smoothN,bld,col,u0=0,cap=true){
  if(area(pts)>0)pts=pts.slice().reverse();
  let cx=0,cz=0;pts.forEach(p=>{cx+=p[0];cz+=p[1]});cx/=pts.length;cz/=pts.length;
  let u=u0;const n=pts.length;
  for(let i=0;i<n;i++){
    const a=pts[i],b=pts[(i+1)%n];const ex=b[0]-a[0],ez=b[1]-a[1],L=Math.hypot(ex,ez);
    let nx=-ez/L,nz=ex/L;let anx=nx,anz=nz,bnx=nx,bnz=nz;
    if(smoothN){const la=Math.hypot(a[0]-cx,a[1]-cz),lb=Math.hypot(b[0]-cx,b[1]-cz);anx=(a[0]-cx)/la;anz=(a[1]-cz)/la;bnx=(b[0]-cx)/lb;bnz=(b[1]-cz)/lb}
    const u1=u+L;
    B.v(a[0],y0,a[1],anx,0,anz,u,y0,bld,col);B.v(b[0],y0,b[1],bnx,0,bnz,u1,y0,bld,col);B.v(b[0],y1,b[1],bnx,0,bnz,u1,y1,bld,col);
    B.v(a[0],y0,a[1],anx,0,anz,u,y0,bld,col);B.v(b[0],y1,b[1],bnx,0,bnz,u1,y1,bld,col);B.v(a[0],y1,a[1],anx,0,anz,u,y1,bld,col);
    u=u1;
  }
  if(cap)for(let i=0;i<n;i++){
    const a=pts[i],b=pts[(i+1)%n];
    // orientación hacia arriba
    const cr=(a[1]-cz)*(b[0]-cx)-(a[0]-cx)*(b[1]-cz);
    const P=cr>=0?[a,b]:[b,a];
    B.v(cx,y1,cz,0,1,0,cx,cz,bld,col);B.v(P[0][0],y1,P[0][1],0,1,0,P[0][0],P[0][1],bld,col);B.v(P[1][0],y1,P[1][1],0,1,0,P[1][0],P[1][1],bld,col);
  }
}
function inset(pts,k){let cx=0,cz=0;pts.forEach(p=>{cx+=p[0];cz+=p[1]});cx/=pts.length;cz/=pts.length;return pts.map(p=>[cx+(p[0]-cx)*k,cz+(p[1]-cz)*k])}
function grow(pts,m){let cx=0,cz=0;pts.forEach(p=>{cx+=p[0];cz+=p[1]});cx/=pts.length;cz/=pts.length;return pts.map(p=>{const dx=p[0]-cx,dz=p[1]-cz,l=Math.hypot(dx,dz)||1;return [p[0]+dx/l*m,p[1]+dz/l*m]})}

/* --- materiales --- */
const PAL=`vec3 neonPal(float t){t=fract(t)*7.0;
  return t<1.?vec3(1.,.17,.84):t<2.?vec3(.1,.9,1.):t<3.?vec3(1.,.48,.1):t<4.?vec3(.48,.36,1.):t<5.?vec3(1.,.2,.33):t<6.?vec3(.17,1.,.62):vec3(1.,.88,.29);}
float hh(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}`;

export function buildingMaterial(){
  const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.8,metalness:0.1,envMapIntensity:1});
  m.onBeforeCompile=s=>{
    Object.assign(s.uniforms,{uTime:U.uTime,uDay:U.uDay,uWet:U.uWet,uLit:U.uLit});
    s.vertexShader=s.vertexShader.replace("#include <common>",`#include <common>
      attribute vec2 aFac;attribute vec4 aBld;varying vec2 vFac;varying vec4 vBld;varying vec3 vN;`)
      .replace("#include <begin_vertex>",`#include <begin_vertex>
      vFac=aFac;vBld=aBld;vN=normal;`);
    s.fragmentShader=s.fragmentShader.replace("#include <common>",`#include <common>
      uniform float uTime,uDay,uWet,uLit;varying vec2 vFac;varying vec4 vBld;varying vec3 vN;${PAL}
      float gWin;vec3 gEm;`)
      .replace("#include <color_fragment>",`#include <color_fragment>
      {
        float roof=step(0.5,vN.y);float st=floor(vBld.y+0.5);float plain=step(7.5,st);float sd=floor(vBld.x+0.5)*0.0137;
        vec2 cs=st<0.5?vec2(3.2,3.6):st<1.5?vec2(7.0,3.6):st<2.5?vec2(1.6,3.6):vec2(2.4,3.6);
        vec2 g=vFac/cs;vec2 ci=floor(g);vec2 f=fract(g);
        vec2 fr=st<0.5?vec2(0.22,0.30):st<1.5?vec2(0.02,0.34):st<2.5?vec2(0.42,0.10):vec2(0.03,0.05);
        float wm=step(fr.x*.5,f.x)*step(f.x,1.-fr.x*.5)*step(fr.y*.5,f.y)*step(f.y,1.-fr.y*.5);
        vec2 fw=fwidth(g);float aa=clamp(1.6-max(fw.x,fw.y)*2.4,0.,1.);
        wm=mix((1.-fr.x)*(1.-fr.y),wm,aa)*(1.-roof)*(1.-plain);
        float shop=(1.-step(4.5,vFac.y))*(1.-roof)*(1.-plain);
        wm*=1.-shop;
        float flip=floor(uTime*0.015+hh(ci+sd)*9.0);
        float on=step(hh(ci+sd*13.1+flip*0.37),vBld.z*uLit);
        on=mix(vBld.z*uLit,on,aa);
        float hc=hh(ci*1.7+sd);
        vec3 wc=hc<0.55?vec3(1.,.70,.40):hc<0.86?vec3(.72,.86,1.):neonPal(vBld.w+hc*3.);
        float inner=(0.4+0.9*hh(ci+3.1))*mix(1.,(0.35+0.65*smoothstep(0.05,0.75,f.y))*(1.+0.6*smoothstep(0.86,0.92,f.y)),aa)*mix(1.,step(0.08,abs(f.x-0.5)),aa*step(0.7,hh(ci+8.)));
        gEm=wc*on*inner*wm*mix(0.95,0.12,uDay);
        // locales a pie de calle
        float sf=step(0.2,fract(vFac.x/9.0))*step(1.0,vFac.y)*step(vFac.y,3.8);
        gEm+=shop*sf*neonPal(vBld.w+floor(vFac.x/9.0)*0.37)*mix(1.1,0.2,uDay);
        gEm+=shop*(1.-sf)*vec3(1.,.8,.6)*0.05;
        gWin=wm;
        vec3 glass=vec3(0.018,0.024,0.034)+wc*0.02;
        diffuseColor.rgb=mix(diffuseColor.rgb,glass,wm);
        diffuseColor.rgb*=mix(1.,0.62,roof);
        // rejilla del techo
        vec2 rg=abs(fract(vFac*0.25)-0.5);diffuseColor.rgb*=mix(1.,0.75+0.25*step(0.04,min(rg.x,rg.y)),roof);
        // oclusión falsa: se oscurece al pie del edificio
        diffuseColor.rgb*=mix(0.5+0.5*smoothstep(0.,14.,vFac.y),1.,roof);
        diffuseColor.rgb*=mix(1.,0.72,uWet*(1.-wm));
      }`)
      .replace("#include <roughnessmap_fragment>",`#include <roughnessmap_fragment>
      roughnessFactor=mix(mix(0.82,0.55,uWet),mix(0.14,0.06,uWet),gWin);`)
      .replace("#include <metalnessmap_fragment>",`#include <metalnessmap_fragment>
      metalnessFactor=mix(0.04,0.35,gWin);`)
      .replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>
      totalEmissiveRadiance+=gEm;`);
  };
  return m;
}

export function adsMaterial(scene){
  return new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false,
    uniforms:{uTime:U.uTime,uDay:U.uDay,...fogUniforms(scene)},
    vertexShader:`attribute vec4 aAd;varying vec4 vAd;varying vec2 vUv;varying vec3 vW;
      void main(){vAd=aAd;vUv=uv;vW=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float uTime,uDay;varying vec4 vAd;varying vec2 vUv;varying vec3 vW;${PAL}${FOG_GLSL}
      float glyph(vec2 cell,vec2 f,float s,vec2 g){vec2 b=floor(f*vec2(4.,5.));float v=step(0.45,hh(b+cell*7.13+s))*step(0.08,f.x)*step(f.x,0.92)*step(0.06,f.y)*step(f.y,0.94);
        vec2 fw=fwidth(g)*vec2(4.,5.);return mix(0.4,v,clamp(1.5-max(fw.x,fw.y)*2.,0.,1.));}
      void main(){
        float seed=floor(vAd.x+0.5)*0.0137,typ=floor(vAd.z+0.5),asp=vAd.w;vec2 uv=vUv;vec3 c1=neonPal(vAd.y),c2=neonPal(vAd.y+0.43);
        float t=uTime+seed*40.;vec3 col=vec3(0.);
        if(typ<0.5){ // columnas de glifos
          vec2 g=vec2(uv.x*asp*3.,uv.y*8.);float col_=floor(g.x);g.y+=t*(0.6+hh(vec2(col_,seed))*1.6);
          vec2 ci=floor(g);float gl=glyph(ci,fract(g),floor(t*0.5+hh(ci)*4.),g);
          col=mix(c1,c2,hh(vec2(col_,3.)))*gl*(0.5+0.5*hh(ci+1.));col+=c1*0.08;
        }else if(typ<1.5){ // logotipo con anillo
          vec2 p=(uv-0.5)*vec2(asp,1.);float r=length(p);float a=atan(p.y,p.x);
          float ring=smoothstep(0.03,0.0,abs(r-0.32-0.02*sin(t*3.)))+smoothstep(0.02,0.,abs(r-0.22))*step(0.,sin(a*6.+t*2.));
          col=c1*ring*1.6+mix(c2,c1,uv.y)*0.18+c2*smoothstep(0.12,0.0,r)*(0.6+0.4*sin(t*4.));
        }else if(typ<2.5){ // barras de texto y barrido
          float row=floor(uv.y*6.);float bar=step(0.25,fract(uv.y*6.))*step(fract(uv.y*6.),0.75)*step(uv.x,0.15+0.75*hh(vec2(row,seed)));
          col=mix(c1,c2,uv.x)*(0.15+bar*1.2);float sw=smoothstep(0.08,0.,abs(fract(t*0.25)-uv.x));col+=c2*sw*0.8;
        }else{ // pancarta vertical de glifos grandes
          vec2 g=vec2(uv.x*1.,uv.y*asp);vec2 ci=floor(g);float gl=glyph(ci,fract(g),seed+floor(t*0.2),g);
          col=c1*gl*1.5+c2*0.12;
        }
        // marco, líneas de barrido y parpadeo
        vec2 e=min(uv,1.-uv)*vec2(asp,1.);float fr=smoothstep(0.03,0.0,min(e.x,e.y));col+=c1*fr*1.2;
        col*=0.86+0.14*sin(vUv.y*120.+t*8.);
        col*=0.9+0.1*step(0.04,hh(vec2(floor(t*12.),seed)));
        col*=mix(0.95,0.4,uDay);
        col*=1.-neonFog(vW);
        gl_FragColor=vec4(col,1.);
      }`
  });
}
export function beaconMaterial(scene){
  return new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
    uniforms:{uTime:U.uTime,uScale:{value:600},...fogUniforms(scene)},
    vertexShader:`uniform float uTime,uScale;attribute float aPh;attribute vec3 color;varying vec3 vC;varying float vB;varying vec3 vW;
      void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vC=color;vW=position;
        vB=aPh<0.?1.:pow(0.5+0.5*sin(uTime*2.2+aPh*6.283),6.);
        gl_PointSize=clamp(uScale*1.2/-mv.z,1.5,26.);gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`varying vec3 vC;varying float vB;varying vec3 vW;${FOG_GLSL}
      void main(){vec2 p=gl_PointCoord-0.5;float d=length(p);float a=smoothstep(0.5,0.0,d);a=a*a;
        gl_FragColor=vec4(vC*a*vB*3.*(1.-neonFog(vW)*0.85),1.);}`
  });
}
export function neonMaterial(){return new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false})}
export function treeMaterial(){return new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.9,metalness:0})}

/* --- pools de instancias para modelos de Sketchfab --- */
export class Pool{
  /* parts: [{geometry, material}] ya normalizadas en espacio unitario */
  constructor(scene,parts,cap){
    this.cap=cap;this.meshes=parts.map(p=>{const m=new THREE.InstancedMesh(p.geometry,p.material,cap);m.count=0;m.frustumCulled=false;m.castShadow=m.receiveShadow=true;scene.add(m);return m});
    this.free=[];this.top=0;this.owner=new Map();this.zero=new THREE.Matrix4().makeScale(0,0,0);
    this.box=new THREE.Box3();parts.forEach(p=>{p.geometry.computeBoundingBox();this.box.union(p.geometry.boundingBox)});
  }
  add(key,matrix){
    const i=this.free.length?this.free.pop():this.top<this.cap?this.top++:-1;if(i<0)return;
    this.meshes.forEach(m=>{m.setMatrixAt(i,matrix);m.count=Math.max(m.count,this.top);m.instanceMatrix.needsUpdate=true});
    if(!this.owner.has(key))this.owner.set(key,[]);this.owner.get(key).push(i);
  }
  release(key){
    const l=this.owner.get(key);if(!l)return;
    l.forEach(i=>{this.meshes.forEach(m=>{m.setMatrixAt(i,this.zero);m.instanceMatrix.needsUpdate=true});this.free.push(i)});
    this.owner.delete(key);
  }
}

/* --- generación de un chunk --- */
function genChunk(ci,cj,ctx){
  const B=new Buf(),N=new Buf(),T=new Buf();const ads=[];const beacons=[];const boxes=[];const foot=[];const props=[];
  const NB=[0,0,0,0];const white=new THREE.Color();
  const neonStrip=(pts,y0,y1,col,u0)=>prism(N,pts,y0,y1,false,NB,col,u0,false);
  for(let bj=cj*CB;bj<cj*CB+CB;bj++)for(let bi=ci*CB;bi<ci*CB+CB;bi++){
    const info=blockInfo(bi,bj);const R=rng(Math.floor(info.h*4294967296));
    const x0=bi*BLOCK+HALF_ROAD,z0=bj*BLOCK+HALF_ROAD,S=BLOCK-ROAD;
    const nn=neonness(x0+S/2,z0+S/2);
    if(info.type===2){
      if(bi===0&&bj===0)props.push({kind:"pyramid"});
      continue;
    }
    if(info.type===1){ // parque: árboles y faroles
      const nt=14+Math.floor(R()*14);
      for(let k=0;k<nt;k++){
        const x=x0+4+R()*(S-8),z=z0+4+R()*(S-8),h=4+R()*7,r=1.8+R()*2.4;
        const trunk=new THREE.Color(0x2a1d16),crown=new THREE.Color().setHSL(0.36+R()*0.12,0.45,0.10+R()*0.08);
        prism(T,shape(0,x,z,0.6,0.6),0,h*0.5,false,NB,trunk);
        const cr=shape(1,x,z,r*2,r*2);prism(T,cr,h*0.45,h,false,NB,crown);prism(T,inset(cr,0.6),h,h+r*0.7,false,NB,crown);
        boxes.push(x-r*0.7,0,z-r*0.7,x+r*0.7,h+r*0.6,z+r*0.7);
      }
      for(let k=0;k<10;k++){const x=x0+R()*S,z=z0+R()*S;beacons.push(x,3.5,z,1,0.75,0.45,-1)}
      continue;
    }
    if(info.type===3){ // hito de Sketchfab ocupando la manzana
      const kind=R()<0.5?"g1":"tower";const h=170+R()*110;
      props.push({kind,x:x0+S/2,z:z0+S/2,h,rot:Math.floor(R()*4)*Math.PI/2,w:S*0.92});
      foot.push(x0+S*0.2,z0+S*0.2,x0+S*0.8,z0+S*0.8,h);
      continue;
    }
    // manzana normal: subdividir en lotes
    const d=info.d;const lots=[];
    const split=(x,z,w,h,depth)=>{
      const minLot=lerp(18,42,clamp(d,0,1));
      if(depth>3||(w<minLot*2&&h<minLot*2)||(depth>0&&R()<0.12)){lots.push([x,z,w,h]);return}
      const t=0.35+R()*0.3;
      if(w>h){split(x,z,w*t,h,depth+1);split(x+w*t,z,w*(1-t),h,depth+1)}else{split(x,z,w,h*t,depth+1);split(x,z+h*t,w,h*(1-t),depth+1)}
    };
    split(x0,z0,S,S,0);
    for(const [lx,lz,lw,lh] of lots){
      const m=1.5+R()*2.5;const w=lw-m*2,dd=lh-m*2;if(w<6||dd<6)continue;
      const cx=lx+lw/2,cz=lz+lh/2;
      const tall=R()<d*0.55;
      let H=tall?lerp(70,340,Math.pow(R(),1.6)*clamp(d,0.3,1.1)):lerp(9,lerp(28,70,clamp(d,0,1)),R());
      H=Math.max(9,Math.round(H/3.6)*3.6);
      const kr=R();const kind=kr<0.74?0:kr<0.84?1:kr<0.92?2:3;
      const seed=Math.floor(R()*997),style=Math.floor(R()*4),lit=lerp(0.1,0.42,R())*(tall?1:0.85),hue=R();
      const bld=[seed,style,lit,hue];const col=pick(FACADE,R()).clone().multiplyScalar(0.8+R()*0.4);
      let pts=shape(kind,cx,cz,w,dd);let y=0;
      const tiers=H>60?1+Math.floor(R()*3.4):1;const neonOn=R()<0.25+nn*0.5;const ncol=pick(NEON,R()).clone().multiplyScalar(2.0);
      const smoothN=kind===3;let uoff=R()*40;
      for(let t=0;t<tiers;t++){
        const y1=t===tiers-1?H:y+(H-y)*(0.45+R()*0.25);
        prism(B,pts,y,y1,smoothN,bld,col,uoff);
        // colisión: caja del tramo
        let mnx=1e9,mnz=1e9,mxx=-1e9,mxz=-1e9;pts.forEach(p=>{mnx=Math.min(mnx,p[0]);mxx=Math.max(mxx,p[0]);mnz=Math.min(mnz,p[1]);mxz=Math.max(mxz,p[1])});
        boxes.push(mnx,0,mnz,mxx,y1,mxz);if(t===0)foot.push(mnx,mnz,mxx,mxz,H);
        // neón: banda en la cornisa y aristas verticales
        if(neonOn){
          const g=grow(pts,0.25);neonStrip(g,y1-0.9,y1-0.3,ncol,0);
          if(kind===0&&R()<0.6){for(const p of g){neonStrip(shape(0,p[0],p[1],0.45,0.45),y+0.5,y1-0.9,ncol,0)}}
        }
        if(t<tiers-1){y=y1;pts=inset(pts,0.62+R()*0.22)}
      }
      // equipo en el techo
      if(kind===0&&R()<0.8){const n=1+Math.floor(R()*3);for(let k=0;k<n;k++){const rw=2+R()*Math.min(8,w*0.3),rd=2+R()*Math.min(8,dd*0.3);
        let px=0,pz=0;pts.forEach(p=>{px+=p[0];pz+=p[1]});px/=pts.length;pz/=pts.length;
        prism(B,shape(0,px+(R()-0.5)*w*0.3,pz+(R()-0.5)*dd*0.3,rw,rd),H,H+1.5+R()*3,false,[0,9,0,0],col.clone().multiplyScalar(0.6))}}
      // antena con baliza
      if(H>110&&R()<0.7){const ah=12+R()*40;let px=0,pz=0;pts.forEach(p=>{px+=p[0];pz+=p[1]});px/=pts.length;pz/=pts.length;
        prism(B,shape(0,px,pz,0.8,0.8),H,H+ah,false,[0,9,0,0],new THREE.Color(0x333333));beacons.push(px,H+ah+0.6,pz,1,0.1,0.08,R());
        boxes.push(px-0.6,H,pz-0.6,px+0.6,H+ah,pz+0.6)}
      else if(H>60){let px=0,pz=0;pts.forEach(p=>{px+=p[0];pz+=p[1]});beacons.push(px/pts.length,H+0.6,pz/pts.length,1,0.1,0.08,R())}
      // helipuerto
      if(kind===0&&H>140&&R()<0.35&&w>20&&dd>20){let px=0,pz=0;pts.forEach(p=>{px+=p[0];pz+=p[1]});px/=pts.length;pz/=pts.length;
        const ring=shape(3,px,pz,12,12);neonStrip(ring,H+0.05,H+0.35,new THREE.Color(0xffe14a).multiplyScalar(2.2),0)}
      // anuncios holográficos en fachadas
      if(kind===0&&H>18&&R()<0.06+nn*0.28){
        const face=Math.floor(R()*4);const fw=face%2===0?w:dd;const aw=Math.min(fw*(0.35+R()*0.4),20);
        const typ=Math.floor(R()*4);const ah=typ===3?aw*(1.3+R()*1.0):aw*(0.35+R()*0.45);
        const ay=Math.min(H-ah/2-2,6+ah/2+R()*Math.max(1,H*0.6));
        if(ay-ah/2>4.5){
          const off=0.9;let p,ux,uz;
          if(face===0){p=[cx,cz-dd/2-off];ux=1;uz=0}else if(face===1){p=[cx+w/2+off,cz];ux=0;uz=1}else if(face===2){p=[cx,cz+dd/2+off];ux=-1;uz=0}else{p=[cx-w/2-off,cz];ux=0;uz=-1}
          ads.push({x:p[0],y:ay,z:p[1],ux,uz,w:aw,h:ah,seed:Math.floor(R()*997),hue:R(),typ,asp:typ===3?ah/aw:aw/ah});
          if(R()<0.5)props.push({kind:"sign",x:p[0]-ux*(aw/2+6)+(face%2?off*0:0),y:Math.max(6,ay-ah/2-5),z:p[1]-uz*(aw/2+6),face,R:R()});
        }
      }else if(kind===0&&H>10&&H<70&&R()<nn*0.5){
        const face=Math.floor(R()*4);const off=0.6;let p;
        if(face===0)p=[cx,cz-dd/2-off];else if(face===1)p=[cx+w/2+off,cz];else if(face===2)p=[cx,cz+dd/2+off];else p=[cx-w/2-off,cz];
        props.push({kind:"sign",x:p[0],y:5+R()*Math.max(1,H-14),z:p[1],face,R:R()});
      }
      // anuncio en la azotea
      if(kind===0&&H>30&&H<160&&R()<0.05+nn*0.12){
        const aw=Math.min(w,dd)*0.8,ah=aw*0.4,ax=R()<0.5;
        ads.push({x:cx,y:H+ah/2+2,z:cz,ux:ax?1:0,uz:ax?0:1,w:aw,h:ah,seed:Math.floor(R()*997),hue:R(),typ:Math.floor(R()*3),asp:aw/ah});
        prism(B,shape(0,cx,cz,1,1),H,H+2,false,[0,9,0,0],new THREE.Color(0x222222));
      }
    }
  }
  // geometría de anuncios
  let adsGeo=null;
  if(ads.length){
    const p=[],uv=[],a=[];
    for(const d of ads){
      const hx=d.ux*d.w/2,hz=d.uz*d.w/2,y0=d.y-d.h/2,y1=d.y+d.h/2;
      const V=[[d.x-hx,y0,d.z-hz,0,0],[d.x+hx,y0,d.z+hz,1,0],[d.x+hx,y1,d.z+hz,1,1],[d.x-hx,y0,d.z-hz,0,0],[d.x+hx,y1,d.z+hz,1,1],[d.x-hx,y1,d.z-hz,0,1]];
      for(const v of V){p.push(v[0],v[1],v[2]);uv.push(v[3],v[4]);a.push(d.seed,d.hue,d.typ,d.asp)}
    }
    adsGeo=new THREE.BufferGeometry();adsGeo.setAttribute("position",new THREE.Float32BufferAttribute(p,3));adsGeo.setAttribute("uv",new THREE.Float32BufferAttribute(uv,2));adsGeo.setAttribute("aAd",new THREE.Float32BufferAttribute(a,4));adsGeo.computeBoundingSphere();
  }
  let bGeo=null;
  if(beacons.length){
    const p=[],c=[],ph=[];for(let i=0;i<beacons.length;i+=7){p.push(beacons[i],beacons[i+1],beacons[i+2]);c.push(beacons[i+3],beacons[i+4],beacons[i+5]);ph.push(beacons[i+6])}
    bGeo=new THREE.BufferGeometry();bGeo.setAttribute("position",new THREE.Float32BufferAttribute(p,3));bGeo.setAttribute("color",new THREE.Float32BufferAttribute(c,3));bGeo.setAttribute("aPh",new THREE.Float32BufferAttribute(ph,1));bGeo.computeBoundingSphere();
  }
  return {b:B.geo(),n:N.geo(),t:T.geo(),ads:adsGeo,bea:bGeo,boxes:new Float32Array(boxes),foot,props};
}

/* --- administrador de chunks --- */
export class City{
  constructor(scene,assets){
    this.scene=scene;this.assets=assets;this.chunks=new Map();this.radius=3;this.queue=[];
    this.mat={b:buildingMaterial(),n:neonMaterial(),t:treeMaterial(),ads:adsMaterial(scene),bea:beaconMaterial(scene)};
    this.group=new THREE.Group();scene.add(this.group);
    this.pools={};this.m4=new THREE.Matrix4();
    this.castShadow=false;
  }
  setPools(pools){this.pools=pools}
  key(i,j){return i+","+j}
  update(pos,budget=2){
    const ci=Math.floor(pos.x/CHUNK),cj=Math.floor(pos.z/CHUNK),R=this.radius;
    const want=new Set();const todo=[];
    for(let j=cj-R;j<=cj+R;j++)for(let i=ci-R;i<=ci+R;i++){
      const dx=i-ci,dz=j-cj;if(dx*dx+dz*dz>R*R+1)continue;
      const k=this.key(i,j);want.add(k);if(!this.chunks.has(k))todo.push([dx*dx+dz*dz,i,j,k]);
    }
    for(const [k,c] of this.chunks)if(!want.has(k))this.unload(k,c);
    todo.sort((a,b)=>a[0]-b[0]);
    for(let n=0;n<Math.min(budget,todo.length);n++){const [,i,j,k]=todo[n];this.load(i,j,k)}
    return todo.length-Math.min(budget,todo.length);
  }
  load(i,j,k){
    const g=genChunk(i,j);const objs=[];
    const add=(geo,mat,shadow,points)=>{if(!geo)return;const m=points?new THREE.Points(geo,mat):new THREE.Mesh(geo,mat);
      if(shadow){m.castShadow=this.castShadow;m.receiveShadow=true}m.matrixAutoUpdate=false;this.group.add(m);objs.push(m)};
    add(g.b,this.mat.b,true);add(g.n,this.mat.n);add(g.t,this.mat.t,true);add(g.ads,this.mat.ads);add(g.bea,this.mat.bea,false,true);
    // modelos de Sketchfab
    const boxes=Array.from(g.boxes);
    for(const p of g.props){
      const pool=this.pools[p.kind];if(!pool)continue;const m=this.m4;
      if(p.kind==="pyramid"){
        const s=PYR.w/Math.max(pool.box.max.x-pool.box.min.x,pool.box.max.z-pool.box.min.z);
        m.compose(new THREE.Vector3(PYR.x,-pool.box.min.y*s,PYR.z),new THREE.Quaternion(),new THREE.Vector3(s,s,s));pool.add(k,m);
        const H=(pool.box.max.y-pool.box.min.y)*s;PYR.h=H;
        for(let t=0;t<8;t++){const f=1-t/8,hw=PYR.w/2*f*0.98;boxes.push(PYR.x-hw,0,PYR.z-hw,PYR.x+hw,H*(t+1)/8,PYR.z+hw)}
      }else if(p.kind==="g1"||p.kind==="tower"){
        const bx=pool.box;const s=p.h/(bx.max.y-bx.min.y);const fw=Math.max(bx.max.x-bx.min.x,bx.max.z-bx.min.z)*s;const sc=fw>p.w?s*p.w/fw:s;
        m.compose(new THREE.Vector3(p.x,-bx.min.y*sc,p.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),p.rot),new THREE.Vector3(sc,sc,sc));pool.add(k,m);
        const hx=(p.rot%Math.PI?bx.max.z-bx.min.z:bx.max.x-bx.min.x)*sc*0.42,hz=(p.rot%Math.PI?bx.max.x-bx.min.x:bx.max.z-bx.min.z)*sc*0.42;
        boxes.push(p.x-hx,0,p.z-hz,p.x+hx,(bx.max.y-bx.min.y)*sc*0.97,p.z+hz);
        g.foot.push(p.x-hx,p.z-hz,p.x+hx,p.z+hz,p.h);
      }else if(p.kind==="sign"){
        const pk=p.R<0.55?"neonset":"neonletters";const sp=this.pools[pk];if(!sp)continue;
        const bx=sp.box;const target=pk==="neonset"?16+p.R*10:9+p.R*6;const s=target/(bx.max.x-bx.min.x);
        const rot=[Math.PI,Math.PI/2,0,-Math.PI/2][p.face];
        m.compose(new THREE.Vector3(p.x,p.y,p.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),rot),new THREE.Vector3(s,s,s));sp.add(k,m);
      }
    }
    this.chunks.set(k,{objs,boxes:new Float32Array(boxes),foot:g.foot,i,j});
  }
  unload(k,c){
    c.objs.forEach(o=>{this.group.remove(o);o.geometry.dispose()});
    Object.values(this.pools).forEach(p=>p.release(k));
    this.chunks.delete(k);
  }
  setShadows(on){this.castShadow=on;for(const c of this.chunks.values())c.objs.forEach(o=>{if(o.receiveShadow)o.castShadow=on})}
  /* cajas cercanas a un punto (chunk actual y vecinos) */
  *boxesNear(x,z){
    const ci=Math.floor(x/CHUNK),cj=Math.floor(z/CHUNK);
    for(let j=cj-1;j<=cj+1;j++)for(let i=ci-1;i<=ci+1;i++){const c=this.chunks.get(this.key(i,j));if(c)yield c.boxes}
  }
  /* altura de lo construido en (x,z) */
  heightAt(x,z){let h=0;for(const b of this.boxesNear(x,z))for(let k=0;k<b.length;k+=6)if(x>=b[k]&&x<=b[k+3]&&z>=b[k+2]&&z<=b[k+5])h=Math.max(h,b[k+4]);return h}
  /* segmento contra cajas: devuelve fracción t del primer impacto (para la cámara) */
  segment(a,b){
    let tmin=1;const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z;
    for(const bx of this.boxesNear(a.x,a.z))for(let k=0;k<bx.length;k+=6){
      let t0=0,t1=tmin;
      for(let ax=0;ax<3;ax++){
        const o=ax===0?a.x:ax===1?a.y:a.z,d=ax===0?dx:ax===1?dy:dz,mn=bx[k+ax],mx=bx[k+3+ax];
        if(Math.abs(d)<1e-6){if(o<mn||o>mx){t0=2;break}continue}
        let ta=(mn-o)/d,tb=(mx-o)/d;if(ta>tb){const q=ta;ta=tb;tb=q}
        t0=Math.max(t0,ta);t1=Math.min(t1,tb);if(t0>t1)break;
      }
      if(t0<=t1&&t0<tmin)tmin=t0;
    }
    return tmin;
  }
}

/* --- suelo infinito: calles, banquetas, cruces, luz de faroles y tráfico de calle dibujado en el shader --- */
export class Ground{
  constructor(scene){
    this.N=128;this.data=new Uint8Array(this.N*this.N*4);
    this.tex=new THREE.DataTexture(this.data,this.N,this.N,THREE.RGBAFormat);this.tex.magFilter=this.tex.minFilter=THREE.NearestFilter;
    this.origin=new THREE.Vector2(1e9,1e9);this.uOrigin={value:new THREE.Vector2()};
    const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.6,metalness:0.0,envMapIntensity:1});
    const self=this;
    m.onBeforeCompile=s=>{
      Object.assign(s.uniforms,{uTime:U.uTime,uDay:U.uDay,uWet:U.uWet,uLit:U.uLit,uBlocks:{value:self.tex},uOrigin:self.uOrigin});
      s.vertexShader=s.vertexShader.replace("#include <common>","#include <common>\nvarying vec3 vWp;").replace("#include <worldpos_vertex>","#include <worldpos_vertex>\nvWp=(modelMatrix*vec4(transformed,1.0)).xyz;");
      s.fragmentShader=s.fragmentShader.replace("#include <common>",`#include <common>
        uniform float uTime,uDay,uWet,uLit;uniform sampler2D uBlocks;uniform vec2 uOrigin;varying vec3 vWp;${PAL}
        float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y);}
        float gR;vec3 gE;
        /* luces de autos en un carril: s = posición lateral, q = posición a lo largo, dir = sentido */
        vec3 laneCars(float s,float q,float lane,float road,float dir,float spd){
          float c=s-lane;if(abs(c)>1.2)return vec3(0.);
          float L=16.+hh(vec2(lane,road))*14.;float qq=q-dir*uTime*spd;float cell=floor(qq/L);float f=fract(qq/L)*L;
          if(hh(vec2(cell,lane+road*7.))>0.55)return vec3(0.);
          float car=step(f,4.6);float side=step(0.45,abs(c))*step(abs(c),0.95);
          float front=dir>0.?smoothstep(4.6,4.2,f)*step(4.0,f):smoothstep(0.,0.4,f)*step(f,0.6);
          float back=dir>0.?smoothstep(0.,0.4,f)*step(f,0.6):smoothstep(4.6,4.2,f)*step(4.0,f);
          vec3 col=vec3(1.,.95,.85)*front*side*3.5+vec3(1.,.08,.05)*back*side*2.6;
          col+=vec3(1.,.9,.75)*exp(-pow((dir>0.?f-6.5:f+2.)*0.35,2.))*step(abs(c),1.2)*0.35*step(f,8.);
          return col*car+(dir>0.?vec3(1.,.9,.7):vec3(1.,.1,.05))*0.0;
        }`)
      .replace("#include <color_fragment>",`#include <color_fragment>
        {
          vec2 w=vWp.xz;vec2 bc=floor(w/120.);vec2 l=w-bc*120.;vec2 dr=min(l,120.-l);
          float rx=step(dr.x,12.),rz=step(dr.y,12.);float road=max(rx,rz),inter=rx*rz;
          vec4 bi=texture2D(uBlocks,(bc-uOrigin+0.5)/128.);float typ=floor(bi.r*255.+0.5);
          float n=vn(w*0.35)*0.5+vn(w*2.1)*0.5;
          vec3 asph=vec3(0.032,0.034,0.04)*(0.8+0.4*n);
          vec3 side=vec3(0.10,0.098,0.094)*(0.85+0.3*n);
          vec2 tl=abs(fract(w/1.5)-0.5);side*=0.8+0.2*step(0.03,min(tl.x,tl.y));
          vec3 lot=vec3(0.075,0.074,0.078)*(0.85+0.3*n);vec2 tg=abs(fract(w/4.)-0.5);lot*=0.85+0.15*step(0.02,min(tg.x,tg.y));
          vec3 grass=vec3(0.03,0.062,0.035)*(0.6+0.8*vn(w*0.6));
          float path=step(abs(fract((w.x+w.y)/40.)-0.5),0.04)+step(abs(fract((w.x-w.y)/40.)-0.5),0.04);
          vec3 park=mix(grass,side,clamp(path,0.,1.));
          vec3 blk=typ>0.5&&typ<1.5?park:lot;
          // perfil: asfalto |s|<9, banqueta 9..12
          float s=rx>0.5?(l.x<60.?l.x:l.x-120.):(l.y<60.?l.y:l.y-120.);float q=rx>0.5?w.y:w.x;
          float sx=(l.x<60.?l.x:l.x-120.),sz=(l.y<60.?l.y:l.y-120.);
          float isAs=road*step(min(rx>0.5?abs(sx):99.,rz>0.5?abs(sz):99.),9.);
          vec3 c=mix(blk,side,road);c=mix(c,asph,isAs);
          gE=vec3(0.);
          float mark=0.;
          if(isAs>0.5&&inter<0.5){
            float as=abs(s);
            mark+=step(abs(as-4.5),0.09)*step(0.5,fract(q/9.));      // carriles
            mark+=step(abs(as-8.6),0.1);                              // orillas
            float cen=step(abs(as-0.22),0.06);gE+=vec3(.1,.9,1.)*cen*0.22;mark+=cen*0.6;
            // paso peatonal al llegar al cruce
            float dq=rx>0.5?dr.y:dr.x;mark+=step(12.,dq)*step(dq,15.5)*step(0.5,fract(s/1.2));
          }
          c=mix(c,vec3(0.55),clamp(mark,0.,1.)*0.8);
          // charcos y humedad
          float pud=smoothstep(0.55,0.68,vn(w*0.07)*0.6+vn(w*0.31)*0.4)*uWet;
          c*=mix(1.,0.55,uWet*0.6);c*=mix(1.,0.4,pud);
          gR=mix(mix(0.85,0.32,uWet),0.035,pud);gR=mix(gR,0.6,typ>0.5&&typ<1.5&&road<0.5?1.:0.);
          diffuseColor.rgb=c;
          // faroles cada 30 m en ambas banquetas
          float night=uLit;
          if(road>0.5){
            float lq=fract(q/30.)*30.-15.;float ls=abs(s)-10.6;
            float pool=exp(-(lq*lq+ls*ls*1.6)/40.);
            vec3 lc=hh(bc+vec2(rx,3.))<0.5?vec3(1.,.62,.3):vec3(.75,.85,1.);
            gE+=lc*pool*0.55*night*(1.+pud*1.5);
            gE+=lc*exp(-(lq*lq+ls*ls)/0.5)*2.*night;
          }
          // tráfico de calle
          if(isAs>0.5){
            float rid=rx>0.5?bc.x+floor(l.x/60.):bc.y+floor(l.y/60.)+500.;
            gE+=laneCars(s,q,2.25,rid,1.,14.)+laneCars(s,q,6.75,rid,1.,11.)+laneCars(s,q,-2.25,rid,-1.,14.)+laneCars(s,q,-6.75,rid,-1.,11.);
          }
          // brillo de los locales sobre la banqueta
          if(road>0.5&&isAs<0.5){gE+=neonPal(hh(floor(vec2(q/9.,s>0.?1.:0.)+bc*3.)))*0.06*night;}
          gE*=mix(1.,0.15,uDay);
        }`)
      .replace("#include <roughnessmap_fragment>","#include <roughnessmap_fragment>\nroughnessFactor=gR;")
      .replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\ntotalEmissiveRadiance+=gE;");
    };
    this.mesh=new THREE.Mesh(new THREE.PlaneGeometry(9000,9000).rotateX(-Math.PI/2),m);this.mesh.receiveShadow=true;this.mesh.renderOrder=-1;
    scene.add(this.mesh);
  }
  update(pos){
    const bx=Math.floor(pos.x/BLOCK),bz=Math.floor(pos.z/BLOCK);
    this.mesh.position.set(Math.round(pos.x/BLOCK)*BLOCK,0,Math.round(pos.z/BLOCK)*BLOCK);
    if(Math.abs(bx-this.origin.x-64)<24&&Math.abs(bz-this.origin.y-64)<24)return;
    this.origin.set(bx-64,bz-64);this.uOrigin.value.copy(this.origin);
    for(let j=0;j<this.N;j++)for(let i=0;i<this.N;i++){const b=blockInfo(this.origin.x+i,this.origin.y+j);const o=(j*this.N+i)*4;this.data[o]=b.type;this.data[o+1]=Math.min(255,b.d*200)|0;this.data[o+2]=b.h*255|0;this.data[o+3]=255}
    this.tex.needsUpdate=true;
  }
}
