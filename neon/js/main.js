/* Neón: mundo abierto en una ciudad procedural infinita, volando una nave futurista. */
import * as THREE from "../../shared/vendor/three/three.module.min.js";
import {U,Atmosphere} from "./world.js";
import {City,Ground,Pool,BLOCK,CHUNK,PYR} from "./city.js";
import {loadAll,parts,vehicleParts,toGroup,tuneMaterials,CREDITS} from "./assets.js";
import {Ship,SHIPS} from "./ship.js";
import {Traffic,Drones} from "./traffic.js";
import {Input} from "./input.js";
import {Post} from "./fx.js";
import {Sound} from "./audio.js";
import {clamp,damp,lerp,hash2,isTouch,isMobile,pick} from "./util.js";

const $=s=>document.querySelector(s);
const store={get(){try{return JSON.parse(localStorage.getItem("neon-v1"))||{}}catch{return {}}},set(v){try{localStorage.setItem("neon-v1",JSON.stringify(v))}catch{}}};
const S=Object.assign({quality:isMobile?"medio":"alto",ship:0,hour:22.5,auto:false,rain:false,sound:true,invert:false,cam:0,best:null},store.get());
const save=()=>store.set(S);

const QUALITY={
  bajo:{pr:0.75,rad:2,ao:false,shadows:false,traffic:50,dyn:false},
  medio:{pr:1.25,rad:3,ao:false,shadows:false,traffic:110,dyn:false},
  alto:{pr:1.75,rad:4,ao:true,shadows:true,traffic:170,dyn:false},
  ultra:{pr:2,rad:5,ao:true,shadows:true,traffic:240,dyn:true},
};

/* --- render --- */
const canvas=$("#c");
const renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:"high-performance",stencil:false});
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(70,innerWidth/innerHeight,0.3,6000);
const atm=new Atmosphere(renderer,scene,camera);
const ground=new Ground(scene);
const post=new Post(renderer,scene,camera);
const input=new Input(canvas);
const sound=new Sound();
let dynScale=1,city,ship,traffic,drones,models,shipGroups=[];

function applyQuality(){
  const q=QUALITY[S.quality];
  if(city){city.radius=q.rad;city.setShadows(q.shadows)}
  atm.fogMul=clamp(3.4/q.rad,0.75,1.8);
  renderer.shadowMap.enabled=q.shadows;atm.setShadows(q.shadows,isMobile?1024:2048);
  scene.traverse(o=>{if(o.material)[].concat(o.material).forEach(m=>m.needsUpdate=true)});
  post.setAO(q.ao,isMobile);atm.setDynamicReflections(q.dyn);
  if(traffic)traffic.setCount(q.traffic);
  resize();
}
function resize(){
  const q=QUALITY[S.quality];const pr=Math.min(devicePixelRatio||1,q.pr)*dynScale;
  renderer.setPixelRatio(pr);renderer.setSize(innerWidth,innerHeight,false);
  camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();post.setSize(innerWidth,innerHeight,pr);
}
addEventListener("resize",resize);

