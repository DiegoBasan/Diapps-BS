/* Controles (teclado, gamepad, táctil) y sonido sintetizado del 5 cilindros, lluvia y llantas. */
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

export class Controls{
  constructor(){
    this.k=new Set();this.pressed=new Set();this.t={steer:0,gas:0,brake:0,hand:false};this.look=0;
    addEventListener("keydown",e=>{if(!this.k.has(e.code))this.pressed.add(e.code);this.k.add(e.code);if(/Arrow|Space/.test(e.code))e.preventDefault()});
    addEventListener("keyup",e=>this.k.delete(e.code));addEventListener("blur",()=>this.k.clear());
    this.sSteer=0;
  }
  bindTouch(root){
    // volante: arrastrar horizontalmente en la zona izquierda
    const wheel=root.querySelector("#tSteer"),knob=wheel&&wheel.querySelector("i");
    if(wheel){let id=null,x0=0;
      const set=e=>{const r=wheel.getBoundingClientRect();const v=clamp((e.clientX-x0)/(r.width*0.42),-1,1);this.t.steer=v;knob.style.transform=`translateX(${v*r.width*0.36}px) rotate(${v*90}deg)`};
      wheel.addEventListener("pointerdown",e=>{id=e.pointerId;const r=wheel.getBoundingClientRect();x0=r.left+r.width/2;wheel.setPointerCapture(id);set(e);e.preventDefault()});
      wheel.addEventListener("pointermove",e=>{if(e.pointerId===id)set(e)});
      const end=e=>{if(e.pointerId!==id)return;id=null;this.t.steer=0;knob.style.transform=""};wheel.addEventListener("pointerup",end);wheel.addEventListener("pointercancel",end)}
    // pedales: la presión depende de qué tan arriba se toque el pedal
    root.querySelectorAll("[data-pedal]").forEach(p=>{const k=p.dataset.pedal;let id=null;
      const set=e=>{const r=p.getBoundingClientRect();this.t[k]=clamp(1.15-(e.clientY-r.top)/r.height,0.25,1);p.style.setProperty("--p",this.t[k])};
      p.addEventListener("pointerdown",e=>{id=e.pointerId;p.setPointerCapture(id);set(e);p.classList.add("on");e.preventDefault()});
      p.addEventListener("pointermove",e=>{if(e.pointerId===id)set(e)});
      const end=e=>{if(e.pointerId!==id)return;id=null;this.t[k]=0;p.classList.remove("on")};p.addEventListener("pointerup",end);p.addEventListener("pointercancel",end)});
    const hb=root.querySelector("#tHand");if(hb){const on=e=>{this.t.hand=true;hb.classList.add("on");e.preventDefault()},off=()=>{this.t.hand=false;hb.classList.remove("on")};
      hb.addEventListener("pointerdown",on);hb.addEventListener("pointerup",off);hb.addEventListener("pointercancel",off)}
  }
  take(c){const h=this.pressed.has(c);this.pressed.delete(c);return h}
  read(out,dt){
    const K=c=>this.k.has(c)?1:0;
    let thr=Math.max(K("KeyW"),K("ArrowUp")),br=Math.max(K("KeyS"),K("ArrowDown"));
    let st=(K("KeyD")||K("ArrowRight"))-(K("KeyA")||K("ArrowLeft"));
    // teclado: el volante gira con suavidad (no de golpe)
    this.sSteer+=(st-this.sSteer)*Math.min(1,dt*(st?3.2:5));let steer=Math.abs(st)||Math.abs(this.sSteer)>0.01?this.sSteer:0;
    let hand=this.k.has("Space");
    const gp=navigator.getGamepads?[...navigator.getGamepads()].find(g=>g&&g.connected):null;
    if(gp){const a=gp.axes,b=gp.buttons;const dz=v=>Math.abs(v)<0.08?0:v;
      if(Math.abs(dz(a[0]||0))>0)steer=Math.sign(a[0])*Math.pow(Math.abs(a[0]),1.5);
      thr=Math.max(thr,b[7]?b[7].value:0);br=Math.max(br,b[6]?b[6].value:0);if(b[0]&&b[0].pressed||b[1]&&b[1].pressed)hand=true;
      b.forEach((x,i)=>{if(x.pressed&&!this["_b"+i])this.pressed.add("Pad"+i);this["_b"+i]=x.pressed});
      if(Math.abs(a[2]||0)>0.15)this.look=a[2];else this.look=0}
    if(this.t.gas||this.t.brake||this.t.steer){thr=Math.max(thr,this.t.gas);br=Math.max(br,this.t.brake);steer=this.t.steer}
    if(this.t.hand)hand=true;
    out.thr=thr;out.brake=br;out.steer=clamp(steer,-1,1);out.hand=hand;return out;
  }
}

