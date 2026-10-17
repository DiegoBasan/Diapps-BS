/* Bruma: manejo libre de un Jetta A6 por una ciudad con niebla, lluvia y luces de sodio.
   Motor: Three.js r186 con WebGPURenderer (WebGPU; si el navegador no lo tiene, WebGL2) y posprocesado TSL:
   reflejos en pantalla (SSR) sobre el asfalto mojado, niebla volumétrica iluminada, TRAA, GTAO, bloom y grano. */
import * as THREE from "three/webgpu";
import {pass,mrt,output,normalView,metalness,roughness,vec2,vec3,velocity,packNormalToRGB,unpackRGBToNormal,sample,uniform,
  depthPass,screenUV,renderOutput,Fn,mix,smoothstep,float,length,interleavedGradientNoise,screenCoordinate,fract,luminance,dot,max,pow} from "three/tsl";
import {ssr} from "three/addons/tsl/display/SSRNode.js";
import {traa} from "three/addons/tsl/display/TRAANode.js";
import {ao} from "three/addons/tsl/display/GTAONode.js";
import {bloom} from "three/addons/tsl/display/BloomNode.js";
import {fxaa} from "three/addons/tsl/display/FXAANode.js";
import {film} from "three/addons/tsl/display/FilmNode.js";
import {chromaticAberration} from "three/addons/tsl/display/ChromaticAberrationNode.js";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {MeshoptDecoder} from "three/addons/libs/meshopt_decoder.module.js";
import {mergeGeometries} from "three/addons/utils/BufferGeometryUtils.js";
import {W,GRID,loadTextures,roadMaterial} from "./materials.js";
import {A,setupSky,setupLights,makeVolume,makeRain} from "./atmosphere.js";
import {City,Pool,groundHeight,hash} from "./city.js";
import {Car} from "./car.js";
import {Traffic,Pedestrians} from "./traffic.js";
import {Controls,Sound} from "./controls.js";

const $=s=>document.querySelector(s);
const DBG=new URLSearchParams(location.search);
const isTouch=matchMedia("(pointer:coarse)").matches;
const store={get(){try{return JSON.parse(localStorage.getItem("bruma-v1"))||{}}catch{return {}}},set(v){try{localStorage.setItem("bruma-v1",JSON.stringify(v))}catch{}}};
const S=Object.assign({quality:isTouch?"medio":"alto",weather:"bruma",cam:0,sound:true},store.get());
const save=()=>store.set(S);

const QUALITY={
  bajo:{pr:0.75,ssr:0,vol:0,traa:false,ao:false,shadows:false,radius:360,traffic:12,peds:1},
  medio:{pr:1,ssr:0.5,vol:8,volDepth:false,traa:true,ao:false,shadows:false,radius:380,traffic:16,peds:2},
  alto:{pr:1.5,ssr:0.75,vol:10,volDepth:true,traa:true,ao:true,shadows:false,radius:480,traffic:24,peds:3},
  ultra:{pr:2,ssr:1,vol:14,volDepth:true,traa:true,ao:true,shadows:true,radius:600,traffic:30,peds:4},
};
const WEATHER={
  bruma:{low:0x24423d,high:0x8fb3a6,dens:0.0034,hemi:0.55,sun:0.6,night:0.25,rain:1,wet:1,lamp:90,exp:1.0},
  noche:{low:0x081312,high:0x1f302c,dens:0.004,hemi:0.1,sun:0.05,night:1,rain:1,wet:1,lamp:140,exp:1.25},
  seco:{low:0x2d4740,high:0xa5bfb4,dens:0.0019,hemi:0.7,sun:0.9,night:0.1,rain:0,wet:0.15,lamp:70,exp:0.95},
};

/* --- render --- */
const renderer=new THREE.WebGPURenderer({antialias:false,powerPreference:"high-performance"});
renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1.0;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$("#view").appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,0.1,1400);
let pipeline,ssrNode,volume,rain,city,car,traffic,peds,lights,ground,lampLights=[];
const ctl=new Controls();const snd=new Sound();
const jitter=uniform(0);

