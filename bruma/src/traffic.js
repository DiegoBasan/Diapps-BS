/* Tráfico (Toyota Corolla instanciado, distintos colores oscuros) en los carriles de las avenidas, con calaveras
   rojas y faros, distancia de seguimiento y frenado ante el Jetta. Peatones de la multitud animada en las banquetas. */
import * as THREE from "three/webgpu";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import {GRID} from "./materials.js";
const {BX,BZ}=GRID;
const V=THREE.Vector3;

const PAINTS=[0x15171a,0x2a2d31,0x3b1d1b,0x1d2a2e,0x6d7175,0x101010,0x4a4f55,0x2e3a2a].map(c=>new THREE.Color(c));

export class Traffic{
  constructor(scene,parts,n=26){
    this.n=n;this.cars=[];this.W=520;
    const box=new THREE.Box3();parts.forEach(p=>{p.geometry.computeBoundingBox();box.union(p.geometry.boundingBox)});this.box=box;
    this.meshes=parts.map(p=>{
      const paint=/paint/i.test(p.material.name||"");
      const mat=paint?new THREE.MeshPhysicalNodeMaterial({color:0xffffff,metalness:0.5,roughness:0.3,clearcoat:1,clearcoatRoughness:0.08}):p.material;
      const m=new THREE.InstancedMesh(p.geometry,mat,n);m.frustumCulled=false;m.castShadow=true;m.receiveShadow=true;
      if(paint){for(let i=0;i<n;i++)m.setColorAt(i,PAINTS[i%PAINTS.length])}
      scene.add(m);return m});
    // luces: barras emisivas (calaveras rojas atrás, faros adelante)
    const lg=new THREE.BoxGeometry(0.42,0.1,0.04);
    const red=new THREE.MeshBasicNodeMaterial({color:new THREE.Color(1,0.04,0.02).multiplyScalar(14)});
    const wht=new THREE.MeshBasicNodeMaterial({color:new THREE.Color(1,0.92,0.8).multiplyScalar(10)});
    this.tail=new THREE.InstancedMesh(lg,red,n*2);this.head=new THREE.InstancedMesh(lg,wht,n*2);
    [this.tail,this.head].forEach(m=>{m.frustumCulled=false;scene.add(m)});
    this.m4=new THREE.Matrix4();this.q=new THREE.Quaternion();this.s=new V(1,1,1);this.zero=new THREE.Matrix4().makeScale(0,0,0);
  }
  lane(c){ // posición lateral del carril (tráfico por la derecha)
    return c.road*BX+(c.dir>0?-1:1)*(c.lane?6.2:2.2);
  }
  spawn(c,p,anywhere){
    c.dir=Math.random()<0.5?1:-1;c.lane=Math.random()<0.5?0:1;
    c.road=Math.round(p.x/BX)+Math.round((Math.random()-0.5)*4);
    c.vmax=9+Math.random()*7;c.v=c.vmax;
    c.s=anywhere?p.z+(Math.random()-0.5)*this.W:p.z-c.dir*this.W/2*(0.8+Math.random()*0.2);
  }
  update(dt,car){
    const p=car.pos;
    if(!this.cars.length)for(let i=0;i<this.n;i++){const c={};this.spawn(c,p,true);this.cars.push(c)}
    // seguimiento: ordenar por carril
    const lanes=new Map();for(const c of this.cars){const k=c.road+":"+c.dir+":"+c.lane;if(!lanes.has(k))lanes.set(k,[]);lanes.get(k).push(c)}
    for(const l of lanes.values()){l.sort((a,b)=>(a.s-b.s)*a.dir);
      for(let i=0;i<l.length;i++){const c=l[i],ahead=l[i+1];let gap=ahead?(ahead.s-c.s)*c.dir-5:999;
        // el Jetta en el mismo carril
        const lx=this.lane(c);if(Math.abs(p.x-lx)<2.2){const g=(p.z-c.s)*c.dir-5;if(g>-2&&g<gap)gap=g}
        const target=gap<4?0:Math.min(c.vmax,(gap-4)*0.7);c.v+=(target-c.v)*Math.min(1,dt*(target<c.v?3:0.8));c.braking=target<c.v-0.5||c.v<0.5}}
    let li=0;
    for(let i=0;i<this.n;i++){
      const c=this.cars[i];c.s+=c.dir*c.v*dt;
      if((c.s-p.z)*c.dir>this.W/2||Math.abs(c.road*BX-p.x)>BX*3.5)this.spawn(c,p,false);
      const x=this.lane(c),z=c.s;c.x=x;c.z=z;
      this.q.setFromAxisAngle(new V(0,1,0),c.dir>0?0:Math.PI);
      this.m4.compose(new V(x,0.02,z),this.q,this.s);
      for(const m of this.meshes)m.setMatrixAt(i,this.m4);
      // luces
      const b=this.box,hl=b.max.z-0.06,tl=b.min.z+0.06,y=0.78;
      for(const [k,side] of [[0,1],[1,-1]]){
        this.m4.compose(new V(x+side*0.62,y+(c.braking?0.02:0),z+c.dir*tl),this.q,new V(1,c.braking?1.6:1,1));this.tail.setMatrixAt(i*2+k,this.m4);
        this.m4.compose(new V(x+side*0.62,0.72,z+c.dir*hl),this.q,this.s);this.head.setMatrixAt(i*2+k,this.m4);
      }
      // choque con el Jetta: empujón de cuerpo rígido
      const dx=p.x-x,dz=p.z-z;if(Math.abs(dx)<1.9&&Math.abs(dz)<4.6){
        const n=Math.abs(dx)/1.9>Math.abs(dz)/4.6?new V(Math.sign(dx),0,0):new V(0,0,Math.sign(dz));
        const pen=n.x?1.9-Math.abs(dx):4.6-Math.abs(dz);car.pos.addScaledVector(n,pen);
        const hit=car.impulse(car.pos.clone().addScaledVector(n,-1),n,0.2,0.4);if(hit>1.5&&car.onHit)car.onHit(hit);c.v=0;
      }
    }
    for(const m of [...this.meshes,this.tail,this.head])m.instanceMatrix.needsUpdate=true;
  }
}