/* --- carga --- */
async function boot(){
  const bar=$("#load b"),lbl=$("#load small");
  models=await loadAll("models/",(f,c)=>{bar.style.width=(f*70)+"%";lbl.textContent="Modelo: "+c.name+" — "+c.author});
  tuneMaterials(models);
  city=new City(scene);
  const pools={
    pyramid:new Pool(scene,parts(models.pyramid),1),
    g1:new Pool(scene,parts(models.g1building),60),
    tower:new Pool(scene,parts(models.tower),60),
    neonset:new Pool(scene,parts(models.neonset),260),
    neonletters:new Pool(scene,parts(models.neonletters),260),
  };
  city.setPools(pools);
  ship=new Ship(scene);
  shipGroups=SHIPS.map(d=>toGroup(vehicleParts(models[d.id],d.id)));
  setShip(S.ship);
  const ttypes=["veh026","blnk100","veh007","scificar","hovercar"].map(k=>({key:k,parts:vehicleParts(models[k],k)}));
  traffic=new Traffic(scene,ttypes,QUALITY.ultra.traffic);
  drones=new Drones(scene,vehicleParts(models.policedrone,"policedrone"),12);
  ship.onHit=s=>{sound.thump(s);shake=Math.min(1.2,shake+s/25)};
  atm.onThunder=()=>sound.thunder();
  atm.hour=S.hour;atm.autoTime=S.auto;atm.rainTarget=atm.rain=S.rain?1:0;input.invert=S.invert;sound.setOn(S.sound);
  applyQuality();
  ship.pos.set(0,45,420);ship.yaw=0;
  // precarga de chunks alrededor del inicio
  lbl.textContent="Generando la ciudad…";
  let left=1,it=0;
  while(left>0&&it<400){left=city.update(ship.pos,6);ground.update(ship.pos);it++;bar.style.width=(70+Math.min(30,it))+"%";if(it%4===0)await new Promise(r=>setTimeout(r,0))}
  renderer.compile(scene,camera);
  $("#load").classList.add("gone");
  buildMenu();openMenu("garage");
  requestAnimationFrame(loop);
}
function setShip(i){
  S.ship=i;save();ship.setModel(shipGroups[i],SHIPS[i]);
  // la cámara se ajusta al tamaño de la nave
  sizeK=clamp(ship.radius/2.6,0.85,1.6);
}

/* --- cámara --- */
let camYaw=0,camPos=new THREE.Vector3(0,60,470),camLook=new THREE.Vector3(),shake=0,sizeK=1,orbit=0;
const CAMS=["Persecución","Lejana","Cabina","Cine"];
function updateCamera(dt,menu){
  const s=ship,sp=s.speed;const L=input.look;
  if(!L.active&&!L.pad){L.x=damp(L.x,0,2.5,dt);L.y=damp(L.y,0,2.5,dt)}
  if(menu){ // vista del hangar: órbita lenta alrededor de la nave
    orbit+=dt*0.25;const r=12*sizeK;
    camPos.set(s.pos.x+Math.sin(orbit)*r,s.pos.y+2.5*sizeK,s.pos.z+Math.cos(orbit)*r);camera.position.copy(camPos);
    camera.up.set(0,1,0);camera.lookAt(s.pos.x,s.pos.y+0.3,s.pos.z);camera.fov=45;camera.updateProjectionMatrix();return;
  }
  const mode=S.cam;
  let dy=s.yaw-camYaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));camYaw+=dy*(1-Math.exp(-(mode===1?3:5)*dt));
  if(mode===2){ // cabina
    const p=new THREE.Vector3(0,s.halfH*0.75,-(s.box.max.z-s.box.min.z)*0.12);s.body.localToWorld(p);camera.position.copy(p);
    const q=s.body.getWorldQuaternion(new THREE.Quaternion());camera.quaternion.copy(q);camera.rotateY(-L.x);camera.rotateX(-L.y*0.6);
  }else{
    const cine=mode===3;const ay=camYaw+L.x+(cine?Math.sin(U.uTime.value*0.15)*1.2:0);
    const back=(mode===1?20:cine?16:11)*sizeK+sp*0.045,hgt=(mode===1?7:cine?2:3.2)*sizeK+sp*0.012+L.y*back*0.7-s.pitch*3;
    const want=new THREE.Vector3(s.pos.x+Math.sin(ay)*back,s.pos.y+hgt,s.pos.z+Math.cos(ay)*back);
    const t=city.segment(s.pos,want);if(t<1)want.lerpVectors(s.pos,want,Math.max(0.15,t*0.85));
    want.y=Math.max(want.y,1.5);
    const k=cine?2.5:9;camPos.x=damp(camPos.x,want.x,k,dt);camPos.y=damp(camPos.y,want.y,k,dt);camPos.z=damp(camPos.z,want.z,k,dt);
    const look=s.pos.clone().addScaledVector(s.fwd,8*sizeK).add(new THREE.Vector3(0,1*sizeK,0)).addScaledVector(s.vel,0.05);
    camLook.lerp(look,1-Math.exp(-14*dt));
    camera.position.copy(camPos);
    camera.up.set(0,1,0);camera.lookAt(camLook);camera.rotateZ(s.roll*0.22);
  }
  // sacudida: impactos y turbo
  const sh=shake*0.35+(s.boosting?0.05:0)+Math.max(0,sp-90)*0.0007;shake=Math.max(0,shake-dt*2.2);
  if(sh>0){const t=U.uTime.value;camera.position.x+=Math.sin(t*61)*sh;camera.position.y+=Math.sin(t*47+1)*sh;camera.rotateZ(Math.sin(t*33)*sh*0.02)}
  const fov=(mode===2?78:66)+clamp(sp/130,0,1)*18+(s.boosting?8:0);camera.fov=damp(camera.fov,fov,3,dt);camera.updateProjectionMatrix();
}