function resize(){const q=QUALITY[S.quality];renderer.setPixelRatio(Math.min(devicePixelRatio||1,q.pr)*dyn);renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}
let dyn=1;addEventListener("resize",resize);

function buildPipeline(){
  const q=QUALITY[S.quality];
  pipeline=pipeline||new THREE.RenderPipeline(renderer);pipeline.outputColorTransform=false;
  const scenePass=pass(scene,camera);
  scenePass.setMRT(mrt({output,normal:packNormalToRGB(normalView),metalrough:vec2(metalness,roughness),velocity}));
  const nt=scenePass.getTexture("normal");nt.type=THREE.UnsignedByteType;const mt=scenePass.getTexture("metalrough");mt.type=THREE.UnsignedByteType;
  const color=scenePass.getTextureNode("output"),depth=scenePass.getTextureNode("depth"),vel=scenePass.getTextureNode("velocity");
  const nrm=sample(uv=>unpackRGBToNormal(scenePass.getTextureNode("normal").sample(uv)));
  const mr=scenePass.getTextureNode("metalrough");
  let col=color;
  if(q.ao){const a=ao(depth,nrm,camera);a.resolutionScale=0.5;a.radius.value=1.2;a.thickness.value=2;a.distanceFallOff.value=0.6;col=col.mul(mix(1,a.getTextureNode().r,0.85))}
  if(q.ssr){ssrNode=ssr(color,depth,nrm,{metalnessNode:mr.r,roughnessNode:mr.g});ssrNode.resolutionScale=q.ssr;ssrNode.maxDistance.value=90;ssrNode.thickness.value=0.6;ssrNode.quality.value=q.ssr>0.7?0.7:0.45;ssrNode.intensity.value=1.15;
    col=col.add(ssrNode.rgb)}else ssrNode=null;
  let aa=q.traa?traa(col,depth,vel,camera):col;
  const glow=bloom(aa,0.42,0.55,0.62);
  let img=aa.add(glow);
  // toneado AgX y gradación: sombras verdosas, luces cálidas, viñeta, aberración y grano
  let out=renderOutput(img);
  if(!q.traa)out=fxaa(out);
  const graded=Fn(()=>{
    const c=out.toVar();const l=luminance(c);
    const shadowTint=vec3(0.86,1.03,1.0),hiTint=vec3(1.06,0.99,0.92);
    c.assign(c.mul(mix(shadowTint,hiTint,smoothstep(0.1,0.75,l))));
    c.assign(mix(vec3(l),c,0.88));                          // un poco desaturado, como la foto
    c.assign(c.mul(vec3(1.0)).add(vec3(0.012,0.02,0.018))); // negros levantados por la niebla
    const v=length(screenUV.sub(0.5).mul(vec2(1.0,0.75)));
    c.assign(c.mul(smoothstep(0.85,0.25,v).mul(0.45).add(0.55)));
    return c;
  })();
  const ca=chromaticAberration(graded,0.12,vec2(0.5,0.5),1.02);
  pipeline.outputNode=DBG.has('nopost')?renderOutput(color):film(ca,float(0.05));
  pipeline.needsUpdate=true;
  return scenePass;
}

