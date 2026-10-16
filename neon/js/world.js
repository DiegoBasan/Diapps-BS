/* Atmósfera: niebla de altura (más densa en el suelo, con el brillo de la ciudad), cielo procedural con
   estrellas, luna y nubes iluminadas desde abajo, ciclo día/noche, reflejos del entorno y lluvia. */
import * as THREE from "../../shared/vendor/three/three.module.min.js";
import {clamp,lerp,smooth} from "./util.js";

/* uniformes compartidos por todos los materiales procedurales */
export const U={
  uTime:{value:0},uDay:{value:0},uWet:{value:0},uLit:{value:1},
  uSunDir:{value:new THREE.Vector3(0.3,0.5,0.2).normalize()},
  uFogTint:{value:new THREE.Color()},
};

/* --- niebla de altura: reemplaza los chunks de Three para que todos los materiales estándar la usen --- */
const HB=0.0085; // caída de densidad con la altura (1/m)
THREE.ShaderChunk.fog_pars_vertex=`#ifdef USE_FOG
varying float vFogDepth;varying vec3 vFogW;
#endif`;
THREE.ShaderChunk.fog_vertex=`#ifdef USE_FOG
vFogDepth=-mvPosition.z;
vec4 fogP=vec4(position,1.0);
#ifdef USE_INSTANCING
fogP=instanceMatrix*fogP;
#endif
vFogW=(modelMatrix*fogP).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment=`#ifdef USE_FOG
uniform vec3 fogColor;varying float vFogDepth;varying vec3 vFogW;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear;uniform float fogFar;
#endif
float neonFog(vec3 wp,out float glow){
  vec3 rd=wp-cameraPosition;float dist=length(rd);rd/=max(dist,1e-3);
  float b=${HB.toFixed(5)};
  float ry=abs(rd.y)<1e-4?1e-4:rd.y;
  float f=fogDensity*exp(-max(cameraPosition.y,0.0)*b)*(1.0-exp(-dist*ry*b))/(ry*b);
  glow=exp(-max(wp.y,0.0)*0.012);
  return clamp(1.0-exp(-f),0.0,1.0);
}
#endif`;
THREE.ShaderChunk.fog_fragment=`#ifdef USE_FOG
float fogGlow;float fogF=neonFog(vFogW,fogGlow);
vec3 fogC=fogColor*(1.0+fogGlow*0.8);
gl_FragColor.rgb=mix(gl_FragColor.rgb,fogC,fogF);
#endif`;
/* misma función para shaders propios (anuncios, cielo, luces) */
export const FOG_GLSL=`
uniform vec3 fogColor;uniform float fogDensity;
float neonFog(vec3 wp){
  vec3 rd=wp-cameraPosition;float dist=length(rd);rd/=max(dist,1e-3);
  float b=${HB.toFixed(5)};float ry=abs(rd.y)<1e-4?1e-4:rd.y;
  float f=fogDensity*exp(-max(cameraPosition.y,0.0)*b)*(1.0-exp(-dist*ry*b))/(ry*b);
  return clamp(1.0-exp(-f),0.0,1.0);
}`;
export function fogUniforms(scene){return {fogColor:{get value(){return scene.fog.color}},fogDensity:{get value(){return scene.fog.density}}}}