/* --- carrera de anillos --- */
const race={on:false,rings:[],i:0,t:0,mesh:null};
const ringMat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,side:THREE.DoubleSide,
  uniforms:{uTime:U.uTime},vertexShader:`attribute float aOn;varying float vOn;varying vec2 vUv;void main(){vUv=uv;vOn=1.;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform float uTime;varying vec2 vUv;void main(){float p=0.5+0.5*sin(vUv.x*60.-uTime*6.);gl_FragColor=vec4(vec3(1.,.85,.25)*(1.2+p*1.6),1.);}`});
function startRace(){
  const n=12;race.rings=[];
  let x=Math.round(ship.pos.x/BLOCK)*BLOCK,z=Math.round(ship.pos.z/BLOCK)*BLOCK;
  let dir=Math.abs(Math.sin(ship.yaw))>Math.abs(Math.cos(ship.yaw))?[-Math.sign(Math.sin(ship.yaw)),0]:[0,-Math.sign(Math.cos(ship.yaw))];
  let y=clamp(ship.pos.y,25,120);
  for(let i=0;i<n;i++){
    const steps=1+Math.floor(Math.random()*2),px=x,pz=z;
    for(let k=0;k<steps;k++){x+=dir[0]*BLOCK;z+=dir[1]*BLOCK}
    y=clamp(y+(Math.random()-0.45)*50,18,170);
    // anillos alternados: a media calle o en el cruce, siempre sobre el tramo recorrido
    const mid=i%2===0;const rx=mid?(px+x)/2:x,rz=mid?(pz+z)/2:z;
    race.rings.push({p:new THREE.Vector3(rx,y,rz),yaw:dir[0]?Math.PI/2:0});
    if(Math.random()<0.45)dir=Math.random()<0.5?[dir[1],-dir[0]]:[-dir[1],dir[0]];
  }
  if(!race.mesh){race.mesh=new THREE.InstancedMesh(new THREE.TorusGeometry(9,0.55,10,48),ringMat,24);race.mesh.frustumCulled=false;scene.add(race.mesh)}
  race.on=true;race.i=0;race.t=0;placeRings();$("#race").classList.add("on");toast("Carrera: cruza los 12 anillos");
}
function placeRings(){
  const m=new THREE.Matrix4();race.mesh.count=race.rings.length;
  race.rings.forEach((r,i)=>{const s=i<race.i?0:i===race.i?1:0.6;m.compose(r.p,new THREE.Quaternion().setFromEuler(new THREE.Euler(0,r.yaw,0)),new THREE.Vector3(s,s,s));race.mesh.setMatrixAt(i,m)});
  race.mesh.instanceMatrix.needsUpdate=true;
}
function stopRace(msg){race.on=false;if(race.mesh)race.mesh.count=0;$("#race").classList.remove("on");if(msg)toast(msg)}
function updateRace(dt){
  if(!race.on)return;race.t+=dt;const r=race.rings[race.i];
  if(ship.pos.distanceTo(r.p)<10.5){race.i++;sound.chime();
    if(race.i>=race.rings.length){const t=race.t;const best=S.best;if(!best||t<best){S.best=t;save()}stopRace(`¡Meta! ${fmt(t)}${!best||t<best?" · nuevo récord":""}`);return}
    placeRings()}
  $("#race b").textContent=fmt(race.t);$("#race span").textContent=`Anillo ${race.i+1}/${race.rings.length}`+(S.best?` · récord ${fmt(S.best)}`:"");
  // flecha hacia el siguiente anillo
  const to=r.p.clone().sub(ship.pos);const fx=-Math.sin(camYaw),fz=-Math.cos(camYaw),rx=Math.cos(camYaw),rz=-Math.sin(camYaw);
  const ang=Math.atan2(to.x*rx+to.z*rz,to.x*fx+to.z*fz);const up=Math.atan2(to.y,Math.hypot(to.x,to.z));
  $("#arrow").style.transform=`rotate(${ang}rad)`;$("#arrow").style.opacity=1;$("#race em").textContent=`${Math.round(to.length())} m ${up>0.2?"↑":up<-0.2?"↓":""}`;
}
const fmt=t=>`${Math.floor(t/60)}:${(t%60).toFixed(2).padStart(5,"0")}`;