/* --- carga de modelos --- */
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const FILES=["jetta","corolla","hk_proc","asian_tower","soviet","atlanta","london","brutal_tower","cyber_apart","asian_shops","street_lamp","crowd"];
function partsOf(root){
  root.updateMatrixWorld(true);const by=new Map();
  // las mallas vienen cuantizadas (meshopt): pasar a Float32 antes de transformar o se recortan
  const deq=g=>{for(const k of Object.keys(g.attributes)){const a=g.attributes[k];if(a.array instanceof Float32Array&&!a.normalized&&!a.isInterleavedBufferAttribute)continue;
    const n=a.count,s=a.itemSize,f=new Float32Array(n*s);for(let i=0;i<n;i++)for(let c=0;c<s;c++)f[i*s+c]=a.getComponent(i,c);g.setAttribute(k,new THREE.BufferAttribute(f,s))}return g};
  root.traverse(o=>{if(o.isMesh&&!o.isSkinnedMesh){const g=deq(o.geometry.clone()).applyMatrix4(o.matrixWorld);for(const k of Object.keys(g.attributes))if(!["position","normal","uv"].includes(k))g.deleteAttribute(k);
    if(!g.attributes.normal)g.computeVertexNormals();if(!g.attributes.uv)g.setAttribute("uv",new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
    const m=Array.isArray(o.material)?o.material[0]:o.material;if(!by.has(m))by.set(m,[]);by.get(m).push(g.index?g.toNonIndexed():g)}});
  const box=new THREE.Box3();const out=[];
  for(const [m,gs] of by){const g=gs.length>1?mergeGeometries(gs):gs[0];g.computeBoundingBox();box.union(g.boundingBox);out.push({geometry:g,material:m})}
  // centrar en x/z y base en y=0
  const c=box.getCenter(new THREE.Vector3());out.forEach(p=>{p.geometry.translate(-c.x,-box.min.y,-c.z);p.geometry.computeBoundingBox();p.geometry.computeBoundingSphere()});
  return out;
}

async function boot(){
  await renderer.init();
  $("#api").textContent=renderer.backend.isWebGPUBackend?"WebGPU":"WebGL2";
  resize();loadTextures();
  const bar=$("#load b"),lbl=$("#load small");let n=0;const M={};
  await Promise.all(FILES.map(async f=>{M[f]=await loader.loadAsync("models/"+f+".glb");n++;bar.style.width=(n/FILES.length*75)+"%";lbl.textContent="Cargando "+f}));
  // escena
  if(!DBG.has('nofog'))setupSky(scene);lights=setupLights(scene);
  ground=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600,1,1).rotateX(-Math.PI/2),DBG.has('noroad')?new THREE.MeshStandardNodeMaterial({color:0x333333}):roadMaterial());ground.receiveShadow=true;scene.add(ground);
  const pools={};
  for(const k of ["hk_proc","asian_tower","soviet","atlanta","london","brutal_tower","cyber_apart","asian_shops"])pools[k]=new Pool(scene,partsOf(M[k].scene),k==="asian_shops"?220:["atlanta","london","brutal_tower"].includes(k)?30:160);
  pools.lamp=new Pool(scene,partsOf(M.street_lamp.scene),500);
  // vidrios y letreros de los locales brillan de noche
  pools.asian_shops.meshes.forEach(m=>{const n=m.material.name||"";if(/emis|emmis/i.test(n)&&m.material.map){m.material.emissiveMap=m.material.map;m.material.emissive=new THREE.Color(1,1,1);m.material.emissiveIntensity=2.2}});
  pools.lamp.meshes.forEach(m=>{m.material.roughness=0.45});
  city=new City(scene,pools);
  // Jetta
  const jm=M.jetta.scene;const jb=new THREE.Box3().setFromObject(jm);const js=4.64/(jb.max.z-jb.min.z);jm.scale.setScalar(js);
  jb.setFromObject(jm);const jc=jb.getCenter(new THREE.Vector3());jm.position.set(-jc.x,-jb.min.y-0.55,-jc.z);
  car=new Car(jm);scene.add(car.root);car.root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});
  car.reset(-2.2,40,0);car.onHit=s=>{snd.thump(s);shake=Math.min(1,shake+s/14)};
  traffic=new Traffic(scene,partsOf(M.corolla.scene),30);
  peds=new Pedestrians(scene,M.crowd,4);peds.chars.forEach(c=>c.arm.traverse(o=>{if(o.isMesh)o.frustumCulled=false}));scene.traverse(o=>{if(o.isSkinnedMesh)o.frustumCulled=false});
  // faroles: un grupo fijo de luces reales que se asigna a los faroles más cercanos
  for(let i=0;i<10;i++){const s=new THREE.SpotLight(0xff9a3c,0,48,0.78,0.6,1.7);s.position.set(0,-100,0);s.target.position.set(0,-200,0);scene.add(s,s.target);lampLights.push(s)}
  const glowMat=new THREE.MeshBasicNodeMaterial({color:new THREE.Color(1,0.62,0.25).multiplyScalar(18)});
  lampGlow=new THREE.InstancedMesh(new THREE.SphereGeometry(0.22,10,6),glowMat,64);lampGlow.frustumCulled=false;scene.add(lampGlow);
  if(!DBG.has('norain'))rain=makeRain(scene,isTouch?4000:7000);
  applyWeather();applyQuality();
  lbl.textContent="Levantando la ciudad…";
  let left=1,it=0;while(left>0&&it<300){left=city.update(car.pos,8);it++;bar.style.width=(75+Math.min(25,it/3))+"%";if(it%3===0)await new Promise(r=>setTimeout(r,0))}
  $("#load").classList.add("gone");openMenu(!DBG.has("play"));
  renderer.setAnimationLoop(loop);
}
let lampGlow;

