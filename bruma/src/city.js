/* Ciudad: rejilla de avenidas (a lo largo de Z) y calles (a lo largo de X). Cada manzana se genera con una semilla
   fija y se carga/descarga alrededor del auto. Edificios = modelos de Sketchfab instanciados (frente hacia la calle)
   y megatorres escalonadas revestidas con fachadas fotográficas. */
import * as THREE from "three/webgpu";
import {GRID,facadeMaterial,walkMaterial} from "./materials.js";

export function hash(x,y,s=0){let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,982451653)+7331)|0;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296}
export function rng(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/4294967296}}
const {BX,BZ,AV,ST,WALK,CURB}=GRID;

/* bloque (i,j): rectángulo construible (sin calles) */
export function blockRect(i,j){return {x0:i*BX+AV/2,x1:(i+1)*BX-AV/2,z0:j*BZ+ST/2,z1:(j+1)*BZ-ST/2}}
/* altura del piso: 0 en la calle, CURB sobre banquetas y manzanas */
export function groundHeight(x,z){
  const lx=x-Math.round(x/BX)*BX,lz=z-Math.round(z/BZ)*BZ;
  return (Math.abs(lx)>AV/2-WALK&&Math.abs(lz)>ST/2-WALK)?CURB:0;
}

/* --- catálogo de edificios de Sketchfab ---
   h: altura objetivo (m) o rango; el modelo se normaliza con su frente hacia +Z y la base en y=0 */
export const KIT={
  hk_proc:{h:[26,34],rot:0},
  asian_tower:{h:[40,52],rot:0},
  soviet:{h:[28,36],rot:Math.PI/2},
  cyber_apart:{h:[30,38],rot:0},
  asian_shops:{h:[6.2,6.4],rot:0},
  atlanta:{h:[230,330],rot:0,giant:true},
  london:{h:[220,320],rot:0,giant:true},
  brutal_tower:{h:[380,560],rot:0,giant:true},
  lamp:{h:[8.2,8.2],rot:0},
};

export class Pool{
  constructor(scene,parts,cap){
    this.cap=cap;this.box=new THREE.Box3();parts.forEach(p=>{p.geometry.computeBoundingBox();this.box.union(p.geometry.boundingBox)});
    this.meshes=parts.map(p=>{const m=new THREE.InstancedMesh(p.geometry,p.material,cap);m.count=0;m.frustumCulled=false;m.castShadow=true;m.receiveShadow=true;scene.add(m);return m});
    this.free=[];this.top=0;this.owner=new Map();this.zero=new THREE.Matrix4().makeScale(0,0,0);
  }
  add(key,m4){
    const i=this.free.length?this.free.pop():this.top<this.cap?this.top++:-1;if(i<0)return -1;
    for(const m of this.meshes){m.setMatrixAt(i,m4);m.count=Math.max(m.count,this.top);m.instanceMatrix.needsUpdate=true}
    if(!this.owner.has(key))this.owner.set(key,[]);this.owner.get(key).push(i);return i;
  }
  release(key){const l=this.owner.get(key);if(!l)return;for(const i of l){for(const m of this.meshes){m.setMatrixAt(i,this.zero);m.instanceMatrix.needsUpdate=true}this.free.push(i)}this.owner.delete(key)}
}

