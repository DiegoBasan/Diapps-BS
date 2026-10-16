/* Nave del jugador: física de aerodeslizador antigravedad.
   - Empuje en la dirección de la nariz (con cabeceo) + empuje lateral y vertical.
   - Arrastre aerodinámico cuadrático (da la velocidad máxima de forma natural) y agarre lateral que deja derrapar.
   - Inercia angular en el giro, alabeo coordinado según giro × velocidad, retención de altura y colchón de aire cerca del suelo.
   - Choques contra edificios con rebote, fricción y daño visual (chispas, sacudida). */
import * as THREE from "../../shared/vendor/three/three.module.min.js";
import {clamp,damp,lerp} from "./util.js";
import {U} from "./world.js";

export const SHIPS=[
  {id:"veh007",name:"Espectro",desc:"Equilibrada. Ágil y estable.",mass:1400,thrust:15,top:95,turn:1.9,grip:2.6,lift:16,color:0x19e6ff},
  {id:"hovercar",name:"Ráfaga",desc:"Ligera y nerviosa. Gira rapidísimo.",mass:900,thrust:19,top:105,turn:2.5,grip:2.0,lift:20,color:0xff2bd6},
  {id:"scificar",name:"Cobre",desc:"Pesada y muy veloz en recta.",mass:2200,thrust:13,top:120,turn:1.4,grip:3.2,lift:12,color:0xff7a1a},
];

const glowTex=(()=>{const c=document.createElement("canvas");c.width=c.height=64;const x=c.getContext("2d");const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(0.25,"rgba(255,255,255,.6)");g.addColorStop(1,"rgba(255,255,255,0)");x.fillStyle=g;x.fillRect(0,0,64,64);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t})();
export {glowTex};