function applyQuality(){
  const q=QUALITY[S.quality];city.radius=q.radius;
  // cielo cubierto: sin sombra del sol (ahorra un pase completo de la ciudad); los faros sí proyectan sombra en Ultra
  car.setShadows(S.quality==="ultra");lights.sun.castShadow=false;
  const sp=buildPipeline();
  if(volume){scene.remove(volume);volume.geometry.dispose();volume=null}
  if(q.vol&&!DBG.has('novol')){let dn=null;if(q.volDepth){const pre=depthPass(scene,camera);pre.transparent=false;dn=pre.getTextureNode("depth").sample(screenUV)}volume=makeVolume(scene,dn,jitter);volume.material.steps=q.vol}
  traffic.n=Math.min(30,q.traffic);traffic.cars.length=0;
  peds.mixers.forEach((m,i)=>{});peds.active=q.peds;
  resize();
}
function applyWeather(){
  const w=WEATHER[S.weather];A.low.value.set(w.low);A.high.value.set(w.high);A.fogDensity.value=w.dens;
  lights.hemi.intensity=w.hemi;lights.sun.intensity=w.sun;W.night.value=w.night;W.rain.value=w.rain;W.wet.value=w.wet;
  renderer.toneMappingExposure=w.exp;lampPower=w.lamp;if(rain)rain.visible=w.rain>0;
}
let lampPower=90;

/* --- cámara --- */
const CAMS=["Persecución","Cinemática","Cofre","Cabina"];
let camPos=new THREE.Vector3(-2,3,30),camLook=new THREE.Vector3(),camYaw=0,shake=0,orbit=0;
function updateCamera(dt,menu){
  if(DBG.has('cam')){const v=DBG.get('cam').split(',').map(Number);camera.position.set(car.pos.x+v[0],v[1],car.pos.z+v[2]);camera.lookAt(car.pos.x+v[3],v[4],car.pos.z+v[5]);camera.fov=v[6]||60;camera.updateProjectionMatrix();return}
  const fwd=car.fwd;const yaw=Math.atan2(fwd.x,fwd.z);
  if(menu){orbit+=dt*0.12;const r=7.2;const p=car.pos;camera.position.set(p.x+Math.sin(orbit)*r,1.25,p.z+Math.cos(orbit)*r);camera.lookAt(p.x,0.75,p.z);camera.fov=42;camera.updateProjectionMatrix();return}
  let dy=yaw-camYaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));camYaw+=dy*(1-Math.exp(-dt*(S.cam===1?2.2:4.2)));
  const sp=car.speed;const ay=camYaw+ctl.look*1.4;
  if(S.cam===2||S.cam===3){
    const local=S.cam===2?new THREE.Vector3(0,0.95,0.6):new THREE.Vector3(0.37,0.62,-0.32);
    camera.position.copy(local.applyQuaternion(car.q).add(car.pos));
    const t=new THREE.Vector3(0,S.cam===2?0.75:0.55,30).applyQuaternion(car.q).add(car.pos);camera.up.set(0,1,0);camera.lookAt(t);
  }else{
    const cine=S.cam===1;
    const back=cine?6.8:5.9+sp*0.03,h=cine?0.85:1.75+sp*0.006,side=cine?1.5:0;
    const want=new THREE.Vector3(car.pos.x-Math.sin(ay)*back+Math.cos(ay)*side,Math.max(groundHeight(car.pos.x,car.pos.z)+0.4,car.pos.y+h),car.pos.z-Math.cos(ay)*back-Math.sin(ay)*side);
    const from=car.pos.clone().setY(car.pos.y+1.2);const t=city.segment(from,want);if(t<1)want.lerpVectors(from,want,Math.max(0.2,t*0.9));
    const k=cine?3:10;camPos.x+=(want.x-camPos.x)*(1-Math.exp(-dt*k));camPos.y+=(want.y-camPos.y)*(1-Math.exp(-dt*k*0.8));camPos.z+=(want.z-camPos.z)*(1-Math.exp(-dt*k));
    camera.position.copy(camPos);
    const look=car.pos.clone().add(new THREE.Vector3(Math.sin(ay)*3,cine?1.6:0.9,Math.cos(ay)*3));camLook.lerp(look,1-Math.exp(-dt*12));
    camera.up.set(0,1,0);camera.lookAt(camLook);
  }
  if(shake>0){const t=performance.now()/1000;camera.position.x+=Math.sin(t*57)*shake*0.08;camera.position.y+=Math.sin(t*43)*shake*0.06;shake=Math.max(0,shake-dt*2.5)}
  const fov=(S.cam>=2?72:58)+Math.min(1,sp/50)*9;camera.fov+=(fov-camera.fov)*(1-Math.exp(-dt*3));camera.updateProjectionMatrix();
}

