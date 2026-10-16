/* Posprocesado: oclusión ambiental (GTAO), bloom HDR para el neón, y un pase final con
   aberración cromática, desenfoque radial a alta velocidad, viñeta y grano de película. */
import * as THREE from "../../shared/vendor/three/three.module.min.js";
import {EffectComposer} from "../../shared/vendor/three/postprocessing/EffectComposer.js";
import {RenderPass} from "../../shared/vendor/three/postprocessing/RenderPass.js";
import {GTAOPass} from "../../shared/vendor/three/postprocessing/GTAOPass.js";
import {UnrealBloomPass} from "../../shared/vendor/three/postprocessing/UnrealBloomPass.js";
import {ShaderPass} from "../../shared/vendor/three/postprocessing/ShaderPass.js";
import {OutputPass} from "../../shared/vendor/three/postprocessing/OutputPass.js";

const Final={
  uniforms:{tDiffuse:{value:null},uSpeed:{value:0},uTime:{value:0},uHit:{value:0},uAspect:{value:1}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse;uniform float uSpeed,uTime,uHit,uAspect;varying vec2 vUv;
    float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
    void main(){
      vec2 c=vUv-0.5;float r=length(c*vec2(uAspect,1.));
      // desenfoque radial (sensación de velocidad) solo hacia los bordes
      float bl=uSpeed*0.035*smoothstep(0.15,0.7,r);vec3 col=vec3(0.);
      for(int i=0;i<8;i++){float t=float(i)/7.;vec2 uv=0.5+c*(1.-bl*t);
        float ca=(0.0015+uHit*0.006+uSpeed*0.002)*r;
        col.r+=texture2D(tDiffuse,uv+c*ca).r;col.g+=texture2D(tDiffuse,uv).g;col.b+=texture2D(tDiffuse,uv-c*ca).b;}
      col/=8.;
      col*=1.-smoothstep(0.45,1.15,r)*0.55;                          // viñeta
      col+=(h(vUv*vec2(1920.,1080.)+fract(uTime*7.))-0.5)*0.022;      // grano
      col=mix(col,col*vec3(1.4,0.5,0.5),uHit*0.35*smoothstep(0.2,0.8,r));
      gl_FragColor=vec4(col,1.);
    }`
};

export class Post{
  constructor(renderer,scene,camera){
    this.r=renderer;this.scene=scene;this.camera=camera;
    this.composer=new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene,camera));
    this.ao=null;
    this.bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),0.6,0.5,0.95);this.composer.addPass(this.bloom);
    this.final=new ShaderPass(Final);this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
  }
  setAO(on,mobile){
    if(on&&!this.ao){
      const ao=new GTAOPass(this.scene,this.camera,innerWidth,innerHeight);ao.output=GTAOPass.OUTPUT.Default;ao.blendIntensity=0.9;
      ao.updateGtaoMaterial({radius:3.5,distanceExponent:1.6,thickness:6,scale:1.2,samples:mobile?8:12,distanceFallOff:1,screenSpaceRadius:false});
      ao.updatePdMaterial({lumaPhi:10,depthPhi:2,normalPhi:3,radius:4,rings:2,samples:8});
      // la oclusión solo debe ver geometría sólida: se ocultan neón aditivo, estelas, lluvia y anuncios en su pase de normales
      const base=ao.render.bind(ao);const sc=this.scene;
      ao.render=(...a)=>{const hid=[];sc.traverse(o=>{if(o.visible&&o.material&&!Array.isArray(o.material)&&o.material.transparent){o.visible=false;hid.push(o)}});
        base(...a);hid.forEach(o=>o.visible=true)};
      this.composer.insertPass(ao,1);this.ao=ao;
    }else if(!on&&this.ao){this.composer.removePass(this.ao);this.ao.dispose&&this.ao.dispose();this.ao=null}
  }
  setSize(w,h,pr){this.composer.setPixelRatio(pr);this.composer.setSize(w,h);this.final.uniforms.uAspect.value=w/h}
  render(dt,speed01,hit,t){
    const u=this.final.uniforms;u.uSpeed.value=speed01;u.uHit.value=hit;u.uTime.value=t;
    this.composer.render(dt);
  }
}