/* --- HUD --- */
const DPRE=["Distrito","Barrio","Sector","Zona","Colonia"],DNAME=["Kanda","Neo Roma","Aurora","Vértice","Halcón","Shiba","Prisma","Ozono","Cromo","Nébula","Ámbar","Kioto Sur","Sombra","Delta","Lumen","Titania","Vapor","Marea","Cobalto","Hikari"];
function district(x,z){
  if(Math.abs(x-PYR.x)<300&&Math.abs(z-PYR.z)<300)return "La Pirámide";
  const i=Math.floor(x/(CHUNK*2)),j=Math.floor(z/(CHUNK*2));
  return pick(DPRE,hash2(i,j,7))+" "+pick(DNAME,hash2(i,j,8));
}
let lastD="",hudT=0,toastT=0;
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");toastT=3}
const mm=$("#mm"),mx=mm.getContext("2d");
function drawMap(){
  const W=mm.width,H=mm.height,R=420,k=W/2/R;mx.clearRect(0,0,W,H);
  mx.save();mx.beginPath();mx.arc(W/2,H/2,W/2,0,Math.PI*2);mx.clip();
  mx.fillStyle="rgba(8,8,16,.82)";mx.fillRect(0,0,W,H);
  mx.translate(W/2,H/2);mx.rotate(camYaw);mx.scale(k,k);mx.translate(-ship.pos.x,-ship.pos.z);
  for(const c of city.chunks.values()){const f=c.foot;for(let i=0;i<f.length;i+=5){
    if(Math.abs(f[i]-ship.pos.x)>R+100||Math.abs(f[i+1]-ship.pos.z)>R+100)continue;
    const h=f[i+4];mx.fillStyle=h>150?"#5b3a8a":h>60?"#3a3260":"#25263c";mx.fillRect(f[i],f[i+1],f[i+2]-f[i],f[i+3]-f[i+1])}}
  mx.fillStyle="#7a5a20";mx.beginPath();mx.moveTo(PYR.x-PYR.w/2,PYR.z-PYR.w/2);mx.lineTo(PYR.x+PYR.w/2,PYR.z-PYR.w/2);mx.lineTo(PYR.x+PYR.w/2,PYR.z+PYR.w/2);mx.lineTo(PYR.x-PYR.w/2,PYR.z+PYR.w/2);mx.fill();
  if(race.on){race.rings.forEach((r,i)=>{if(i<race.i)return;mx.fillStyle=i===race.i?"#ffd23f":"rgba(255,210,63,.4)";mx.beginPath();mx.arc(r.p.x,r.p.z,i===race.i?14:8,0,Math.PI*2);mx.fill()})}
  drones.d.forEach(d=>{if(!d)return;mx.fillStyle="#ff3355";mx.fillRect(d.cx+Math.cos(d.a)*d.r-5,d.cz+Math.sin(d.a)*d.r-5,10,10)});
  mx.restore();
  mx.save();mx.translate(W/2,H/2);mx.rotate(camYaw-ship.yaw);mx.fillStyle="#19e6ff";mx.beginPath();mx.moveTo(0,-9);mx.lineTo(6,7);mx.lineTo(0,3);mx.lineTo(-6,7);mx.closePath();mx.fill();mx.restore();
  mx.strokeStyle="rgba(255,255,255,.12)";mx.lineWidth=2;mx.beginPath();mx.arc(W/2,H/2,W/2-1,0,Math.PI*2);mx.stroke();
  mx.fillStyle="rgba(255,255,255,.7)";mx.font="bold 11px Urbanist,system-ui";mx.textAlign="center";
  mx.fillText("N",W/2+Math.sin(camYaw)*(W/2-11),H/2-Math.cos(camYaw)*(W/2-11)+4);
}
function updateHUD(dt){
  hudT-=dt;toastT-=dt;if(toastT<0)$("#toast").classList.remove("on");
  if(hudT>0)return;hudT=0.066;
  $("#spd").textContent=Math.round(ship.speed*3.6);$("#alt").textContent=Math.round(ship.pos.y)+" m";
  $("#boost i").style.width=(ship.boost*100)+"%";$("#boost").classList.toggle("on",ship.boosting);
  $("#hp i").style.width=(ship.hp*100)+"%";
  const d=district(ship.pos.x,ship.pos.z);if(d!==lastD){lastD=d;$("#dist").textContent=d;$("#dist").classList.remove("pop");void $("#dist").offsetWidth;$("#dist").classList.add("pop")}
  const hh=Math.floor(atm.hour),mi=Math.floor((atm.hour%1)*60);$("#clock").textContent=`${String(hh).padStart(2,"0")}:${String(mi).padStart(2,"0")}`;
  $("#fps").textContent=Math.round(1/Math.max(1e-3,avgDt))+" fps";
  drawMap();
}

