/* Materiales PBR en TSL (nodos de Three.js r186). Todas las superficies tienen mapa de color, rugosidad/metal y
   normal; la calle además tiene charcos (rugosidad casi cero) que se reflejan con SSR. */
import * as THREE from "three/webgpu";
import {texture,uv,positionWorld,vec2,vec3,float,mix,smoothstep,mx_fractal_noise_float,mx_noise_float,normalMap,
  uniform,mrt,roughness,fract,floor,abs,step,max,min,hash,select,color,time,clamp,sin,length} from "three/tsl";

export const W={wet:uniform(1),night:uniform(0),rain:uniform(1),time:uniform(0)};
export const GRID={BX:150,BZ:110,AV:26,ST:20,WALK:4.5,CURB:0.16};

const L=new THREE.TextureLoader();
const tex=(f,srgb=false)=>{const t=L.load("textures/"+f);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t};

let T=null;
export function loadTextures(){
  T={asphC:tex("asph_c.webp",true),asphMR:tex("asph_mr.webp"),asphN:tex("asph_n.webp"),
    lane:tex("lane_c.webp",true),cross:tex("cross_c.webp",true),walkC:tex("walk_c.webp",true),walkN:tex("walk_n.webp"),
    cobC:tex("cobble_c.webp",true),cobN:tex("cobble_n.webp"),
    fac:[0,1,2,3].map(i=>({c:tex(`facade${i}_c.webp`,true),mr:tex(`facade${i}_mr.webp`),n:tex(`facade${i}_n.webp`)}))};
  return T;
}

/* reflejo para SSR: el SSR de Three pondera por "metalness"; aquí cada material escribe su propia reflectividad */
const reflect=(k)=>mrt({metalrough:vec2(k,roughness)});

/* --- calle: asfalto escaneado + charcos procedurales + marcas viales en coordenadas del mundo --- */
export function roadMaterial(){
  const m=new THREE.MeshStandardNodeMaterial();
  const wp=positionWorld.xz;
  const uvA=wp.div(5.5);
  const base=texture(T.asphC,uvA).rgb;
  const mr=texture(T.asphMR,uvA.mul(0.37));
  // charcos: ruido de baja frecuencia + el mapa de humedad del escaneo
  const n1=mx_fractal_noise_float(vec3(wp.mul(0.045),0),3,2.0,0.5);
  const n2=mx_noise_float(vec3(wp.mul(0.35),1.7));
  const pud=smoothstep(0.18,0.34,n1.add(n2.mul(0.08)).add(mr.g.oneMinus().mul(0.25))).mul(W.wet);
  // marcas viales: avenidas a lo largo de Z (x = i*BX) y calles a lo largo de X (z = j*BZ)
  const lx=wp.x.sub(floor(wp.x.div(GRID.BX).add(0.5)).mul(GRID.BX));   // distancia lateral a la avenida
  const lz=wp.y.sub(floor(wp.y.div(GRID.BZ).add(0.5)).mul(GRID.BZ));
  const inAv=step(abs(lx),GRID.AV/2-GRID.WALK),inSt=step(abs(lz),GRID.ST/2-GRID.WALK);
  const inter=inAv.mul(inSt);
  const dash=(s,q,len,gap,w)=>step(abs(s),w).mul(step(fract(q.div(len+gap)),len/(len+gap)));
  const avLines=dash(abs(lx).sub(4.1),wp.y,3,6,0.07).add(step(abs(abs(lx).sub(0.18)),0.07)).add(step(abs(abs(lx).sub(8.3)),0.08));
  const stLines=dash(abs(lz).sub(0.0),wp.x,3,6,0.07).add(step(abs(abs(lz).sub(5.3)),0.08));
  // paso peatonal: la banda de banqueta de una vía continúa pintada a través de la otra
  const band=(q,a,b)=>step(a+0.4,abs(q)).mul(step(abs(q),b-0.4));
  const cross=inAv.mul(band(lz,GRID.ST/2-GRID.WALK,GRID.ST/2)).mul(step(0.5,fract(lx.div(1.1))))
    .add(inSt.mul(band(lx,GRID.AV/2-GRID.WALK,GRID.AV/2)).mul(step(0.5,fract(lz.div(1.1)))));
  const marks=clamp(avLines.mul(inAv).mul(inSt.oneMinus()).add(stLines.mul(inSt).mul(inAv.oneMinus())).add(cross),0,1);
  const worn=mx_noise_float(vec3(wp.mul(1.3),3.1)).mul(0.5).add(0.5);
  const markCol=mix(vec3(0.62,0.62,0.6),vec3(0.75,0.55,0.15),step(abs(lx),0.4).mul(inAv).mul(inSt.oneMinus()));
  const wetDark=mix(1,0.55,W.wet);
  m.colorNode=mix(base.mul(vec3(0.62,0.66,0.66)).mul(wetDark),markCol.mul(wetDark),marks.mul(smoothstep(0.15,0.55,worn))).mul(mix(1,0.7,pud));
  const r0=mix(mr.g.mul(0.5).add(0.45),mr.g.mul(0.35).add(0.18),W.wet);
  m.roughnessNode=mix(r0,float(0.02),pud);
  m.metalnessNode=float(0);
  m.normalNode=normalMap(texture(T.asphN,uvA),vec2(mix(0.9,0.05,pud)));
  m.mrtNode=reflect(mix(float(0.35).mul(W.wet),float(1),pud));
  return m;
}

