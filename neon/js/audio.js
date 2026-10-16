/* Sonido sintetizado con Web Audio (sin archivos): turbina, viento, turbo, golpes, lluvia y trueno. */
export class Sound{
  constructor(){this.ctx=null;this.on=true;this.vol=0.7}
  start(){
    if(this.ctx)return this.ctx.resume();
    const C=this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    this.master=C.createGain();this.master.gain.value=this.on?this.vol:0;this.master.connect(C.destination);
    const comp=C.createDynamicsCompressor();comp.connect(this.master);this.out=comp;
    // turbina: dos dientes de sierra desafinados + zumbido grave
    this.eng=C.createGain();this.eng.gain.value=0;const lp=C.createBiquadFilter();lp.type="lowpass";lp.frequency.value=600;lp.Q.value=4;this.engLP=lp;
    lp.connect(this.eng);this.eng.connect(comp);
    this.o1=C.createOscillator();this.o1.type="sawtooth";this.o2=C.createOscillator();this.o2.type="sawtooth";this.o3=C.createOscillator();this.o3.type="sine";
    [this.o1,this.o2,this.o3].forEach(o=>{o.connect(lp);o.start()});
    // ruido para viento y lluvia
    const nb=C.createBuffer(1,C.sampleRate*2,C.sampleRate);const d=nb.getChannelData(0);let b=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;b=0.98*b+0.02*w;d[i]=w*0.6+b*3}
    const mk=(type,f,q)=>{const s=C.createBufferSource();s.buffer=nb;s.loop=true;const fl=C.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=q;const g=C.createGain();g.gain.value=0;s.connect(fl);fl.connect(g);g.connect(comp);s.start();return {g,fl}};
    this.wind=mk("bandpass",500,0.7);this.rain=mk("highpass",2500,0.3);this.boostN=mk("bandpass",1200,1.5);
  }
  setOn(v){this.on=v;if(this.master)this.master.gain.setTargetAtTime(v?this.vol:0,this.ctx.currentTime,0.1)}
  update(ship,rain){
    if(!this.ctx)return;const t=this.ctx.currentTime,sp=ship.speed,thr=Math.abs(ship.input.thr);
    const f=55+sp*1.4+thr*30+(ship.boosting?40:0);
    this.o1.frequency.setTargetAtTime(f,t,0.08);this.o2.frequency.setTargetAtTime(f*1.012+2,t,0.08);this.o3.frequency.setTargetAtTime(f*0.5,t,0.08);
    this.engLP.frequency.setTargetAtTime(300+sp*14+thr*600,t,0.1);
    this.eng.gain.setTargetAtTime(0.06+thr*0.07+(ship.boosting?0.05:0),t,0.1);
    this.wind.g.gain.setTargetAtTime(Math.min(0.5,sp*sp/40000),t,0.2);this.wind.fl.frequency.setTargetAtTime(300+sp*8,t,0.2);
    this.boostN.g.gain.setTargetAtTime(ship.boosting?0.18:0,t,0.08);
    this.rain.g.gain.setTargetAtTime(rain*0.12,t,0.5);
  }
  thump(s){
    if(!this.ctx)return;const C=this.ctx,t=C.currentTime;const o=C.createOscillator();o.type="triangle";o.frequency.setValueAtTime(120,t);o.frequency.exponentialRampToValueAtTime(30,t+0.3);
    const g=C.createGain();g.gain.setValueAtTime(Math.min(0.9,s/40),t);g.gain.exponentialRampToValueAtTime(0.001,t+0.4);o.connect(g);g.connect(this.out);o.start(t);o.stop(t+0.45);
  }
  thunder(){
    if(!this.ctx)return;const C=this.ctx,t=C.currentTime+0.4+Math.random();const n=C.createBufferSource();const len=C.sampleRate*3;const b=C.createBuffer(1,len,C.sampleRate);const d=b.getChannelData(0);
    let v=0;for(let i=0;i<len;i++){v=0.995*v+0.005*(Math.random()*2-1);d[i]=v*8*(1-i/len)}n.buffer=b;const lp=C.createBiquadFilter();lp.type="lowpass";lp.frequency.value=300;
    const g=C.createGain();g.gain.value=0.8;n.connect(lp);lp.connect(g);g.connect(this.out);n.start(t);
  }
  chime(){
    if(!this.ctx)return;const C=this.ctx,t=C.currentTime;[880,1320].forEach((f,i)=>{const o=C.createOscillator();o.type="sine";o.frequency.value=f;const g=C.createGain();
      g.gain.setValueAtTime(0,t+i*0.07);g.gain.linearRampToValueAtTime(0.18,t+i*0.07+0.01);g.gain.exponentialRampToValueAtTime(0.001,t+i*0.07+0.5);o.connect(g);g.connect(this.out);o.start(t+i*0.07);o.stop(t+i*0.07+0.55)});
  }
}