/* --- HUD --- */
const ANAMES=["Insurgentes","Niebla","Reforma","Ceniza","Cobalto","Sodio","Ámbar","Bruma","Hierro","Vapor","Plata","Marea"];
function place(){const i=Math.round(car.pos.x/GRID.BX),j=Math.round(car.pos.z/GRID.BZ);
  const av="Av. "+ANAMES[((i%12)+12)%12];const st="Calle "+(j>=0?j+1:"S"+(-j));
  const onAv=Math.abs(car.pos.x-i*GRID.BX)<GRID.AV/2;return onAv?av:st+" · "+av}
let hudT=0,lastPlace="";
function hud(dt){
  hudT-=dt;if(hudT>0)return;hudT=0.06;
  const kmh=Math.abs(Math.round(car.kmh));$("#spd").textContent=kmh;
  $("#gear").textContent=car.gear===0?"R":car.speed<0.5&&!car.input.thr?"N":"D"+(car.gear-1);
  $("#rpm").style.setProperty("--r",Math.min(1,car.rpm/7000));$("#rpm").classList.toggle("red",car.rpm>6000);
  const p=place();if(p!==lastPlace){lastPlace=p;$("#place").textContent=p}
  $("#fps").textContent=Math.round(1/Math.max(1e-3,avgDt))+" fps · "+$("#api").textContent;
}

/* --- menús --- */
let menu=true;
function openMenu(v){menu=v;document.body.classList.toggle("menu",v);if(v)car.input={thr:0,brake:0,steer:0,hand:false}}
$("#go").onclick=()=>{snd.start();snd.setOn(S.sound);openMenu(false)};
$("#bMenu").onclick=()=>openMenu(true);
$("#bCam").onclick=()=>{S.cam=(S.cam+1)%CAMS.length;save();toast("Cámara: "+CAMS[S.cam])};
$("#bLights").onclick=()=>{car.lightsOn=!car.lightsOn};
const qs=$("#quality");qs.value=S.quality;qs.onchange=()=>{S.quality=qs.value;save();dyn=1;applyQuality()};
const ws=$("#weather");ws.value=S.weather;ws.onchange=()=>{S.weather=ws.value;save();applyWeather()};
const sn=$("#sound");sn.checked=S.sound;sn.onchange=()=>{S.sound=sn.checked;save();snd.setOn(S.sound)};
ctl.bindTouch(document.body);if(isTouch)document.body.classList.add("touch");
let toastT=0;function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");toastT=2.5}