/* --- menús --- */
let menu="garage";
function buildMenu(){
  const g=$("#ships");g.innerHTML="";
  SHIPS.forEach((d,i)=>{const b=document.createElement("button");b.className="sh"+(i===S.ship?" on":"");b.style.setProperty("--c","#"+new THREE.Color(d.color).getHexString());
    const bar=(l,v)=>`<div class="st"><span>${l}</span><i style="--v:${v}"></i></div>`;
    b.innerHTML=`<b>${d.name}</b><small>${d.desc}</small>${bar("Velocidad",d.top/120)}${bar("Agilidad",d.turn/2.5)}${bar("Masa",d.mass/2200)}`;
    b.onclick=()=>{setShip(i);g.querySelectorAll(".sh").forEach((x,k)=>x.classList.toggle("on",k===i))};g.appendChild(b)});
  const q=$("#quality");q.value=S.quality;q.onchange=()=>{S.quality=q.value;save();dynScale=1;applyQuality()};
  const h=$("#hour");h.value=S.hour;h.oninput=()=>{atm.hour=S.hour=+h.value;save()};
  const bind=(id,key,fn)=>{const e=$(id);e.checked=S[key];e.onchange=()=>{S[key]=e.checked;save();fn&&fn(e.checked)}};
  bind("#auto","auto",v=>atm.autoTime=v);bind("#rain","rain",v=>atm.rainTarget=v?1:0);bind("#snd","sound",v=>sound.setOn(v));bind("#inv","invert",v=>input.invert=v);
  $("#credits").innerHTML=CREDITS.map(c=>`<li><a href="${c.url}" target="_blank" rel="noopener">${c.name}</a><span>${c.author} · CC BY 4.0</span></li>`).join("");
}
function openMenu(m){
  menu=m;document.body.dataset.menu=m||"";
  $("#garage").classList.toggle("on",m==="garage");$("#pause").classList.toggle("on",m==="pause");
  if(m)ship.input={thr:0,steer:0,pitch:0,lift:0,strafe:0,boost:false,brake:false};
}
$("#go").onclick=()=>{sound.start();openMenu(null);camPos.copy(ship.pos).add(new THREE.Vector3(0,4,14));camYaw=ship.yaw;toast(isTouch?"Stick izquierdo: dirección · derecho: acelerar":"W acelera · A/D gira · ↑/↓ nariz · Espacio/C altura · Shift turbo")};
$("#resume").onclick=()=>openMenu(null);
$("#toGarage").onclick=()=>{stopRace();openMenu("garage")};
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("on",x===b));document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("on",t.id===b.dataset.tab))});
$("#bPause").onclick=()=>openMenu(menu?null:"pause");
$("#bCam").onclick=()=>{S.cam=(S.cam+1)%CAMS.length;save();toast("Cámara: "+CAMS[S.cam])};
$("#bRace").onclick=()=>race.on?stopRace("Carrera cancelada"):startRace();
$("#bLights").onclick=()=>{ship.lightsOn=!ship.lightsOn};
input.bindTouch(document.body);
if(isTouch)document.body.classList.add("touch");

