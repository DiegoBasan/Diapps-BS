/* Modelos 3D descargados de Sketchfab (todos CC BY 4.0; créditos en models/CREDITOS.md y en el menú).
   Se cargan una vez, se normalizan (frente hacia -Z, escala en metros) y se reutilizan como piezas. */
import * as THREE from "../../shared/vendor/three/three.module.min.js";
import {GLTFLoader} from "../../shared/vendor/three/loaders/GLTFLoader.js";
import {mergeGeometries} from "../../shared/vendor/three/utils/BufferGeometryUtils.js";

export const CREDITS=[
  {file:"hovercar",name:"Futuristic Hover Car",author:"VertaScan",url:"https://sketchfab.com/3d-models/futuristic-hover-car-6243cd7c7f2e4d4cba7e0ad1a3938a35"},
  {file:"veh007",name:"FREE Sci-Fi Vehicle 007",author:"Unity Fan youtube channel",url:"https://sketchfab.com/3d-models/free-sci-fi-vehicle-007-public-domain-cc0-5368ffca3bf84b19988c291fade4f3a2"},
  {file:"scificar",name:"Futuristic Sci-Fi Car",author:"dylanheyes",url:"https://sketchfab.com/3d-models/futuristic-sci-fi-car-525bb5ad44d34ad1b74aca686ea836a4"},
  {file:"veh026",name:"FREE Sci-Fi Vehicle 026",author:"Unity Fan youtube channel",url:"https://sketchfab.com/3d-models/free-sci-fi-vehicle-026-public-domain-cc0-b41e0eb90a4d4dfa8c8906c70ee77490"},
  {file:"blnk100",name:"blnk-100 concept hovering car",author:"DEDROX",url:"https://sketchfab.com/3d-models/blnk-100-concept-hovering-car-2a61db68f0b14185ba690d2e22dd037c"},
  {file:"pyramid",name:"Futuristic Pyramid Cityscape",author:"Inditrion Dradnon",url:"https://sketchfab.com/3d-models/futuristic-pyramid-cityscape-f396d2bcaa2f4e7a858abf7414266537"},
  {file:"g1building",name:"G1 Cyberpunk Building",author:"AL3K",url:"https://sketchfab.com/3d-models/g1-cyberpunk-building-2c0bfaf01ac3433181acd6e59ce47119"},
  {file:"tower",name:"Sci-Fi Building Tower Skyscraper",author:"Volodymyr Hrushevskiy",url:"https://sketchfab.com/3d-models/sci-fi-building-tower-skyscraper-c2ab95f390e4452dbc3a033b5a34e1c1"},
  {file:"neonset",name:"Japanese neon sign set",author:"YD Visual",url:"https://sketchfab.com/3d-models/japanese-neon-sign-set-low-poly-for-background-188e5d8dd2cb4f098871b5dd5f6fa990"},
  {file:"neonletters",name:"Neon Shibuya Billboard Lettering",author:"freshlybaked",url:"https://sketchfab.com/3d-models/neon-shibuya-billboard-lettering-7ad34566835c4ab0975016b9f97fa2ee"},
  {file:"policedrone",name:"Police Drone",author:"Tom F",url:"https://sketchfab.com/3d-models/police-drone-7f014be2705844c49152bfa1eb66fd86"},
];

/* naves: largo en metros y hacia dónde mira el modelo original */
export const VEH={
  hovercar:{len:5.4,fwd:"+z"},veh007:{len:6.6,fwd:"+z"},scificar:{len:8.2,fwd:"+z"},veh026:{len:5.8,fwd:"+z"},blnk100:{len:6.4,fwd:"-x"},
  policedrone:{len:2.8,fwd:"+z",byHeight:true},
};
const ROT={"+z":Math.PI,"-z":0,"+x":Math.PI/2,"-x":-Math.PI/2};