/* --- bucle --- */
let last=performance.now(),acc=0,avgDt=1/60,frame=0,slowT=0,fastT=0;
function loop(){
  const now=performance.now();let dt=Math.min(0.1,(now-last)/1000);last=now;avgDt+=(dt-avgDt)*0.05;W.time.value+=dt;frame++;
  jitter.value=(frame%32)/32;
  if(avgDt>1/34){slowT+=dt;if(slowT>2.5&&dyn>0.6){dyn-=0.1;slowT=0;resize()}}else if(avgDt<1/55){fastT+=dt;if(fastT>6&&dyn<1){dyn=Math.min(1,dyn+0.1);fastT=0;resize()}}else slowT=fastT=0;
  if(ctl.take("Escape"))openMenu(!menu);
  if(!menu){
    if(ctl.take("KeyC")||ctl.take("Pad3")){S.cam=(S.cam+1)%CAMS.length;save();toast("Cámara: "+CAMS[S.cam])}
    if(ctl.take("KeyL"))car.lightsOn=!car.lightsOn;
    if(ctl.take("KeyR")){const i=Math.round(car.pos.x/GRID.BX);car.reset(i*GRID.BX-2.2,car.pos.z,0);toast("Auto en el carril")}
    ctl.read(car.input,dt);
  }
  // física a 240 Hz
  acc+=dt;const h=1/240;let n=0;const world={city,wet:W.wet.value};
  while(acc>=h&&n<40){car.step(h,world);acc-=h;n++}if(n>=40)acc=0;
  const braking=car.input.brake>0.1&&car.gear!==0||car.input.hand;
  car.sync(dt,braking);
  city.update(car.pos,1);ground.position.set(Math.round(car.pos.x/50)*50,0,Math.round(car.pos.z/50)*50);
  traffic.update(dt,car);peds.update(dt,city,car.pos);
  // luces de faroles más cercanos
  const near=city.lampsNear(camera.position.x,camera.position.z,lampLights.length);
  lampLights.forEach((s,i)=>{const l=near[i];if(!l){s.intensity=0;return}s.position.set(l.x,l.y,l.z);s.target.position.set(l.x-l.face*2.5,0,l.z);s.intensity=lampPower;s.target.updateMatrixWorld()});
  let gi=0;const m4=new THREE.Matrix4();for(const b of city.near(camera.position.x,camera.position.z))for(const l of b.lamps){if(gi>=64)break;m4.makeTranslation(l.x,l.y+0.05,l.z);lampGlow.setMatrixAt(gi++,m4)}
  lampGlow.count=gi;lampGlow.instanceMatrix.needsUpdate=true;
  updateCamera(dt,menu);
  A.camPos.value.copy(camera.position);if(volume)volume.position.set(camera.position.x,30,camera.position.z);
  lights.sun.position.set(camera.position.x-60,220,camera.position.z+40);lights.sun.target.position.set(camera.position.x,0,camera.position.z);lights.sun.target.updateMatrixWorld();
  snd.update(car,W.rain.value,S.cam===3);
  toastT-=dt;if(toastT<0)$("#toast").classList.remove("on");
  if(!menu)hud(dt);
  pipeline.render();
}
window.__bruma={get car(){return car},get city(){return city},camera,scene,renderer,S,openMenu,applyQuality,applyWeather,
  sim(sec,inp={}){const h=1/240;const world={city,wet:W.wet.value};for(let t=0;t<sec;t+=h){Object.assign(car.input,inp);car.step(h,world);if(((t/h)|0)%24===0){traffic.update(h*24,car);city.update(car.pos,1)}}
    car.sync(0,false);while(city.update(car.pos,8)>0);for(let k=0;k<60;k++)updateCamera(1/30,false);return {p:car.pos.toArray().map(v=>+v.toFixed(2)),kmh:Math.round(car.kmh),gear:car.gear,rpm:Math.round(car.rpm)}}};
boot().catch(e=>{console.error(e);$("#load small").textContent="Error: "+e.message});
if("serviceWorker" in navigator&&location.protocol!=="file:")addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