/* --- cielo --- */
function makeSky(scene){
  const m=new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false,
    uniforms:{uTime:U.uTime,uDay:U.uDay,uSunDir:U.uSunDir,uFog:{get value(){return scene.fog.color}},uWet:U.uWet},
    vertexShader:`varying vec3 vDir;void main(){vDir=normalize(position);vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_Position=p.xyww;}`,
    fragmentShader:`
    uniform float uTime,uDay,uWet;uniform vec3 uSunDir,uFog;varying vec3 vDir;
    float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
    float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*n2(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v;}
    void main(){
      vec3 d=normalize(vDir);float y=d.y;
      // degradado noche / día
      vec3 nZen=vec3(0.006,0.008,0.024),nHor=vec3(0.07,0.035,0.10);
      vec3 dZen=vec3(0.10,0.28,0.62),dHor=vec3(0.62,0.74,0.86);
      float t=pow(clamp(1.0-max(y,0.0),0.0,1.0),3.0);
      vec3 col=mix(mix(nZen,nHor,t),mix(dZen,dHor,t),uDay);
      // contaminación lumínica de la ciudad en el horizonte
      col+=vec3(0.55,0.16,0.42)*exp(-max(y,0.0)*7.0)*(1.0-uDay)*0.35;
      // atardecer
      float sunH=uSunDir.y;float dusk=exp(-abs(sunH)*6.0);
      float sd=max(dot(d,uSunDir),0.0);
      col+=vec3(1.0,0.42,0.18)*dusk*pow(sd,4.0)*0.9*exp(-max(y,0.0)*3.0);
      col+=vec3(1.0,0.95,0.85)*pow(sd,900.0)*12.0*step(0.0,sunH);
      col+=vec3(1.0,0.8,0.6)*pow(sd,40.0)*0.35*uDay;
      // estrellas y luna
      vec3 md=normalize(vec3(-uSunDir.x,abs(uSunDir.y)+0.25,-uSunDir.z));
      float night=(1.0-uDay)*(1.0-uWet*0.85);
      vec3 sp=d*160.0;vec3 si=floor(sp);float st=h(si.xy+si.z*17.31);
      float star=step(0.993,st)*smoothstep(0.32,0.0,length(fract(sp)-0.5))*(0.55+0.45*sin(uTime*2.0+st*80.0));
      col+=vec3(0.8,0.85,1.0)*star*night*smoothstep(0.02,0.25,y)*1.6;
      float md2=dot(d,md);col+=vec3(0.85,0.9,1.0)*smoothstep(0.9993,0.9996,md2)*2.2*night;
      col+=vec3(0.3,0.35,0.5)*pow(max(md2,0.0),60.0)*0.25*night;
      // nubes en un plano alto, iluminadas desde abajo por la ciudad
      if(y>0.0){
        vec2 cp=d.xz/(y+0.08)*2.2+vec2(uTime*0.006,uTime*0.002);
        float c=fbm(cp);float cov=mix(0.52,0.30,uWet);
        float cl=smoothstep(cov,cov+0.3,c)*smoothstep(0.0,0.18,y);
        vec3 cn=mix(vec3(0.16,0.06,0.16),vec3(0.05,0.05,0.09),smoothstep(0.0,0.6,y));
        vec3 cd=mix(vec3(0.95,0.95,1.0),vec3(0.55,0.6,0.7),uWet);
        col=mix(col,mix(cn,cd,uDay)+vec3(1.0,0.5,0.3)*dusk*0.25,cl*0.85);
      }
      // bajo el horizonte: se funde con la niebla
      col=mix(col,uFog*1.8,smoothstep(0.08,-0.02,y));
      gl_FragColor=vec4(col,1.0);
    }`
  });
  const s=new THREE.Mesh(new THREE.SphereGeometry(1,48,24),m);
  s.frustumCulled=false;s.renderOrder=-10;s.scale.setScalar(5000);
  return s;
}

/* --- entorno para reflejos: cuarto oscuro con paneles de neón (noche) o cielo (día) --- */
function envScene(day){
  const sc=new THREE.Scene();
  const bg=new THREE.Mesh(new THREE.SphereGeometry(50,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,uniforms:{d:{value:day}},
    vertexShader:`varying vec3 v;void main(){v=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float d;varying vec3 v;void main(){float t=pow(1.0-max(v.y,0.0),3.0);
      vec3 n=mix(vec3(0.01,0.012,0.03),vec3(0.12,0.05,0.14),t)*mix(1.0,0.15,step(v.y,-0.02));
      vec3 dd=mix(vec3(0.35,0.62,1.1),vec3(1.3,1.4,1.5),t)*mix(1.0,0.3,step(v.y,-0.02));
      gl_FragColor=vec4(mix(n,dd,d),1.0);}`}));
  sc.add(bg);
  if(!day){
    const cols=[0xff2bd6,0x19e6ff,0xff7a1a,0x7a5cff,0xff3355,0x2bff9e];
    for(let i=0;i<34;i++){
      const a=i/34*Math.PI*2+Math.sin(i*7.1)*0.2,h=-2+((i*37)%17)*1.2,w=1+((i*13)%5),hh=0.3+((i*7)%4)*0.6;
      const m=new THREE.Mesh(new THREE.PlaneGeometry(w,hh),new THREE.MeshBasicMaterial({color:new THREE.Color(cols[i%cols.length]).multiplyScalar(2.2+(i%3)),side:THREE.DoubleSide}));
      const r=18+(i%5)*3;m.position.set(Math.cos(a)*r,h,Math.sin(a)*r);m.lookAt(0,h,0);sc.add(m);
    }
    for(let i=0;i<60;i++){ // ventanas cálidas
      const a=i*2.399,r=24+(i%7)*2,h=-4+(i%11)*1.5;
      const m=new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.5),new THREE.MeshBasicMaterial({color:new THREE.Color(i%3?0xffc27a:0xbfe0ff).multiplyScalar(1.4),side:THREE.DoubleSide}));
      m.position.set(Math.cos(a)*r,h,Math.sin(a)*r);m.lookAt(0,h,0);sc.add(m);
    }
  }else{
    const sun=new THREE.Mesh(new THREE.SphereGeometry(3,16,8),new THREE.MeshBasicMaterial({color:new THREE.Color(1,0.95,0.85).multiplyScalar(30)}));
    sun.position.set(20,30,10);sc.add(sun);
  }
  return sc;
}