/* --- bucle --- */
const clock=new THREE.Clock();let acc=0,avgDt=1/60,slow=0,fast=0,first=true;
function loop(){
  requestAnimationFrame(loop);
  let dt=Math.min(clock.getDelta(),0.1);if(first){dt=1/60;first=false}
  avgDt=lerp(avgDt,dt,0.05);U.uTime.value+=dt;
  // resolución dinámica
  if(avgDt>1/38){slow+=dt;fast=0;if(slow>2&&dynScale>0.6){dynScale=Math.max(0.6,dynScale-0.1);slow=0;resize()}}
  else if(avgDt<1/57){fast+=dt;slow=0;if(fast>5&&dynScale<1){dynScale=Math.min(1,dynScale+0.1);fast=0;resize()}}else{slow=fast=0}
  // atajos
  if(input.take("Escape")||input.take("KeyP")||input.take("Pad9"))openMenu(menu?(menu==="garage"?"garage":null):"pause");
  if(!menu){
    if(input.take("KeyV")||input.take("Pad3")){S.cam=(S.cam+1)%CAMS.length;save();toast("Cámara: "+CAMS[S.cam])}
    if(input.take("KeyR")){S.rain=!S.rain;atm.rainTarget=S.rain?1:0;save();toast(S.rain?"Lluvia":"Despejado");$("#rain").checked=S.rain}
    if(input.take("KeyT")){atm.hour=S.hour=(Math.floor(atm.hour/3)*3+3)%24;save();$("#hour").value=S.hour;toast("Hora: "+S.hour+":00")}
    if(input.take("KeyL"))ship.lightsOn=!ship.lightsOn;
    if(input.take("KeyF")||input.take("Pad8"))race.on?stopRace("Carrera cancelada"):startRace();
    if(input.take("KeyH"))document.body.classList.toggle("nohud");
    input.read(ship.input);
  }
  // física a paso fijo
  acc+=dt;const h=1/120;let n=0;
  while(acc>=h&&n<12){if(!menu)ship.step(h,city);else{ship.vel.multiplyScalar(0.98);ship.pos.y=damp(ship.pos.y,45,1,h)}acc-=h;n++}
  if(n>=12)acc=0;
  ship.update(dt,camera);
  city.update(ship.pos,1);ground.update(ship.pos);
  traffic.update(dt,ship,camera);drones.update(dt,ship);
  updateRace(dt);
  updateCamera(dt,!!menu);
  atm.update(dt,camera.position,ship.vel);
  atm.updateDynamic(dt,ship.pos.clone().add(new THREE.Vector3(0,2,0)),[ship.root,...ship.trails.map(t=>t.mesh)]);
  sound.update(ship,atm.rain);
  if(!menu)updateHUD(dt);
  post.render(dt,menu?0:clamp((ship.speed-50)/90,0,1)+(ship.boosting?0.3:0),Math.min(1,shake),U.uTime.value);
}

boot().catch(e=>{console.error(e);$("#load small").textContent="No se pudo cargar: "+e.message});
if("serviceWorker" in navigator&&location.protocol!=="file:")addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
/* pruebas: avanza la simulación sin depender del framerate */
function sim(sec,inp={}){const h=1/120;for(let t=0;t<sec;t+=h){Object.assign(ship.input,inp);ship.step(h,city);U.uTime.value+=h;
  if((t/h|0)%12===0){ship.update(h*12,camera);city.update(ship.pos,1);ground.update(ship.pos);traffic.update(h*12,ship,camera);drones.update(h*12,ship);updateCamera(h*12,false);updateRace(h*12)}}
  for(let k=0;k<60;k++)updateCamera(1/30,false);while(city.update(ship.pos,8)>0);return {p:ship.pos.toArray().map(Math.round),v:Math.round(ship.speed)}}
window.__neon={sim,race,get ship(){return ship},get city(){return city},camera,atm,renderer,scene,S,openMenu,startRace};
