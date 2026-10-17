/* Jetta A6 (MK6): cuerpo rígido con 4 suspensiones de rayo, llantas con curva tipo Pacejka y círculo de fricción,
   tracción delantera, motor 2.5 L de 5 cilindros (170 hp, 240 N·m) y Tiptronic de 6 velocidades.
   La física corre a 240 Hz; la carrosería se inclina y cabecea sola por la transferencia de peso. */
import * as THREE from "three/webgpu";
import {groundHeight} from "./city.js";

const V=THREE.Vector3,Q=THREE.Quaternion;
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const GEARS=[-3.39,0,4.148,2.370,1.556,1.155,0.859,0.686],FINAL=3.683;
/* par motor (N·m) del 2.5 L a plena carga */
const torqueAt=rpm=>{const t=[[800,170],[1500,205],[2500,232],[3750,240],[4500,236],[5500,222],[6200,200],[6700,160]];
  if(rpm<=t[0][0])return t[0][1];for(let i=1;i<t.length;i++)if(rpm<=t[i][0]){const a=t[i-1],b=t[i],k=(rpm-a[0])/(b[0]-a[0]);return a[1]+(b[1]-a[1])*k}return 0};

export class Car{
  constructor(model){
    this.root=new THREE.Group();this.body=new THREE.Group();this.root.add(this.body);this.body.add(model);
    this.mass=1430;
    const w=1.78,h=1.45,L=4.64;this.Ib=new V(this.mass/12*(h*h+L*L),this.mass/12*(w*w+L*L)*1.15,this.mass/12*(w*w+h*h));
    this.pos=new V(0,0.6,0);this.q=new Q();this.vel=new V();this.w=new V();
    this.input={thr:0,brake:0,steer:0,hand:false};
    this.gear=2;this.rpm=800;this.steer=0;this.shiftT=0;this.reverse=false;
    this.setupWheels(model);this.setupLights(model);
  }
  /* encuentra las 4 ruedas en el modelo y les crea un pivote en su centro para girar y dar vuelta */
  setupWheels(model){
    model.updateMatrixWorld(true);this.wheels=[];
    const rims=[];model.traverse(o=>{if(/77jetta_rim/i.test(o.name)&&!rims.some(r=>o.parent===r||r.parent===o))rims.push(o)});
    const inv=new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    for(const r of rims){
      const b=new THREE.Box3().setFromObject(r);const c=b.getCenter(new V()).applyMatrix4(inv);const size=b.getSize(new V());
      const piv=new THREE.Group();piv.position.copy(c);this.body.add(piv);
      const spin=new THREE.Group();piv.add(spin);
      piv.updateMatrixWorld(true);spin.attach(r);
      this.wheels.push({piv,spin,local:c.clone(),r:size.y/2,front:c.z>0,left:c.x>0,omega:0,ang:0,comp:0,prevComp:0,rest:0.32,k:36000,c:3300,Fz:0,slip:0,contact:false});
    }
    // si el modelo no trajo ruedas reconocibles, ruedas virtuales
    if(this.wheels.length!==4){this.wheels=[];for(const [x,z] of [[0.78,1.33],[-0.78,1.33],[0.78,-1.30],[-0.78,-1.30]])this.wheels.push({piv:null,spin:null,local:new V(x,0.32,z),r:0.32,front:z>0,left:x>0,omega:0,ang:0,comp:0,prevComp:0,rest:0.32,k:36000,c:3300,Fz:0,slip:0,contact:false})}
    this.wheelBase=Math.abs(this.wheels.find(w=>w.front).local.z-this.wheels.find(w=>!w.front).local.z);
  }
  setupLights(model){
    this.mats={brake:[],tail:[],head:[],reverse:[]};this.paint=[];
    model.traverse(o=>{if(!o.isMesh)return;const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{const n=m.name||"";
      if(/primary/i.test(n))this.paint.push(m);
      else if(/runningred|taillightdummy|redglass/i.test(n)){m.emissive=new THREE.Color(1,0.05,0.02);m.emissiveIntensity=2.2;this.mats.tail.push(m)}
      else if(/qazxedred$/i.test(n)){m.emissive=new THREE.Color(1,0.03,0.01);m.emissiveIntensity=0.3;this.mats.brake.push(m)}
      else if(/lowbeam|highbeam|77jetta_running$/i.test(n)){m.emissive=new THREE.Color(1,0.95,0.85);m.emissiveIntensity=3;this.mats.head.push(m)}
      else if(/reverselight/i.test(n)){m.emissive=new THREE.Color(1,1,1);m.emissiveIntensity=0;this.mats.reverse.push(m)}
      else if(/glass/i.test(n)&&m.transparent===false){m.transparent=true;m.opacity=Math.min(m.opacity??1,0.55)}
    })});
    // pintura gris plata con laca (clearcoat) para que la lluvia se vea en la carrocería
    const paint=new THREE.MeshPhysicalNodeMaterial({color:0x6d7175,metalness:0.55,roughness:0.32,clearcoat:1,clearcoatRoughness:0.06});
    model.traverse(o=>{if(o.isMesh){if(Array.isArray(o.material))o.material=o.material.map(m=>this.paint.includes(m)?paint:m);else if(this.paint.includes(o.material))o.material=paint}});
    this.paintMat=paint;
    // faros: dos reflectores reales (iluminan la niebla volumétrica y el piso) + calaveras
    this.headL=[-0.62,0.62].map(x=>{const s=new THREE.SpotLight(0xfff1dc,90,95,0.42,0.55,1.6);s.position.set(x,0.72,2.15);s.target.position.set(x*1.4,0,24);this.body.add(s,s.target);return s});
    this.tailL=new THREE.PointLight(0xff1a0a,1.2,7,2);this.tailL.position.set(0,0.85,-2.45);this.body.add(this.tailL);
    this.lightsOn=true;
  }
  setShadows(on){this.headL[0].castShadow=on;if(on){this.headL[0].shadow.mapSize.set(1024,1024);this.headL[0].shadow.camera.near=0.5;this.headL[0].shadow.camera.far=80;this.headL[0].shadow.bias=-0.0006}}
  get speed(){return this.vel.length()}
  get fwd(){return new V(0,0,1).applyQuaternion(this.q)}
  get kmh(){return this.vel.dot(this.fwd)*3.6}

  step(dt,world){
    const I=this.input,q=this.q,m=this.mass;
    const up=new V(0,1,0).applyQuaternion(q),fwd=new V(0,0,1).applyQuaternion(q),right=new V(1,0,0).applyQuaternion(q);
    const vF=this.vel.dot(fwd);
    // dirección: menos ángulo a alta velocidad, con retorno suave
    const maxSteer=0.58/(1+Math.abs(vF)/22);
    this.steer+=(I.steer*maxSteer-this.steer)*Math.min(1,dt*(I.steer?6:8));
    // caja: Tiptronic automática, reversa al frenar detenido
    const driveW=this.wheels.filter(w=>w.front);
    const wheelOmega=driveW.reduce((a,w)=>a+w.omega,0)/driveW.length;
    if(this.shiftT>0)this.shiftT-=dt;
    if(Math.abs(vF)<0.8&&I.brake>0.3&&I.thr<0.05){this.revT=(this.revT||0)+dt;if(this.revT>0.5&&this.gear!==0){this.gear=0;this.shiftT=0.3}}else this.revT=0;
    if(this.gear===0&&I.thr>0.1&&vF>-0.5){this.gear=2;this.shiftT=0.3}
    const gr=GEARS[this.gear]*FINAL;
    let rpm=Math.abs(wheelOmega*gr)*60/(2*Math.PI);
    if(this.gear>=2&&this.shiftT<=0){
      // cambios con histéresis: tras subir, las rpm caen ~35%; solo baja si quedan muy abajo (o con kickdown)
      const upAt=I.thr>0.85?6300:2600+I.thr*3200;
      const downAt=I.thr>0.85?2300:1250;
      if(rpm>upAt&&this.gear<7){this.gear++;this.shiftT=0.35}
      else if(rpm<downAt&&this.gear>2){this.gear--;this.shiftT=0.25}
    }
    // convertidor de par: a baja velocidad el motor gira libre
    const conv=clamp(rpm/1400,0,1);
    this.rpm+=(Math.max(780+I.thr*(2200*(1-conv)),rpm)-this.rpm)*Math.min(1,dt*12);this.rpm=Math.min(this.rpm,6900);
    const thrEff=this.shiftT>0?I.thr*0.25:I.thr;
    let Te=this.rpm>6750?0:torqueAt(this.rpm)*thrEff;
    if(this.gear===0)Te=torqueAt(this.rpm)*(I.thr>0.05?I.thr:I.brake>0.05&&vF<0.5?I.brake*0.7:0);
    let Tdrive=Te*gr*0.9*(1+(1-conv)*0.9);
    // control de tracción (ASR): si las delanteras patinan, se corta par
    const vRef=Math.max(Math.abs(vF),1);const sl=(Math.abs(wheelOmega)*driveW[0].r-Math.abs(vF))/vRef;
    this.tcs=sl>0.12&&this.asr!==false?Math.max(0.15,1-(sl-0.12)*2.5):1;Tdrive*=this.tcs;
    // brakes (N·m por rueda)
    const useBrakeAsGas=this.gear===0;
    const brake=useBrakeAsGas?(I.thr>0.05?I.thr:0):I.brake;
    const F=new V(0,-9.81*m,0),T=new V();
    for(const w of this.wheels){
      const mount=w.local.clone();mount.y+=w.rest;mount.applyQuaternion(q).add(this.pos);
      const gh=groundHeight(mount.x,mount.z);
      const dist=(mount.y-gh)/Math.max(0.3,up.y)-w.r;
      w.prevComp=w.comp;w.comp=clamp(w.rest-dist,0,w.rest+0.15);w.contact=dist<w.rest;
      if(!w.contact){w.Fz=0;w.omega*=0.995;continue}
      const cr=(w.comp-w.prevComp)/dt;
      let Fz=Math.max(0,w.k*w.comp+w.c*cr);
      // tope de suspensión
      if(w.comp>w.rest)Fz+=(w.comp-w.rest)*200000;
      w.Fz=Fz;
      const cp=mount.clone().addScaledVector(up,-(w.rest-w.comp)-w.r);
      // ejes de la llanta sobre el piso
      const st=w.front?this.steer:0;
      const wf=fwd.clone().multiplyScalar(Math.cos(st)).addScaledVector(right,-Math.sin(st));wf.y=0;wf.normalize();
      const ws=new V(wf.z,0,-wf.x); // derecha de la llanta (y arriba)
      const rp=cp.clone().sub(this.pos);
      const vp=this.vel.clone().add(new V().crossVectors(this.w,rp));
      const vL=vp.dot(wf),vS=vp.dot(ws);
      const mu=1.0-0.18*world.wet-(groundHeight(cp.x,cp.z)>0?0.05:0);
      // deslizamiento lateral y longitudinal
      const alpha=Math.atan2(vS,Math.max(Math.abs(vL),1.2));
      let Fy=-mu*Fz*Math.sin(1.45*Math.atan(9*alpha));
      if(Math.abs(vL)<1.2)Fy=-vS*Fz*0.9*Math.min(1,mu); // casi detenido: amortiguar sin oscilar
      const handLock=I.hand&&!w.front;
      if(handLock)w.omega*=0.5;
      const kappa=(w.omega*w.r-vL)/Math.max(Math.abs(vL),3);
      let Fx=mu*Fz*Math.sin(1.6*Math.atan(11*kappa));
      if(handLock){Fx=-Math.sign(vL)*mu*Fz*0.75;Fy*=0.45}
      // círculo de fricción
      const Fm=Math.hypot(Fx,Fy),lim=mu*Fz*1.05;if(Fm>lim){Fx*=lim/Fm;Fy*=lim/Fm}
      w.slip=Math.min(1,Math.abs(kappa)*0.8+Math.abs(alpha)*1.2)*(Fm>lim*0.85?1:0.4);
      // giro de la rueda: par motor (delanteras), freno, reacción del piso
      const Iw=1.3;
      let tq=-Fx*w.r;if(w.front)tq+=Tdrive/2;
      w.omega+=tq/Iw*dt;
      // ABS: si la rueda se bloquea, suelta el freno de esa rueda un instante
      const abs=!handLock&&kappa<-0.14&&Math.abs(vL)>2?0.25:1;
      const Tb=brake*(w.front?2600:1500)*abs+40;
      const dOm=Tb/Iw*dt;if(Math.abs(w.omega)<=dOm)w.omega=0;else w.omega-=Math.sign(w.omega)*dOm;
      if(!handLock&&brake<0.05&&Math.abs(Tdrive)<1&&Math.abs(vL)<0.3)w.omega=vL/w.r;
      const f=up.clone().multiplyScalar(Fz).addScaledVector(wf,Fx).addScaledVector(ws,Fy);
      F.add(f);T.add(new V().crossVectors(rp,f));
    }
    // aerodinámica y resistencia a la rodadura
    const sp=this.vel.length();F.addScaledVector(this.vel,-0.5*1.2*0.31*2.25*sp);F.addScaledVector(this.vel,-12);
    // integración
    this.vel.addScaledVector(F,dt/m);this.pos.addScaledVector(this.vel,dt);
    const Iinv=this.invInertiaWorld();this.w.add(T.applyMatrix3(Iinv).multiplyScalar(dt));this.w.multiplyScalar(0.999);
    const wq=new Q(this.w.x*dt/2,this.w.y*dt/2,this.w.z*dt/2,0).multiply(q);q.x+=wq.x;q.y+=wq.y;q.z+=wq.z;q.w+=wq.w;q.normalize();
    this.collide(world);
    // si la carrocería toca el piso (volcadura), no atravesarlo
    if(this.pos.y<0.35){this.pos.y=0.35;if(this.vel.y<0)this.vel.y=0}
  }
  invInertiaWorld(){
    const R=new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.q));
    const D=new THREE.Matrix3().set(1/this.Ib.x,0,0,0,1/this.Ib.y,0,0,0,1/this.Ib.z);
    return R.clone().multiply(D).multiply(R.clone().transpose());
  }
  /* impulso en un punto de contacto (choques) */
  impulse(p,n,e=0.25,mu=0.5){
    const r=p.clone().sub(this.pos);const v=this.vel.clone().add(new V().crossVectors(this.w,r));const vn=v.dot(n);if(vn>=0)return 0;
    const Iinv=this.invInertiaWorld();const rn=new V().crossVectors(r,n);
    const k=1/this.mass+n.dot(new V().crossVectors(rn.clone().applyMatrix3(Iinv),r));
    const j=-(1+e)*vn/k;const J=n.clone().multiplyScalar(j);
    // fricción tangencial
    const vt=v.clone().addScaledVector(n,-vn);const vtl=vt.length();if(vtl>1e-3)J.addScaledVector(vt,-Math.min(mu*j,vtl/ (1/this.mass*2))/vtl);
    this.vel.addScaledVector(J,1/this.mass);this.w.add(new V().crossVectors(r,J).applyMatrix3(Iinv));
    return -vn;
  }
  /* choque contra cajas de edificios (planta XZ): esquinas del auto dentro de la caja y esquinas de la caja dentro del auto */
  collide(world){
    const fwd=this.fwd;fwd.y=0;fwd.normalize();const rt=new V(fwd.z,0,-fwd.x);const hl=2.36,hw=0.92;
    const corners=[[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0]].map(([a,b])=>this.pos.clone().addScaledVector(fwd,a*hl).addScaledVector(rt,b*hw));
    let hit=0;
    for(const blk of world.city.near(this.pos.x,this.pos.z)){const B=blk.boxes;
      for(let k=0;k<B.length;k+=5){
        const x0=B[k],z0=B[k+1],x1=B[k+2],z1=B[k+3];
        if(this.pos.x<x0-3||this.pos.x>x1+3||this.pos.z<z0-3||this.pos.z>z1+3)continue;
        for(const c of corners){
          if(c.x>x0&&c.x<x1&&c.z>z0&&c.z<z1){
            const d=[c.x-x0,x1-c.x,c.z-z0,z1-c.z];let mi=0;for(let i=1;i<4;i++)if(d[i]<d[mi])mi=i;
            const n=new V([-1,1,0,0][mi],0,[0,0,-1,1][mi]);this.pos.addScaledVector(n,d[mi]+0.001);c.addScaledVector(n,d[mi]);
            hit=Math.max(hit,this.impulse(c.clone().setY(this.pos.y),n));
          }
        }
        // esquina del edificio clavada en el costado del auto
        for(const [bx,bz] of [[x0,z0],[x1,z0],[x0,z1],[x1,z1]]){
          const rx=bx-this.pos.x,rz=bz-this.pos.z;const a=rx*fwd.x+rz*fwd.z,b=rx*rt.x+rz*rt.z;
          if(Math.abs(a)<hl&&Math.abs(b)<hw){
            const pa=hl-Math.abs(a),pb=hw-Math.abs(b);let n;
            if(pa<pb){n=fwd.clone().multiplyScalar(-Math.sign(a));this.pos.addScaledVector(n,pa+0.001)}
            else{n=rt.clone().multiplyScalar(-Math.sign(b));this.pos.addScaledVector(n,pb+0.001)}
            hit=Math.max(hit,this.impulse(new V(bx,this.pos.y,bz),n));
          }
        }
      }
    }
    if(hit>1.5&&this.onHit)this.onHit(hit);
  }
  /* actualizar transformaciones visuales */
  sync(dt,braking){
    this.root.position.copy(this.pos);this.root.quaternion.copy(this.q);
    for(const w of this.wheels){
      w.ang+=w.omega*dt;if(!w.piv)continue;
      w.piv.position.set(w.local.x,w.local.y+(w.comp-0.12)*0.6,w.local.z);
      w.piv.rotation.set(0,w.front?this.steer:0,0);w.spin.rotation.set(w.ang,0,0);
    }
    const b=braking?3.2:0.3;this.mats.brake.forEach(m=>m.emissiveIntensity=b);this.mats.tail.forEach(m=>m.emissiveIntensity=braking?4:2.2);
    this.mats.reverse.forEach(m=>m.emissiveIntensity=this.gear===0?3:0);
    this.tailL.intensity=braking?3:1.2;
    this.headL.forEach(s=>s.intensity=this.lightsOn?90:0);this.mats.head.forEach(m=>m.emissiveIntensity=this.lightsOn?3:0.2);
  }
  reset(x,z,yaw){this.pos.set(x,0.75,z);this.q.setFromAxisAngle(new V(0,1,0),yaw);this.vel.set(0,0,0);this.w.set(0,0,0);this.wheels.forEach(w=>{w.omega=0;w.comp=0});this.gear=2}
}