/* estela de luz (cinta) que sale de los propulsores */
class Trail{
  constructor(scene,color,n=48){
    this.n=n;this.pts=[];this.geo=new THREE.BufferGeometry();
    this.pos=new Float32Array(n*2*3);this.a=new Float32Array(n*2);
    this.geo.setAttribute("position",new THREE.BufferAttribute(this.pos,3));this.geo.setAttribute("aA",new THREE.BufferAttribute(this.a,1));
    const idx=[];for(let i=0;i<n-1;i++){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2)}this.geo.setIndex(idx);
    this.mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false,
      uniforms:{uC:{value:new THREE.Color(color)},uI:{value:0}},
      vertexShader:`attribute float aA;varying float vA;void main(){vA=aA;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`uniform vec3 uC;uniform float uI;varying float vA;void main(){gl_FragColor=vec4(uC*vA*vA*uI*2.2,1.);}`});
    this.mesh=new THREE.Mesh(this.geo,this.mat);this.mesh.frustumCulled=false;scene.add(this.mesh);
  }
  push(p,side,w){
    this.pts.unshift([p.clone(),side.clone().multiplyScalar(w)]);if(this.pts.length>this.n)this.pts.pop();
    for(let i=0;i<this.n;i++){const q=this.pts[Math.min(i,this.pts.length-1)];const f=1-i/(this.n-1);
      for(let k=0;k<2;k++){const s=k?1:-1;const o=(i*2+k)*3;this.pos[o]=q[0].x+q[1].x*s*f;this.pos[o+1]=q[0].y+q[1].y*s*f;this.pos[o+2]=q[0].z+q[1].z*s*f;this.a[i*2+k]=i<this.pts.length?f:0}}
    this.geo.attributes.position.needsUpdate=true;this.geo.attributes.aA.needsUpdate=true;
  }
}

export class Ship{
  constructor(scene){
    this.scene=scene;this.root=new THREE.Group();this.body=new THREE.Group();this.root.add(this.body);scene.add(this.root);
    this.pos=new THREE.Vector3(60,0,-260);this.vel=new THREE.Vector3();this.yaw=0;this.pitch=0;this.roll=0;this.yawRate=0;this.pitchV=0;
    this.boost=1;this.boosting=false;this.impact=0;this.hp=1;this.lightsOn=true;
    this.input={thr:0,steer:0,pitch:0,lift:0,strafe:0,boost:false,brake:false};
    this.fwd=new THREE.Vector3();this.right=new THREE.Vector3();this.up=new THREE.Vector3(0,1,0);
    // luces de la nave
    this.head=new THREE.SpotLight(0xdfe9ff,0,220,0.5,0.5,1.4);this.head.position.set(0,0.4,-2);this.root.add(this.head);this.root.add(this.head.target);this.head.target.position.set(0,-6,-40);
    this.under=new THREE.PointLight(0x19e6ff,0,16,1.8);this.under.position.set(0,-2.2,0);this.root.add(this.under);
    this.flares=[];this.sparks=[];
    this.trails=[new Trail(scene,0x19e6ff),new Trail(scene,0x19e6ff)];
    this.sparkPts=this.makeSparks();scene.add(this.sparkPts);
  }
  setModel(group,def){
    while(this.body.children.length)this.body.remove(this.body.children[0]);
    this.def=def;this.body.add(group);const b=group.userData.box;this.box=b;
    this.radius=Math.max(b.max.x-b.min.x,b.max.z-b.min.z)*0.42;this.halfH=(b.max.y-b.min.y)/2;
    // propulsores: dos destellos en la cola
    this.flares.forEach(f=>this.body.remove(f));this.flares=[];
    const cols=new THREE.Color(def.color);
    for(const s of [-1,1]){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:cols,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
      sp.position.set(s*(b.max.x-b.min.x)*0.26,(b.min.y+b.max.y)/2,b.max.z-0.1);sp.scale.setScalar(1.6);this.body.add(sp);this.flares.push(sp)}
    this.under.color.set(def.color);this.trails.forEach(t=>t.mat.uniforms.uC.value.set(def.color));
    this.mass=def.mass;this.kDrag=def.thrust/(def.top*def.top);
  }
  makeSparks(){
    const n=160;const g=new THREE.BufferGeometry();this.sp={p:new Float32Array(n*3),v:new Float32Array(n*3),l:new Float32Array(n),i:0,n};
    g.setAttribute("position",new THREE.BufferAttribute(this.sp.p,3));g.setAttribute("aL",new THREE.BufferAttribute(this.sp.l,1));
    const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
      vertexShader:`attribute float aL;varying float vL;void main(){vL=aL;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(90.*aL/-mv.z,1.,10.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`varying float vL;void main(){if(vL<=0.)discard;float d=length(gl_PointCoord-.5);gl_FragColor=vec4(vec3(1.,.6,.2)*smoothstep(.5,0.,d)*vL*4.,1.);}`});
    const p=new THREE.Points(g,m);p.frustumCulled=false;return p;
  }
  spark(at,n,dir){const s=this.sp;for(let k=0;k<n;k++){const i=s.i++%s.n;s.p.set([at.x,at.y,at.z],i*3);
    s.v.set([dir.x*8+(Math.random()-0.5)*14,dir.y*8+Math.random()*8,dir.z*8+(Math.random()-0.5)*14],i*3);s.l[i]=0.6+Math.random()*0.6}}
  get speed(){return this.vel.length()}

  step(dt,city){
    const I=this.input,d=this.def;const sp=this.vel.length();
    // orientación
    const turnRate=d.turn/(1+sp/70);
    const yawT=-I.steer*turnRate;this.yawRate=damp(this.yawRate,yawT,4.5,dt);this.yaw+=this.yawRate*dt;
    const pitchT=I.pitch*0.55;this.pitch=damp(this.pitch,pitchT,I.pitch?2.6:1.6,dt);
    const cy=Math.cos(this.yaw),sy=Math.sin(this.yaw),cp=Math.cos(this.pitch),spi=Math.sin(this.pitch);
    this.fwd.set(-sy*cp,spi,-cy*cp);this.right.set(cy,0,-sy);
    const fh=new THREE.Vector3(-sy,0,-cy);
    // empuje (m/s² por unidad de entrada)
    this.boosting=I.boost&&this.boost>0.02&&I.thr>0;
    if(this.boosting)this.boost=Math.max(0,this.boost-dt*0.22);else this.boost=Math.min(1,this.boost+dt*0.09);
    const thin=1-clamp((this.pos.y-650)/350,0,0.9); // aire delgado en lo alto
    const T=d.thrust*(this.boosting?2.05:1)*thin;
    const acc=new THREE.Vector3();
    acc.addScaledVector(this.fwd,I.thr*(I.thr<0?T*0.6:T));
    acc.addScaledVector(this.right,I.strafe*d.thrust*0.55);
    acc.y+=I.lift*d.lift;
    // arrastre cuadrático (velocidad máxima ≈ top) + freno de aire
    const kd=this.kDrag*(I.brake?5:1);acc.addScaledVector(this.vel,-kd*sp);
    // agarre lateral: la nave tiende a ir hacia donde apunta, pero derrapa a alta velocidad
    const lat=this.vel.dot(this.right);const grip=d.grip*(I.strafe?0.35:1)*(1/(1+sp/140));
    acc.addScaledVector(this.right,-lat*grip);
    // retención de altura: sin entrada vertical, el antigravedad amortigua la caída/subida
    if(!I.lift)acc.y+=-this.vel.y*(1.6-Math.abs(I.pitch)*1.2);
    // colchón de aire sobre el suelo
    const floor=this.halfH+1.6;const gap=this.pos.y-floor;
    if(gap<3.5){acc.y+=(3.5-gap)*14-this.vel.y*3.2}
    this.accel=acc;
    this.vel.addScaledVector(acc,dt);
    this.pos.addScaledVector(this.vel,dt);
    if(this.pos.y<floor){this.pos.y=floor;if(this.vel.y<0){if(this.vel.y<-8)this.hit(-this.vel.y,new THREE.Vector3(0,1,0));this.vel.y*=-0.2}}
    if(this.pos.y>1000){this.pos.y=1000;this.vel.y=Math.min(0,this.vel.y)}
    this.collide(city);
    // alabeo coordinado y balanceo por aceleración
    const rollT=clamp(this.yawRate*sp*0.028+I.strafe*-0.38-I.steer*0.12,-1.05,1.05);
    this.roll=damp(this.roll,rollT,3.2,dt);
    const along=acc.dot(fh);this.pitchV=damp(this.pitchV,clamp(-along*0.012,-0.12,0.12),3,dt);
  }
  collide(city){
    const r=this.radius,p=this.pos;let best=null;
    for(const b of city.boxesNear(p.x,p.z))for(let k=0;k<b.length;k+=6){
      const qx=clamp(p.x,b[k],b[k+3]),qy=clamp(p.y,b[k+1],b[k+4]),qz=clamp(p.z,b[k+2],b[k+5]);
      const dx=p.x-qx,dy=p.y-qy,dz=p.z-qz,d2=dx*dx+dy*dy+dz*dz;
      if(d2<r*r){
        let n;let pen;
        if(d2>1e-6){const d=Math.sqrt(d2);n=new THREE.Vector3(dx/d,dy/d,dz/d);pen=r-d}
        else{ // dentro de la caja: salir por la cara más cercana
          const f=[p.x-b[k],b[k+3]-p.x,p.y-b[k+1],b[k+4]-p.y,p.z-b[k+2],b[k+5]-p.z];let mi=0;for(let i=1;i<6;i++)if(f[i]<f[mi])mi=i;
          n=new THREE.Vector3([-1,1,0,0,0,0][mi],[0,0,-1,1,0,0][mi],[0,0,0,0,-1,1][mi]);pen=f[mi]+r}
        p.addScaledVector(n,pen);
        const vn=this.vel.dot(n);
        if(vn<0){
          // impacto fuerte: rebote y pérdida de velocidad; roce leve: se desliza por la pared
          const imp=-vn,vt=this.vel.clone().addScaledVector(n,-vn);
          this.vel.copy(vt.multiplyScalar(imp>6?0.8:0.996)).addScaledVector(n,imp>3?imp*0.3:0);
          if(-vn>4&&(!best||-vn>best.s))best={s:-vn,n,at:p.clone().addScaledVector(n,-r)};
        }
      }
    }
    if(best)this.hit(best.s,best.n,best.at);
  }
  hit(s,n,at){
    this.impact=Math.min(1.5,this.impact+s/30);this.hp=Math.max(0,this.hp-s/600);
    this.spark(at||this.pos,Math.min(60,s*2|0),n);this.onHit&&this.onHit(s);
  }
  update(dt,camera){
    // transformaciones visuales
    this.root.position.copy(this.pos);
    const t=U.uTime.value;const bob=Math.sin(t*2.1)*0.06+Math.sin(t*3.7)*0.03;
    this.root.rotation.set(0,this.yaw,0);
    this.body.rotation.set(this.pitch+this.pitchV,0,this.roll,"YXZ");this.body.position.y=bob;
    if(this.impact>0)this.body.rotation.z+=(Math.random()-0.5)*this.impact*0.08;
    this.impact=Math.max(0,this.impact-dt*1.8);
    // propulsores
    const thr=Math.max(0,this.input.thr);const fl=(0.6+thr*1.2+(this.boosting?1.6:0))*(0.9+Math.random()*0.2);
    this.flares.forEach(f=>{f.scale.setScalar(fl*1.4);f.material.opacity=Math.min(1,0.4+fl*0.4)});
    this.head.intensity=this.lightsOn?45:0;this.under.intensity=this.lightsOn?(3.5+thr*2.5):0;
    // estelas: más intensas con turbo y velocidad
    const sp=this.speed;const ti=clamp((sp-25)/60,0,1)*0.7+(this.boosting?0.8:0);
    this.body.updateMatrixWorld(true);
    this.flares.forEach((f,i)=>{const w=f.getWorldPosition(new THREE.Vector3());const up=new THREE.Vector3(0,1,0).applyQuaternion(this.body.getWorldQuaternion(new THREE.Quaternion()));
      this.trails[i].push(w,up,0.22+(this.boosting?0.2:0));this.trails[i].mat.uniforms.uI.value=damp(this.trails[i].mat.uniforms.uI.value,ti,4,dt)});
    // chispas
    const s=this.sp;for(let i=0;i<s.n;i++){if(s.l[i]<=0)continue;s.l[i]-=dt*1.6;s.v[i*3+1]-=dt*20;for(let k=0;k<3;k++)s.p[i*3+k]+=s.v[i*3+k]*dt}
    this.sparkPts.geometry.attributes.position.needsUpdate=true;this.sparkPts.geometry.attributes.aL.needsUpdate=true;
  }
}