export class Atmosphere{
  constructor(renderer,scene,camera){
    this.r=renderer;this.scene=scene;this.camera=camera;
    scene.fog=new THREE.FogExp2(0x1a0f24,0.0009);
    this.sky=makeSky(scene);scene.add(this.sky);
    const pm=new THREE.PMREMGenerator(renderer);
    this.envNight=pm.fromScene(envScene(0),0.02).texture;
    this.envDay=pm.fromScene(envScene(1),0.02).texture;
    this.pmrem=pm;
    scene.environment=this.envNight;
    this.hemi=new THREE.HemisphereLight(0x6a5cff,0x1a0a18,0.25);scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight(0xbfd0ff,0.4);scene.add(this.sun);scene.add(this.sun.target);
    this.hour=22.5;this.autoTime=false;this.rain=0;this.rainTarget=0;this.flash=0;this.nextFlash=8;
    this.rainFx=this.makeRain(4000);scene.add(this.rainFx);
    this.dyn=null;this.dynT=0;
  }
  setShadows(on,size=2048){
    const l=this.sun;l.castShadow=on;
    if(on){l.shadow.mapSize.set(size,size);const c=l.shadow.camera;c.left=-260;c.right=260;c.top=260;c.bottom=-260;c.near=10;c.far=1400;c.updateProjectionMatrix();l.shadow.bias=-0.0004;l.shadow.normalBias=0.6;}
  }
  setDynamicReflections(on){
    if(on&&!this.dyn){this.dynRT=new THREE.WebGLCubeRenderTarget(128,{type:THREE.HalfFloatType});this.dyn=new THREE.CubeCamera(4,1600,this.dynRT);this.dynEnv=null;}
    if(!on&&this.dyn){this.dyn=null;this.dynRT.dispose();if(this.dynEnv)this.dynEnv.dispose();this.dynEnv=null;}
  }
  makeRain(n){
    const g=new THREE.BufferGeometry();const p=new Float32Array(n*2*3),s=new Float32Array(n*2);
    for(let i=0;i<n;i++){const x=Math.random(),y=Math.random(),z=Math.random();for(let k=0;k<2;k++){p.set([x,y,z],(i*2+k)*3);s[i*2+k]=k}}
    g.setAttribute("position",new THREE.BufferAttribute(p,3));g.setAttribute("aEnd",new THREE.BufferAttribute(s,1));
    const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      uniforms:{uTime:U.uTime,uCam:{value:new THREE.Vector3()},uVel:{value:new THREE.Vector3()},uAmt:{value:0}},
      vertexShader:`uniform float uTime,uAmt;uniform vec3 uCam,uVel;attribute float aEnd;varying float vA;
      void main(){vec3 B=vec3(90.0,70.0,90.0);vec3 p=position*B;p.y-=uTime*38.0+position.x*17.0;
        p=mod(p-uCam+B*0.5,B)-B*0.5+uCam;
        vec3 v=vec3(0.0,-38.0,0.0)-uVel;p+=normalize(v)*aEnd*clamp(length(v)*0.035,0.6,4.0);
        vA=step(fract(position.z*91.7),uAmt)*(0.35+0.65*aEnd);
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);}`,
      fragmentShader:`varying float vA;void main(){if(vA<0.01)discard;gl_FragColor=vec4(vec3(0.55,0.65,0.85)*vA*0.55,1.0);}`});
    const l=new THREE.LineSegments(g,m);l.frustumCulled=false;return l;
  }
  update(dt,camPos,shipVel){
    if(this.autoTime)this.hour=(this.hour+dt*24/600)%24; // un día cada 10 minutos
    const h=this.hour;const ang=(h-6)/24*Math.PI*2; // sol arriba a mediodía
    const sd=U.uSunDir.value.set(Math.cos(ang)*0.8,Math.sin(ang),0.45).normalize();
    const day=smooth(-0.08,0.22,sd.y);U.uDay.value=day;U.uLit.value=1-smooth(0.1,0.6,sd.y)*0.85;
    this.rain=lerp(this.rain,this.rainTarget,1-Math.exp(-dt*0.5));
    U.uWet.value=clamp(Math.max(this.rain,0.35),0,1); // la ciudad siempre algo húmeda
    // niebla
    const fogN=new THREE.Color(0x160c22),fogD=new THREE.Color(0x8fa6c4),fogR=new THREE.Color(0x232430);
    const fc=fogN.clone().lerp(fogD,day);fc.lerp(fogR.clone().lerp(new THREE.Color(0x6e7884),day),this.rain*0.6);
    this.scene.fog.color.copy(fc);this.scene.fog.density=lerp(0.0011,0.0006,day)*(1+this.rain*1.2)*this.fogMul;
    // luz principal: sol o luna
    const moon=sd.y<0;const ld=moon?new THREE.Vector3(-sd.x,Math.abs(sd.y)+0.35,-sd.z).normalize():sd;
    this.sun.position.copy(camPos).addScaledVector(ld,700);this.sun.target.position.copy(camPos);
    this.sun.color.set(moon?0x9fb4ff:0xfff1dc);
    this.sun.intensity=moon?0.35*(1-this.rain*0.6):lerp(0.4,3.2,day)*(1-this.rain*0.55);
    this.hemi.color.set(day>0.5?0xbcd4ff:0x6a5cff);this.hemi.groundColor.set(day>0.5?0x3a3530:0x2a0e22);
    this.hemi.intensity=lerp(0.28,1.6,day);
    // relámpagos
    this.nextFlash-=dt;if(this.rain>0.6&&this.nextFlash<0){this.flash=1;this.nextFlash=6+Math.random()*14;this.onThunder&&this.onThunder()}
    this.flash=Math.max(0,this.flash-dt*(this.flash>0.5?2.5:6));
    const fl=this.flash>0?(Math.sin(this.flash*40)>0?this.flash:this.flash*0.3):0;
    this.hemi.intensity+=fl*3;this.scene.fog.color.offsetHSL(0,0,fl*0.06);
    this.scene.environment=this.dynEnv||(day>0.5?this.envDay:this.envNight);
    this.r.toneMappingExposure=lerp(0.95,1.0,day)+fl*0.4;
    this.sky.position.copy(camPos);
    const rm=this.rainFx.material.uniforms;rm.uCam.value.copy(camPos);rm.uVel.value.copy(shipVel);rm.uAmt.value=this.rain;
    this.rainFx.visible=this.rain>0.02;
  }
  /* reflejos dinámicos: renderiza la ciudad alrededor de la nave en un cubemap cada ~1.2 s */
  updateDynamic(dt,pos,hide){
    if(!this.dyn)return;this.dynT-=dt;if(this.dynT>0)return;this.dynT=1.2;
    hide.forEach(o=>o.visible=false);this.rainFx.visible=false;
    this.dyn.position.copy(pos);this.dyn.update(this.r,this.scene);
    hide.forEach(o=>o.visible=true);
    const old=this.dynEnv;this.dynEnv=this.pmrem.fromCubemap(this.dynRT.texture).texture;if(old)old.dispose();
  }
}
Atmosphere.prototype.fogMul=1;