export async function loadAll(base,onProgress){
  const L=new GLTFLoader();const out={};let done=0;
  await Promise.all(CREDITS.map(async c=>{
    const g=await L.loadAsync(base+c.file+".glb");out[c.file]=g.scene;done++;onProgress&&onProgress(done/CREDITS.length,c);
  }));
  return out;
}

/* piezas en el espacio del modelo con la transformación del nodo aplicada */
export function parts(root,{rotY=0,center="base",scaleTo=null,axis="y"}={}){
  root.updateMatrixWorld(true);const list=[];
  root.traverse(o=>{if(o.isMesh){const g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);
    for(const k of Object.keys(g.attributes))if(!["position","normal","uv","color","tangent"].includes(k))g.deleteAttribute(k);
    list.push({geometry:g,material:o.material})}});
  const R=new THREE.Matrix4().makeRotationY(rotY);list.forEach(p=>p.geometry.applyMatrix4(R));
  const box=new THREE.Box3();list.forEach(p=>{p.geometry.computeBoundingBox();box.union(p.geometry.boundingBox)});
  const size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
  let s=1;if(scaleTo)s=scaleTo/(axis==="y"?size.y:axis==="z"?size.z:Math.max(size.x,size.z));
  const T=new THREE.Matrix4().makeScale(s,s,s).multiply(new THREE.Matrix4().makeTranslation(-c.x,center==="base"?-box.min.y:-c.y,-c.z));
  list.forEach(p=>{p.geometry.applyMatrix4(T)});
  return mergeByMaterial(list);
}
/* une las mallas que comparten material: menos llamadas de dibujo por instancia */
function mergeByMaterial(list){
  const by=new Map();list.forEach(p=>{if(!by.has(p.material))by.set(p.material,[]);by.get(p.material).push(p.geometry)});
  const out=[];
  for(const [mat,geos] of by){
    let g;
    if(geos.length===1)g=geos[0];
    else{
      const names=["position","normal","uv"].filter(k=>geos.some(x=>x.attributes[k]));
      const norm=geos.map(x=>{let y=x.index?x.toNonIndexed():x;
        for(const k of Object.keys(y.attributes))if(!names.includes(k))y.deleteAttribute(k);
        if(!y.attributes.normal&&names.includes("normal"))y.computeVertexNormals();
        if(!y.attributes.uv&&names.includes("uv"))y.setAttribute("uv",new THREE.Float32BufferAttribute(new Float32Array(y.attributes.position.count*2),2));
        return y});
      g=mergeGeometries(norm,false)||geos[0];
    }
    g.computeBoundingBox();g.computeBoundingSphere();out.push({geometry:g,material:mat});
  }
  return out;
}
export function vehicleParts(root,key){
  const v=VEH[key];return parts(root,{rotY:ROT[v.fwd],center:"middle",scaleTo:v.len,axis:v.byHeight?"y":"z"});
}
export function toGroup(list){
  const g=new THREE.Group();
  list.forEach(p=>{const m=new THREE.Mesh(p.geometry,p.material);m.castShadow=true;m.receiveShadow=true;g.add(m)});
  const box=new THREE.Box3().setFromObject(g);g.userData.box=box;return g;
}

/* ajustes de materiales: letreros y pirámide brillan de noche */
export function tuneMaterials(models){
  const glow=(root,k)=>root.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{
    if(m.map){m.emissiveMap=m.map;m.emissive=new THREE.Color(1,1,1);m.emissiveIntensity=k;}
    if(k>1){m.side=THREE.DoubleSide;m.toneMapped=false}m.needsUpdate=true})}});
  glow(models.neonset,3.2);glow(models.neonletters,2.4);glow(models.pyramid,0.55);
  models.tower.traverse(o=>{if(o.isMesh){o.material.roughness=0.35;o.material.metalness=0.6;o.material.color.multiplyScalar(0.55)}});
  for(const k of ["hovercar","veh007","scificar","veh026","blnk100","policedrone"])models[k].traverse(o=>{if(o.isMesh){const m=o.material;m.envMapIntensity=1.6;if(m.roughness>0.6)m.roughness=0.55}});
}