export class Pedestrians{
  constructor(scene,gltf,groups=3){
    this.chars=[];this.mixers=[];
    for(let g=0;g<groups;g++){
      const root=SkeletonUtils.clone(gltf.scene);scene.add(root);root.updateMatrixWorld(true);
      const mixer=new THREE.AnimationMixer(root);const a=mixer.clipAction(gltf.animations[0]);a.play();a.time=g*0.37;mixer.timeScale=0.95+g*0.05;this.mixers.push(mixer);
      // cada personaje = Armature.N + mesh.N con la misma posición en el nodo raíz
      let rn=null;root.traverse(o=>{if(o.name==="RootNode")rn=o});if(!rn)continue;
      const arms=rn.children.filter(o=>/^Armature/.test(o.name));
      for(const arm of arms){const mesh=rn.children.find(o=>o!==arm&&!/^Armature/.test(o.name)&&o.position.distanceTo(arm.position)<1);
        this.chars.push({arm,mesh,rn,seg:null,t:0,dir:1,v:1.1+Math.random()*0.5,off:(Math.random()-0.5)*2.4})}
    }
    this.tmp=new V();
  }
  update(dt,city,p){
    this.mixers.forEach(m=>m.update(dt));
    const segs=[];for(const b of city.near(p.x,p.z))segs.push(...b.peds);
    for(const c of this.chars){
      if(!c.seg||Math.abs(c.seg.x-p.x)>BX*1.6||Math.abs((c.seg.z0+c.seg.z1)/2-p.z)>BZ*1.6){
        if(!segs.length)continue;c.seg=segs[Math.floor(Math.random()*segs.length)];c.t=Math.random();c.dir=Math.random()<0.5?1:-1}
      const L=c.seg.z1-c.seg.z0;c.t+=c.dir*c.v*dt/L;if(c.t>1||c.t<0){c.dir*=-1;c.t=Math.min(1,Math.max(0,c.t))}
      // posición en el mundo -> espacio del nodo raíz
      const wp=this.tmp.set(c.seg.x+c.off,0.16,c.seg.z0+c.t*L);
      const lp=c.rn.worldToLocal(wp.clone());
      c.arm.position.copy(lp);c.mesh&&c.mesh.position.copy(lp);
      const yaw=c.dir>0?0:Math.PI;c.arm.rotation.z=yaw;if(c.mesh)c.mesh.rotation.z=yaw;
    }
  }
}