/* banqueta y bordillo: losas de concreto con juntas */
export function walkMaterial(){
  const m=new THREE.MeshStandardNodeMaterial();
  const wp=positionWorld.xz.add(vec2(positionWorld.y.mul(0.0)));
  const u=wp.div(3.2);
  const c=texture(T.walkC,u).rgb;
  const n=mx_fractal_noise_float(vec3(wp.mul(0.12),5),2,2,0.5);
  const pud=smoothstep(0.25,0.4,n).mul(W.wet).mul(0.8);
  m.colorNode=c.mul(vec3(0.5,0.53,0.53)).mul(mix(1,0.6,W.wet)).mul(mix(1,0.8,pud));
  m.roughnessNode=mix(mix(0.85,0.5,W.wet),float(0.06),pud);
  m.metalnessNode=float(0);
  m.normalNode=normalMap(texture(T.walkN,u),vec2(0.8));
  m.mrtNode=reflect(mix(float(0.2).mul(W.wet),float(0.9),pud));
  return m;
}

/* fachada fotográfica (Hong Kong) para megatorres: uv en metros (u = perímetro, v = altura) */
export function facadeMaterial(i,tile=16){
  const f=T.fac[i];const m=new THREE.MeshStandardNodeMaterial();
  const u=uv().div(tile);
  const c=texture(f.c,u).rgb,mr=texture(f.mr,u);
  // ventanas encendidas de noche: celdas oscuras del mapa (vidrio) con hash por celda
  const cell=floor(uv().div(vec2(3.2,3.4)));
  const on=step(hash(cell.x.mul(17.0).add(cell.y.mul(131.0))),0.09);
  const warm=mix(vec3(1.0,0.62,0.32),vec3(0.55,0.85,1.0),step(0.7,hash(cell.x.add(cell.y.mul(7.0)))));
  m.colorNode=c.mul(vec3(0.82,0.9,0.88)).mul(mix(1,0.8,W.wet));
  m.roughnessNode=mr.g.mul(mix(1,0.75,W.wet));
  m.metalnessNode=mr.b;
  m.normalNode=normalMap(texture(f.n,u),vec2(1.2));
  m.emissiveNode=c.mul(warm).mul(on).mul(mr.b.mul(4).clamp(0,1)).mul(mix(0.6,3.0,W.night));
  m.mrtNode=reflect(mr.b.mul(0.8).add(0.08));
  return m;
}

/* modelos de Sketchfab: pasar a materiales de nodos y ajustar lluvia */
export function tuneModel(root,{wetK=1,reflectK=null,emissive=null}={}){
  root.traverse(o=>{
    if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true;
    const ms=Array.isArray(o.material)?o.material:[o.material];
    ms.forEach(m=>{
      if(m.roughness!==undefined)m.roughness=Math.max(0.04,m.roughness*(1-0.25*wetK));
      if(emissive&&m.map&&emissive.test(m.name||"")){m.emissiveMap=m.map;m.emissive=new THREE.Color(1,1,1);m.emissiveIntensity=2.5}
    });
  });
}