export class Sound{
  constructor(){this.ctx=null;this.on=true}
  start(){
    if(this.ctx){this.ctx.resume();return}
    const C=this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    this.master=C.createGain();this.master.gain.value=this.on?0.8:0;this.master.connect(C.destination);
    const comp=C.createDynamicsCompressor();comp.connect(this.master);this.out=comp;
    // motor: 5 cilindros -> pulso de encendido a 2.5x rpm/60, armónicos y "warble" característico
    this.eg=C.createGain();this.eg.gain.value=0;const lp=C.createBiquadFilter();lp.type="lowpass";lp.Q.value=2;this.lp=lp;lp.connect(this.eg);this.eg.connect(comp);
    this.osc=[["sawtooth",1,0.5],["square",0.5,0.25],["sawtooth",2,0.18],["triangle",0.25,0.4]].map(([t,mul,g])=>{const o=C.createOscillator();o.type=t;const gg=C.createGain();gg.gain.value=g;o.connect(gg);gg.connect(lp);o.start();return {o,mul}});
    const wob=C.createOscillator();wob.frequency.value=7;const wg=C.createGain();wg.gain.value=4;wob.connect(wg);this.osc.forEach(x=>wg.connect(x.o.frequency));wob.start();this.wob=wob;
    const nb=C.createBuffer(1,C.sampleRate*2,C.sampleRate);const d=nb.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    const noise=(type,f,q)=>{const s=C.createBufferSource();s.buffer=nb;s.loop=true;const fl=C.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=q;const g=C.createGain();g.gain.value=0;s.connect(fl);fl.connect(g);g.connect(comp);s.start();return {g,fl}};
    this.rain=noise("highpass",1800,0.4);this.roof=noise("bandpass",4200,0.8);this.tire=noise("bandpass",900,4);this.wind=noise("lowpass",500,0.5);this.road=noise("lowpass",180,0.7);
  }
  setOn(v){this.on=v;if(this.master)this.master.gain.setTargetAtTime(v?0.8:0,this.ctx.currentTime,0.1)}
  update(car,rain,inCabin){
    if(!this.ctx)return;const t=this.ctx.currentTime;const f=car.rpm/60*2.5;
    this.osc.forEach(x=>x.o.frequency.setTargetAtTime(f*x.mul,t,0.03));this.wob.frequency.setTargetAtTime(car.rpm/60/2,t,0.05);
    this.lp.frequency.setTargetAtTime(220+car.rpm*0.25+car.input.thr*900,t,0.05);
    this.eg.gain.setTargetAtTime(0.05+car.input.thr*0.11,t,0.05);
    const sp=car.speed;const slip=Math.max(...car.wheels.map(w=>w.contact?w.slip:0));
    this.tire.g.gain.setTargetAtTime(slip>0.35&&sp>3?Math.min(0.35,(slip-0.35)*0.8):0,t,0.05);
    this.wind.g.gain.setTargetAtTime(Math.min(0.3,sp*sp/6000),t,0.2);this.road.g.gain.setTargetAtTime(Math.min(0.25,sp/90),t,0.2);
    this.rain.g.gain.setTargetAtTime(rain*(inCabin?0.05:0.12),t,0.3);this.roof.g.gain.setTargetAtTime(rain*(inCabin?0.08:0.02),t,0.3);
  }
  thump(s){if(!this.ctx)return;const C=this.ctx,t=C.currentTime;const o=C.createOscillator();o.type="triangle";o.frequency.setValueAtTime(90,t);o.frequency.exponentialRampToValueAtTime(28,t+0.35);
    const g=C.createGain();g.gain.setValueAtTime(Math.min(1,s/12),t);g.gain.exponentialRampToValueAtTime(0.001,t+0.5);o.connect(g);g.connect(this.out);o.start(t);o.stop(t+0.55)}
}
