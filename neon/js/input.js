/* Controles: teclado, mouse (arrastrar para mirar), gamepad estándar y táctil (dos sticks + botones). */
import {clamp} from "./util.js";

export class Input{
  constructor(el){
    this.k=new Set();this.look={x:0,y:0,active:false};this.touch={l:{x:0,y:0},r:{x:0,y:0},up:false,down:false,boost:false};
    this.invert=false;this.pressed=new Set();
    addEventListener("keydown",e=>{if(e.target.closest&&e.target.closest("input,select,textarea"))return;
      if(!this.k.has(e.code))this.pressed.add(e.code);this.k.add(e.code);
      if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Tab"].includes(e.code))e.preventDefault()});
    addEventListener("keyup",e=>this.k.delete(e.code));
    addEventListener("blur",()=>this.k.clear());
    // mirar con el mouse arrastrando
    let drag=null;
    el.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"){drag={x:e.clientX,y:e.clientY};this.look.active=true;el.setPointerCapture(e.pointerId)}});
    el.addEventListener("pointermove",e=>{if(drag&&e.pointerType==="mouse"){this.look.x=clamp(this.look.x+(e.clientX-drag.x)*0.006,-Math.PI,Math.PI);this.look.y=clamp(this.look.y+(e.clientY-drag.y)*0.004,-0.6,0.9);drag={x:e.clientX,y:e.clientY}}});
    el.addEventListener("pointerup",e=>{if(e.pointerType==="mouse"){drag=null;this.look.active=false}});
  }
  /* sticks táctiles: nodos con data-stick="l|r" */
  bindTouch(root){
    root.querySelectorAll("[data-stick]").forEach(st=>{
      const knob=st.querySelector("i");const side=st.dataset.stick;let id=null,c=null;
      const set=(e)=>{const r=st.getBoundingClientRect();const R=r.width/2;let x=(e.clientX-c.x)/R,y=(e.clientY-c.y)/R;const l=Math.hypot(x,y);if(l>1){x/=l;y/=l}
        this.touch[side]={x,y};knob.style.transform=`translate(${x*R*0.55}px,${y*R*0.55}px)`};
      st.addEventListener("pointerdown",e=>{id=e.pointerId;const r=st.getBoundingClientRect();c={x:r.left+r.width/2,y:r.top+r.height/2};st.setPointerCapture(id);set(e);e.preventDefault()});
      st.addEventListener("pointermove",e=>{if(e.pointerId===id)set(e)});
      const end=e=>{if(e.pointerId!==id)return;id=null;this.touch[side]={x:0,y:0};knob.style.transform=""};
      st.addEventListener("pointerup",end);st.addEventListener("pointercancel",end);
    });
    root.querySelectorAll("[data-hold]").forEach(b=>{const k=b.dataset.hold;
      const on=e=>{this.touch[k]=true;b.classList.add("on");e.preventDefault()},off=()=>{this.touch[k]=false;b.classList.remove("on")};
      b.addEventListener("pointerdown",on);b.addEventListener("pointerup",off);b.addEventListener("pointercancel",off);b.addEventListener("pointerleave",off)});
  }
  take(code){const h=this.pressed.has(code);this.pressed.delete(code);return h}
  read(out){
    const K=c=>this.k.has(c)?1:0;
    let thr=K("KeyW")-K("KeyS"),steer=K("KeyD")-K("KeyA"),pitch=K("ArrowUp")-K("ArrowDown"),lift=K("Space")-(K("ControlLeft")||K("KeyC")||K("ControlRight")?1:0),strafe=K("KeyE")-K("KeyQ");
    steer+=K("ArrowRight")-K("ArrowLeft");
    let boost=this.k.has("ShiftLeft")||this.k.has("ShiftRight"),brake=this.k.has("KeyX");
    // gamepad
    const gp=navigator.getGamepads?[...navigator.getGamepads()].find(g=>g&&g.connected):null;this.gamepad=!!gp;
    if(gp){
      const dz=v=>Math.abs(v)<0.12?0:(v-Math.sign(v)*0.12)/0.88;const a=gp.axes,b=gp.buttons;
      steer+=dz(a[0]||0);pitch+=-dz(a[1]||0);
      const rt=b[7]?b[7].value:0,lt=b[6]?b[6].value:0;thr+=rt-lt;
      if(b[0]&&b[0].pressed)lift+=1;if(b[1]&&b[1].pressed)lift-=1;
      if(b[2]&&b[2].pressed||b[10]&&b[10].pressed)boost=true;
      if(b[4]&&b[4].pressed)strafe-=1;if(b[5]&&b[5].pressed)strafe+=1;
      const rx=dz(a[2]||0),ry=dz(a[3]||0);if(rx||ry){this.look.x=clamp(this.look.x+rx*0.05,-Math.PI,Math.PI);this.look.y=clamp(this.look.y+ry*0.03,-0.6,0.9);this.look.pad=true}else this.look.pad=false;
      b.forEach((x,i)=>{if(x.pressed&&!this["_b"+i])this.pressed.add("Pad"+i);this["_b"+i]=x.pressed});
    }
    // táctil: izquierdo = dirección/nariz, derecho = acelerar/deslizar
    const T=this.touch;
    steer+=T.l.x;pitch+=-T.l.y*0.9;thr+=-T.r.y;strafe+=T.r.x*0.8;
    if(T.up)lift+=1;if(T.down)lift-=1;if(T.boost)boost=true;
    if(this.invert)pitch=-pitch;
    out.thr=clamp(thr,-1,1);out.steer=clamp(steer,-1,1);out.pitch=clamp(pitch,-1,1);out.lift=clamp(lift,-1,1);out.strafe=clamp(strafe,-1,1);out.boost=boost;out.brake=brake;
    return out;
  }
}