/* megatorre escalonada: cajas con uv en metros, cornisas y base */
function megaGeo(cx,cz,w,d,H,R){
  const pos=[],nrm=[],uvs=[];let y=0;let tw=w,td=d;
  const tiers=H>140?2+Math.floor(R()*3):1;
  const box=(x,z,W,D,y0,y1,u0)=>{
    const P=[[x-W/2,z-D/2],[x+W/2,z-D/2],[x+W/2,z+D/2],[x-W/2,z+D/2]];let u=u0;
    for(let k=0;k<4;k++){const a=P[k],b=P[(k+1)%4];const L=Math.hypot(b[0]-a[0],b[1]-a[1]);const nx=(b[1]-a[1])/L,nz=-(b[0]-a[0])/L;
      const v=[[a[0],y0,a[1],u,y0],[b[0],y0,b[1],u+L,y0],[b[0],y1,b[1],u+L,y1],[a[0],y0,a[1],u,y0],[b[0],y1,b[1],u+L,y1],[a[0],y1,a[1],u,y1]];
      // orientar hacia afuera
      // el orden a0,b0,b1 da normal geométrica -n; se invierte cuando n ya apunta hacia afuera
      const cxv=(a[0]+b[0])/2-x,czv=(a[1]+b[1])/2-z;const out=nx*cxv+nz*czv>=0;
      (out?[v[0],v[2],v[1],v[3],v[5],v[4]]:v).forEach(p=>{pos.push(p[0],p[1],p[2]);nrm.push(out?nx:-nx,0,out?nz:-nz);uvs.push(p[3],p[4])});u+=L}
    // techo
    const t=[[P[0],P[2],P[1]],[P[0],P[3],P[2]]];t.forEach(tr=>tr.forEach(p=>{pos.push(p[0],y1,p[1]);nrm.push(0,1,0);uvs.push(p[0]*0.3,p[1]*0.3)}));
  };
  for(let t=0;t<tiers;t++){
    const y1=t===tiers-1?H:y+(H-y)*(0.4+R()*0.25);
    box(cx,cz,tw,td,y,y1,R()*50);
    box(cx,cz,tw+0.8,td+0.8,y1-1.2,y1,0); // cornisa
    y=y1;tw*=0.7+R()*0.18;td*=0.7+R()*0.18;
  }
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(nrm,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
  return g;
}

export class City{
  constructor(scene,pools){
    this.scene=scene;this.pools=pools;this.blocks=new Map();this.radius=520;
    this.facMats=new URLSearchParams(location.search).has('nofac')?[0,1,2,3].map(()=>new THREE.MeshStandardNodeMaterial({color:0x777777})):[0,1,2,3].map(i=>facadeMaterial(i,i===3?14:18));
    this.slabs=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new URLSearchParams(location.search).has('nowalk')?new THREE.MeshStandardNodeMaterial({color:0x555555}):walkMaterial(),600);this.slabs.count=0;this.slabs.receiveShadow=true;this.slabs.frustumCulled=false;scene.add(this.slabs);
    this.slabFree=[];this.slabTop=0;this.lamps=[];this.m4=new THREE.Matrix4();this.q=new THREE.Quaternion();this.v=new THREE.Vector3();this.s=new THREE.Vector3();
  }
  key(i,j){return i+","+j}
  /* alrededor de la cámara; genera pocas manzanas por cuadro para no trabar */
  update(p,budget=2){
    const r=this.radius,i0=Math.floor((p.x-r)/BX),i1=Math.floor((p.x+r)/BX),j0=Math.floor((p.z-r)/BZ),j1=Math.floor((p.z+r)/BZ);
    const want=new Set();const todo=[];
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const cx=(i+0.5)*BX,cz=(j+0.5)*BZ;const d=Math.hypot(cx-p.x,cz-p.z);if(d>r+80)continue;
      const k=this.key(i,j);want.add(k);if(!this.blocks.has(k))todo.push([d,i,j,k])}
    for(const [k,b] of this.blocks)if(!want.has(k))this.unload(k,b);
    todo.sort((a,b)=>a[0]-b[0]);
    for(let n=0;n<Math.min(budget,todo.length);n++)this.load(todo[n][1],todo[n][2],todo[n][3]);
    return todo.length-Math.min(budget,todo.length);
  }
  place(key,kind,x,z,rot,h,boxes,front){
    const pool=this.pools[kind];if(!pool)return null;const b=pool.box;
    const s=h/(b.max.y-b.min.y);const r=rot+KIT[kind].rot;
    this.q.setFromAxisAngle(new THREE.Vector3(0,1,0),r);this.v.set(x,CURB-b.min.y*s,z);this.s.set(s,s,s);
    this.m4.compose(this.v,this.q,this.s);pool.add(key,this.m4);
    // caja de colisión (rotaciones de 90°)
    const w=(b.max.x-b.min.x)*s,d=(b.max.z-b.min.z)*s;const sw=Math.abs(Math.sin(r))>0.5;
    const hx=(sw?d:w)/2,hz=(sw?w:d)/2;
    const ox=(b.max.x+b.min.x)/2*s,oz=(b.max.z+b.min.z)/2*s;const c=Math.cos(r),sn=Math.sin(r);
    const cx=x+ox*c+oz*sn,cz=z-ox*sn+oz*c;
    boxes.push(cx-hx,cz-hz,cx+hx,cz+hz,h);
    return {hx,hz,cx,cz};
  }
  /* tamaño del modelo (ancho a lo largo de la calle, fondo hacia adentro) para una altura dada */
  dims(kind,h){const b=this.pools[kind].box;const s=h/(b.max.y-b.min.y);const sw=Math.abs(Math.sin(KIT[kind].rot))>0.5;
    const w=(b.max.x-b.min.x)*s,d=(b.max.z-b.min.z)*s;return sw?{w:d,d:w}:{w,d}}
  load(i,j,key){
    const R=rng(Math.floor(hash(i,j,1)*4294967296));const rc=blockRect(i,j);
    const W=rc.x1-rc.x0,D=rc.z1-rc.z0,cx=(rc.x0+rc.x1)/2,cz=(rc.z0+rc.z1)/2;
    const boxes=[];const meshes=[];const lamps=[];const peds=[];
    // losa de banqueta
    const si=this.slabFree.length?this.slabFree.pop():this.slabTop++;
    this.m4.compose(this.v.set(cx,CURB/2,cz),this.q.identity(),this.s.set(W,CURB,D));this.slabs.setMatrixAt(si,this.m4);this.slabs.count=Math.max(this.slabs.count,this.slabTop);this.slabs.instanceMatrix.needsUpdate=true;
    const main=Math.abs(i)<=0||i===-1; // la avenida x=0 es el cañón principal
    const r=R();const type=r<(main?0.45:0.3)?"mega":r<(main?0.62:0.45)?"giant":"dense";
    const ix0=rc.x0+WALK,ix1=rc.x1-WALK,iz0=rc.z0+WALK,iz1=rc.z1-WALK;
    // fila de locales en planta baja a lo largo de los lados que dan a avenidas
    const shopsRow=(x,z0,z1,face)=>{const sd=this.dims("asian_shops",6.3);let z=z0;
      while(z+sd.w<=z1+0.01){this.place(key,"asian_shops",x+(face>0?-sd.d/2:sd.d/2),z+sd.w/2,face>0?Math.PI/2:-Math.PI/2,6.3,boxes);z+=sd.w}};
    if(type==="mega"){
      const H=Math.round(120+Math.pow(R(),1.4)*(main?420:300));
      const g=megaGeo(cx,cz,W-2*WALK-(R()*6),D-2*WALK-(R()*6),H,R);
      const m=new THREE.Mesh(g,this.facMats[Math.floor(R()*4)]);m.castShadow=m.receiveShadow=true;m.position.y=CURB;m.matrixAutoUpdate=false;m.updateMatrix();this.scene.add(m);meshes.push(m);
      boxes.push(ix0,iz0,ix1,iz1,H);
    }else if(type==="giant"){
      const kinds=["atlanta","london","brutal_tower"];const kind=kinds[Math.floor(R()*3)];const kh=KIT[kind].h;let h=kh[0]+R()*(kh[1]-kh[0]);
      let dm=this.dims(kind,h);const k=Math.min(1,(ix1-ix0-12)/dm.w,(iz1-iz0-4)/dm.d);h*=k;
      this.place(key,kind,cx,cz,Math.floor(R()*4)*Math.PI/2,h,boxes);
      shopsRow(ix0,iz0,iz1,-1);shopsRow(ix1,iz0,iz1,1);
    }else{
      // perímetro: edificios de frente a la calle, sin traslapes
      const kinds=["hk_proc","asian_tower","asian_tower","soviet","soviet","cyber_apart","cyber_apart"];
      const edge=(along0,along1,fixed,dirX,face)=>{ // dirX: el lado corre a lo largo de x; face: hacia dónde mira el frente
        let a=along0;
        while(a<along1-6){
          const kind=kinds[Math.floor(R()*kinds.length)];const kh=KIT[kind].h;const h=kh[0]+R()*(kh[1]-kh[0]);const dm=this.dims(kind,h);
          if(a+dm.w>along1+1){a+=2;continue}
          const mid=a+dm.w/2;
          if(dirX){const z=fixed+(face>0?-dm.d/2:dm.d/2);this.place(key,kind,mid,z,face>0?0:Math.PI,h,boxes)}
          else{const x=fixed+(face>0?-dm.d/2:dm.d/2);this.place(key,kind,x,mid,face>0?Math.PI/2:-Math.PI/2,h,boxes)}
          a+=dm.w+0.5+R()*1.5;
        }
      };
      edge(ix0,ix1,iz1,true,1);edge(ix0,ix1,iz0,true,-1);
      edge(iz0+22,iz1-22,ix1,false,1);edge(iz0+22,iz1-22,ix0,false,-1);
      // centro: megatorre angosta que se pierde en la niebla
      if(R()<0.7){const H=Math.round(90+R()*220);const g=megaGeo(cx,cz,Math.min(40,W-70),Math.min(30,D-50),H,R);
        if(W-70>12&&D-50>10){const m=new THREE.Mesh(g,this.facMats[Math.floor(R()*4)]);m.castShadow=m.receiveShadow=true;m.position.y=CURB;m.matrixAutoUpdate=false;m.updateMatrix();this.scene.add(m);meshes.push(m);
          boxes.push(cx-Math.min(40,W-70)/2,cz-Math.min(30,D-50)/2,cx+Math.min(40,W-70)/2,cz+Math.min(30,D-50)/2,H)}}
    }
    // faroles a lo largo de las banquetas que dan a las avenidas, cada 22 m
    for(const [x,face] of [[rc.x0+0.9,-1],[rc.x1-0.9,1]])for(let z=rc.z0+8;z<rc.z1-4;z+=30){
      this.pools.lamp&&this.place(key,"lamp",x,z,face>0?Math.PI/2:-Math.PI/2,8.2,[]);
      lamps.push({x:x-face*1.6,y:7.9,z,face});boxes.push(x-0.2,z-0.2,x+0.2,z+0.2,8);
    }
    // gente: puntos de paso en la banqueta de la avenida
    for(const x of [rc.x0+2.4,rc.x1-2.4])if(R()<0.8)peds.push({x,z0:rc.z0+3,z1:rc.z1-3});
    this.blocks.set(key,{i,j,si,boxes:new Float32Array(boxes),meshes,lamps,peds,type});
  }
  unload(k,b){
    for(const p of Object.values(this.pools))p.release(k);
    b.meshes.forEach(m=>{this.scene.remove(m);m.geometry.dispose()});
    this.slabs.setMatrixAt(b.si,new THREE.Matrix4().makeScale(0,0,0));this.slabs.instanceMatrix.needsUpdate=true;this.slabFree.push(b.si);
    this.blocks.delete(k);
  }
  *near(x,z){const i=Math.floor(x/BX),j=Math.floor(z/BZ);for(let jj=j-1;jj<=j+1;jj++)for(let ii=i-1;ii<=i+1;ii++){const b=this.blocks.get(this.key(ii,jj));if(b)yield b}}
  lampsNear(x,z,n){
    const all=[];for(const b of this.near(x,z))for(const l of b.lamps)all.push([(l.x-x)**2+(l.z-z)**2,l]);
    all.sort((a,b)=>a[0]-b[0]);return all.slice(0,n).map(a=>a[1]);
  }
  /* segmento contra cajas (para que la cámara no atraviese edificios) */
  segment(a,b){let tmin=1;const dx=b.x-a.x,dz=b.z-a.z;
    for(const blk of this.near(a.x,a.z)){const B=blk.boxes;for(let k=0;k<B.length;k+=5){if(Math.min(a.y,b.y)>B[k+4])continue;
      let t0=0,t1=tmin;for(const [o,d,mn,mx] of [[a.x,dx,B[k],B[k+2]],[a.z,dz,B[k+1],B[k+3]]]){if(Math.abs(d)<1e-6){if(o<mn||o>mx){t0=2;break}continue}
        let ta=(mn-o)/d,tb=(mx-o)/d;if(ta>tb)[ta,tb]=[tb,ta];t0=Math.max(t0,ta);t1=Math.min(t1,tb);if(t0>t1)break}
      if(t0<=t1&&t0<tmin)tmin=t0}}
    return tmin;
  }
}
