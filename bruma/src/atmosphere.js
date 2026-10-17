/* Atmósfera: cielo cubierto verde azulado, niebla por distancia y altura, volumen de niebla iluminada
   (raymarching con las luces reales de la escena: faroles y faros dibujan conos de luz) y lluvia. */
import * as THREE from "three/webgpu";
import {color,mix,smoothstep,positionWorld,positionWorldDirection,fog,densityFogFactor,exponentialHeightFogFactor,uniform,
  vec3,vec2,float,Fn,texture3D,time,max,attribute,positionLocal,cameraPosition,mod,vec4,interleavedGradientNoise,screenCoordinate,fract,screenUV,positionView} from "three/tsl";
import {ImprovedNoise} from "three/addons/math/ImprovedNoise.js";
import {W} from "./materials.js";

export const A={
  fogDensity:uniform(0.0055),fogHeight:uniform(22),
  low:uniform(new THREE.Color(0x24423d)),high:uniform(new THREE.Color(0x8fb3a6)),
  smoke:uniform(1.0),volI:uniform(0.6),camPos:uniform(new THREE.Vector3()),
};

export function setupSky(scene){
  const d=positionWorldDirection;
  const sky=mix(A.low.mul(1.25),A.high,smoothstep(-0.05,0.55,d.y)).add(vec3(0.07,0.09,0.08).mul(smoothstep(0.3,1.0,d.y)));
  scene.backgroundNode=sky;
  // niebla exponencial cuadrada, más densa cerca del suelo con una caída suave (sin bordes)
  const dist=positionView.length();
  const hk=float(1).add(positionWorld.y.max(0).div(A.fogHeight).negate().exp().mul(1.6));
  const dd=A.fogDensity.mul(dist);
  const f=dd.mul(dd).mul(hk).negate().exp().oneMinus().mul(0.97);
  const fc=mix(A.low,A.high.mul(0.92),smoothstep(-20,260,positionWorld.y));
  scene.fogNode=fog(fc,f);
}

export function setupLights(scene){
  const hemi=new THREE.HemisphereLight(0x9fc4b8,0x1a1f1c,0.55);scene.add(hemi);
  // luz cenital difusa del cielo cubierto (sombra suave para dar volumen a los edificios)
  const sun=new THREE.DirectionalLight(0xb9d8cf,0.6);sun.position.set(-60,220,40);scene.add(sun);scene.add(sun.target);
  return {hemi,sun};
}

/* textura 3D de ruido para la densidad de la niebla */
function noise3D(size=64){
  const data=new Uint8Array(size*size*size);const p=new ImprovedNoise();let i=0;
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const s=4/size;let v=p.noise(x*s,y*s,z*s)*0.6+p.noise(x*s*2.3,y*s*2.3,z*s*2.3)*0.3;data[i++]=128+128*v}
  const t=new THREE.Data3DTexture(data,size,size,size);t.format=THREE.RedFormat;t.minFilter=t.magFilter=THREE.LinearFilter;
  t.wrapS=t.wrapT=t.wrapR=THREE.RepeatWrapping;t.unpackAlignment=1;t.needsUpdate=true;return t;
}

/* volumen de niebla iluminada que sigue a la cámara */
export function makeVolume(scene,depthNode,offsetU){
  const tex=noise3D(64);
  const m=new THREE.VolumeNodeMaterial();m.steps=10;m.transparent=true;m.blending=THREE.AdditiveBlending;m.depthWrite=false;
  m.offsetNode=offsetU;
  m.scatteringNode=Fn(({positionRay})=>{
    const t=vec3(time.mul(0.6),0,time.mul(0.25));
    const g=(s,k=1)=>texture3D(tex,positionRay.add(t.mul(k)).mul(s).mod(1),0).r.add(0.5);
    let dns=g(0.018).mul(g(0.045,1.6));
    // más densa cerca del suelo
    dns=dns.mul(smoothstep(42,2,positionRay.y).mul(0.85).add(0.15));
    // desvanecer hacia los bordes de la caja para que no se note dónde termina
    const dxz=positionRay.xz.sub(A.camPos.xz).length();
    dns=dns.mul(smoothstep(108,55,dxz)).mul(smoothstep(58,40,positionRay.y));
    return A.smoke.mix(1,dns).mul(A.volI).mul(0.55);
  });
  if(depthNode)m.depthNode=depthNode;
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(220,60,220),m);mesh.position.y=30;mesh.frustumCulled=false;mesh.renderOrder=10;
  scene.add(mesh);return mesh;
}

/* lluvia: segmentos que caen en una caja alrededor de la cámara */
export function makeRain(scene,n=7000){
  const g=new THREE.BufferGeometry();const p=new Float32Array(n*6),e=new Float32Array(n*2);
  for(let i=0;i<n;i++){const x=Math.random(),y=Math.random(),z=Math.random();p.set([x,y,z,x,y,z],i*6);e[i*2]=0;e[i*2+1]=1}
  g.setAttribute("position",new THREE.BufferAttribute(p,3));g.setAttribute("aEnd",new THREE.BufferAttribute(e,1));
  const m=new THREE.LineBasicNodeMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
  const B=vec3(70,40,70);
  const pos=Fn(()=>{
    const base=positionLocal.mul(B);
    const fall=time.mul(22).add(positionLocal.x.mul(31));
    const q=base.sub(vec3(0,fall,0)).sub(A.camPos).add(B.mul(0.5)).mod(B).sub(B.mul(0.5)).add(A.camPos);
    return q.add(vec3(0.15,-0.9,0.05).mul(attribute("aEnd")));
  })();
  m.positionNode=pos;
  m.colorNode=vec3(0.55,0.65,0.62).mul(0.22).mul(W.rain);
  const l=new THREE.LineSegments(g,m);l.frustumCulled=false;scene.add(l);return l;
}
