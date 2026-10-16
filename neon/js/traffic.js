/* Tráfico aéreo: autos voladores (modelos de Sketchfab instanciados) en carriles sobre las calles a varias alturas,
   con faros y calaveras. Los autos viven en una ventana alrededor del jugador y se reciclan al salir.
   Drones patrulla con reflector que barre la calle. */
import * as THREE from "../../shared/vendor/three/three.module.min.js";
import {BLOCK,PYR} from "./city.js";
import {clamp,damp} from "./util.js";
import {U,FOG_GLSL,fogUniforms} from "./world.js";

const ALT=[32,58,88,128,180];

export class Traffic{
  constructor(scene,types,count){
    this.scene=scene;this.types=types;this.W=1500;this.cars=[];this.inst=[];
    // InstancedMesh por pieza de cada modelo
    types.forEach((t,ti)=>{
      const cap=Math.ceil(count/types.length)+2;
      t.meshes=t.parts.map(p=>{const m=new THREE.InstancedMesh(p.geometry,p.material,cap);m.count=0;m.frustumCulled=false;m.castShadow=false;m.receiveShadow=true;scene.add(m);return m});
      t.cap=cap;t.n=0;
      const b=new THREE.Box3();t.parts.forEach(p=>b.union(p.geometry.boundingBox));t.box=b;
    });
    this.count=count;
    // luces (puntos aditivos)
    const g=new THREE.BufferGeometry();this.lp=new Float32Array(count*4*3);this.lc=new Float32Array(count*4*3);
    g.setAttribute("position",new THREE.BufferAttribute(this.lp,3));g.setAttribute("color",new THREE.BufferAttribute(this.lc,3));
    this.lights=new THREE.Points(g,new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
      uniforms:{uS:{value:500},...fogUniforms(scene)},
      vertexShader:`uniform float uS;attribute vec3 color;varying vec3 vC;varying vec3 vW;void main(){vC=color;vW=position;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(uS/-mv.z,1.5,40.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`varying vec3 vC;varying vec3 vW;${FOG_GLSL}void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,d);gl_FragColor=vec4(vC*a*a*(1.-neonFog(vW)*.8),1.);}`}));
    this.lights.frustumCulled=false;scene.add(this.lights);
    this.m4=new THREE.Matrix4();this.q=new THREE.Quaternion();this.v=new THREE.Vector3();this.s=new THREE.Vector3(1,1,1);this.zero=new THREE.Matrix4().makeScale(0,0,0);
    this.init=false;
  }
  setCount(n){this.active=Math.min(n,this.count)}
  spawn(c,px,pz,anywhere){
    c.axis=Math.random()<0.5?0:1;c.dir=Math.random()<0.5?1:-1;
    const along=c.axis===0?pz:px,across=c.axis===0?px:pz;
    c.road=Math.round(across/BLOCK)+Math.round((Math.random()-0.5)*12);
    c.alt=ALT[Math.floor(Math.random()*ALT.length)]+(Math.random()-0.5)*4;
    c.lane=c.dir*(3+Math.floor(Math.random()*2)*3.4);
    c.speed=24+Math.random()*28;c.ph=Math.random()*10;
    c.s=anywhere?along+(Math.random()-0.5)*this.W:along-c.dir*this.W/2*(0.9+Math.random()*0.1);
  }
  update(dt,ship,camera){
    const px=ship.pos.x,pz=ship.pos.z;const n=this.active??this.count;
    if(!this.init){for(let i=0;i<this.count;i++){const c={type:i%this.types.length};this.spawn(c,px,pz,true);this.cars.push(c)}this.init=true}
    this.types.forEach(t=>t.n=0);
    const t=U.uTime.value;let li=0;
    for(let i=0;i<this.count;i++){
      const c=this.cars[i];const T=this.types[c.type];const slot=T.n++;
      if(i>=n){T.meshes.forEach(m=>m.setMatrixAt(slot,this.zero));for(let k=0;k<4;k++){this.lc.fill(0,(li+k)*3,(li+k)*3+3)}li+=4;continue}
      c.s+=c.dir*c.speed*dt;
      const along=c.axis===0?pz:px,across=c.axis===0?px:pz;
      if((c.s-along)*c.dir>this.W/2||Math.abs(c.road*BLOCK-across)>BLOCK*8)this.spawn(c,px,pz,false);
      const y=c.alt+Math.sin(t*0.8+c.ph)*0.6;const off=c.road*BLOCK+c.lane;
      const x=c.axis===0?off:c.s,z=c.axis===0?c.s:off;
      // dirección de avance -> rotación (el modelo mira a -Z)
      const yaw=c.axis===0?(c.dir>0?Math.PI:0):(c.dir>0?-Math.PI/2:Math.PI/2);
      this.q.setFromEuler(new THREE.Euler(0,yaw,Math.sin(t*0.5+c.ph)*0.04));this.v.set(x,y,z);
      const hidden=Math.abs(x-PYR.x)<PYR.w/2&&Math.abs(z-PYR.z)<PYR.w/2&&y<PYR.h*(1-Math.max(Math.abs(x-PYR.x),Math.abs(z-PYR.z))/(PYR.w/2))+10;
      this.m4.compose(this.v,this.q,this.s);if(hidden)this.m4.copy(this.zero);
      T.meshes.forEach(m=>m.setMatrixAt(slot,this.m4));
      c.x=x;c.y=y;c.z=z;c.hidden=hidden;
      // faros (frente -Z local) y calaveras
      const b=T.box;
      const dx=c.axis===0?0:c.dir,dz=c.axis===0?c.dir:0;const sx=-dz,sz=dx;const hw=(b.max.x-b.min.x)*0.36,hl=(b.max.z-b.min.z)*0.5;
      const yy=y+(b.min.y+b.max.y)*0.4;
      const put=(k,ox,oz,r,g,bb)=>{const o=(li+k)*3;this.lp[o]=x+ox;this.lp[o+1]=yy;this.lp[o+2]=z+oz;const h=hidden?0:1;this.lc[o]=r*h;this.lc[o+1]=g*h;this.lc[o+2]=bb*h};
      put(0,dx*hl+sx*hw,dz*hl+sz*hw,2.2,2.1,1.9);put(1,dx*hl-sx*hw,dz*hl-sz*hw,2.2,2.1,1.9);
      put(2,-dx*hl+sx*hw,-dz*hl+sz*hw,2.4,0.15,0.1);put(3,-dx*hl-sx*hw,-dz*hl-sz*hw,2.4,0.15,0.1);
      li+=4;
      // choque con el jugador
      const ddx=ship.pos.x-x,ddy=ship.pos.y-y,ddz=ship.pos.z-z;const R=ship.radius+2.6;
      if(!hidden&&ddx*ddx+ddy*ddy+ddz*ddz<R*R){
        const d=Math.sqrt(ddx*ddx+ddy*ddy+ddz*ddz)||1;const nrm=new THREE.Vector3(ddx/d,ddy/d,ddz/d);
        ship.pos.addScaledVector(nrm,R-d);const cv=new THREE.Vector3(dx*c.speed,0,dz*c.speed);
        const rel=ship.vel.clone().sub(cv);const vn=rel.dot(nrm);if(vn<0){ship.vel.addScaledVector(nrm,-vn*1.3);ship.hit(-vn,nrm,new THREE.Vector3(x,y,z).addScaledVector(nrm,2))}
      }
    }
    this.types.forEach(T=>T.meshes.forEach(m=>{m.count=T.n;m.instanceMatrix.needsUpdate=true}));
    this.lights.geometry.attributes.position.needsUpdate=true;this.lights.geometry.attributes.color.needsUpdate=true;
    this.lights.geometry.setDrawRange(0,li);
  }
}

/* drones patrulla con reflector */
export class Drones{
  constructor(scene,parts,n=10){
    this.n=n;this.d=[];this.meshes=parts.map(p=>{const m=new THREE.InstancedMesh(p.geometry,p.material,n);m.frustumCulled=false;scene.add(m);return m});
    const cone=new THREE.CylinderGeometry(0.4,9,1,24,1,true).translate(0,-0.5,0);
    this.cones=new THREE.InstancedMesh(cone,new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false,
      uniforms:{uTime:U.uTime},
      vertexShader:`varying float vY;varying vec3 vN,vV;void main(){vY=-position.y;vec4 w=modelMatrix*instanceMatrix*vec4(position,1.);vN=normalize(mat3(modelMatrix*instanceMatrix)*normal);vV=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader:`varying float vY;varying vec3 vN,vV;void main(){float e=pow(1.-abs(dot(vN,vV)),1.5);float a=(1.-vY)*(0.10+0.25*(1.-e));gl_FragColor=vec4(vec3(.75,.85,1.)*a,1.);}`}),n);
    this.cones.frustumCulled=false;scene.add(this.cones);
    const g=new THREE.BufferGeometry();this.bp=new Float32Array(n*2*3);this.bc=new Float32Array(n*2*3);
    g.setAttribute("position",new THREE.BufferAttribute(this.bp,3));g.setAttribute("color",new THREE.BufferAttribute(this.bc,3));
    this.beac=new THREE.Points(g,new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
      vertexShader:`attribute vec3 color;varying vec3 vC;void main(){vC=color;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(700./-mv.z,2.,30.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader:`varying vec3 vC;void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,d);gl_FragColor=vec4(vC*a*a,1.);}`}));
    this.beac.frustumCulled=false;scene.add(this.beac);
    this.m4=new THREE.Matrix4();
  }
  update(dt,ship){
    const t=U.uTime.value;
    for(let i=0;i<this.n;i++){
      let d=this.d[i];
      if(!d||Math.hypot(d.cx-ship.pos.x,d.cz-ship.pos.z)>900){
        d=this.d[i]={cx:Math.round((ship.pos.x+(Math.random()-0.5)*1400)/BLOCK)*BLOCK,cz:Math.round((ship.pos.z+(Math.random()-0.5)*1400)/BLOCK)*BLOCK,r:20+Math.random()*50,a:Math.random()*6,w:(Math.random()<0.5?-1:1)*(0.15+Math.random()*0.2),y:24+Math.random()*30,ph:Math.random()*9};
      }
      d.a+=d.w*dt;const x=d.cx+Math.cos(d.a)*d.r,z=d.cz+Math.sin(d.a)*d.r,y=d.y+Math.sin(t*1.3+d.ph)*1.2;
      const yaw=-d.a-(d.w>0?0:Math.PI);
      this.m4.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08,yaw,0)),new THREE.Vector3(1,1,1));
      this.meshes.forEach(m=>m.setMatrixAt(i,this.m4));
      // reflector: barre en un cono hacia abajo
      const sw=new THREE.Euler(Math.sin(t*0.7+d.ph)*0.35,0,Math.cos(t*0.5+d.ph)*0.35);
      this.m4.compose(new THREE.Vector3(x,y-1.2,z),new THREE.Quaternion().setFromEuler(sw),new THREE.Vector3(1,y-1,1));this.cones.setMatrixAt(i,this.m4);
      const blink=Math.sin(t*9+d.ph)>0;
      this.bp.set([x-0.9,y+1.6,z,x+0.9,y+1.6,z],i*6);this.bc.set(blink?[3,0.1,0.1,0,0,0]:[0,0,0,0.2,0.5,3],i*6);
    }
    this.meshes.forEach(m=>m.instanceMatrix.needsUpdate=true);this.cones.instanceMatrix.needsUpdate=true;
    this.beac.geometry.attributes.position.needsUpdate=true;this.beac.geometry.attributes.color.needsUpdate=true;
  }
}
