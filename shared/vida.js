/* Vida: lectura de los datos de todas las apps de Diapps (solo lectura), compartida por Ciudad y Control.
   Lee del almacenamiento del navegador y, si hay sesión, de tu cuenta (la copia más nueva gana). Nunca escribe en los datos de otras apps. */
(function(){
const LSj=k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}};
const pad=n=>String(n).padStart(2,"0");
const dIso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dToday=()=>dIso(new Date());
const dAdd=(s,n)=>{const d=new Date(s+"T12:00");d.setDate(d.getDate()+n);return dIso(d)};
const SRC={fin:["finz2","finanzas"],rut:["ritmo1","rutinas"],jet:["jetta6v3","jetta"],riff:["riff1","riff"],caj:["cajas1","cajas"],pap:["papeles1","papeles"]};
const D={};for(const k in SRC)D[k]=LSj(SRC[k][0]);
const stamp=d=>d?(d._u||d.updated||0):-1;
/* Trae de tu cuenta lo que esté más nuevo; devuelve true si algo cambió */
async function loadCloud(){if(!window.Nube||!Nube.user())return false;let ch=false;
  await Promise.all(Object.keys(SRC).map(async k=>{try{const r=await Nube.load(SRC[k][1]);if(r&&r.data&&r.updated>stamp(D[k])){D[k]=r.data;ch=true}}catch(e){}}));return ch}
function refresh(){let ch=false;for(const k in SRC){const v=LSj(SRC[k][0]);if(v&&stamp(v)>=stamp(D[k])){D[k]=v;ch=true}}return ch}
function model(){
  const t=dToday(),M={};
  /* Finanzas: apartados de Mercado Pago, disponible y gasto de la semana */
  const F=D.fin;
  if(F&&Array.isArray(F.tx)){
    const START={bbva:8200,bbvaa:-900,nu:-2400,mp:900,cash:1300,save:12000},meta=F.meta||{},b={};
    for(const k in START)b[k]=meta[k]&&meta[k].start!=null?meta[k].start:START[k];
    F.tx.forEach(x=>{if(x.type==="move"){b[x.acc]-=x.a;b[x.to]+=x.a}else if(b[x.acc]!=null)b[x.acc]+=x.type==="in"?x.a:-x.a});
    const P=F.pots||{items:{},mv:[]};(P.mv||[]).forEach(m=>{if(m.t!=="adj")b.mp-=m.a});
    const pbal=k=>{const it=P.items[k];return it.base+(P.mv||[]).filter(m=>m.k===k&&m.s>it.baseSeq&&!(it.baseDate&&m.ref&&m.d<=it.baseDate)).reduce((s,m)=>s+m.a,0)};
    const pots=Object.keys(P.items||{}).map(k=>({n:P.items[k].n,v:pbal(k)})).sort((a,c)=>c.v-a.v);
    const liq=["bbva","mp","cash"].reduce((s,k)=>s+(b[k]||0),0);
    const mon=dAdd(t,-((new Date(t+"T12:00").getDay()+6)%7)),spent=(a,z)=>F.tx.filter(x=>x.type==="out"&&x.d>=a&&x.d<=z).reduce((s,x)=>s+x.a,0);
    const wk=spent(mon,t),dow=(new Date(t+"T12:00").getDay()+6)%7;let prev=0;for(let i=1;i<=4;i++)prev+=spent(dAdd(mon,-7*i),dAdd(mon,-7*i+dow));
    M.fin={ok:true,pots,ptot:pots.reduce((s,p)=>s+p.v,0),liq,wk,avg:prev/4,sample:!!F.sample};
  }else M.fin={ok:false,pots:[{n:"Fondo de emergencia",v:15000},{n:"Viaje",v:8200},{n:"Jetta",v:4300},{n:"Regalos",v:1800},{n:"Tarjeta Nu",v:3200}],ptot:32500,liq:9800,wk:1450,avg:1700};
  /* Rutinas: % de hoy, racha por hábito y cumplidos de los últimos 30 días */
  const R=D.rut;
  if(R&&Array.isArray(R.habits)){
    const cnt=(h,d)=>((R.log||{})[d]||{})[h.id]?.length||0,due=(h,d)=>!h.days||!h.days.length||h.days.includes(new Date(d+"T12:00").getDay());
    const mon=dAdd(t,-((new Date(t+"T12:00").getDay()+6)%7)),wkc=h=>{let n=0;for(let x=mon;x<=t;x=dAdd(x,1))if(cnt(h,x))n++;return n};
    const streak=h=>{if(h.kind!=="day")return wkc(h);let d=cnt(h,t)>=h.target?t:dAdd(t,-1),n=0;for(let i=0;i<400;i++,d=dAdd(d,-1)){if(!due(h,d))continue;if(cnt(h,d)>=h.target)n++;else break}return n};
    const habits=R.habits.map(h=>({n:h.n,c:h.c,kind:h.kind,target:h.target,now:h.kind==="day"?cnt(h,t):wkc(h),due:h.kind!=="day"||due(h,t),streak:streak(h)})).map(h=>({...h,done:h.now>=h.target}));
    const dh=habits.filter(h=>h.kind==="day"&&h.due),pct=dh.length?Math.round(dh.reduce((s,h)=>s+Math.min(1,h.now/h.target),0)/dh.length*100):0;
    let d30=0;for(let i=0;i<30;i++){const d=dAdd(t,-i),l=(R.log||{})[d]||{};for(const k in l)d30+=(l[k]||[]).length}
    M.rut={ok:true,habits,pct,d30,sample:!!R.sample};
  }else M.rut={ok:false,habits:[["Creatina",1,9],["Lavar dientes",0,3],["Minoxidil",1,22],["Basura",1,4],["Duolingo",0,12],["Curso PLC",0,2],["Crema",1,7]].map(([n,d,s])=>({n,done:!!d,streak:s,kind:"day",target:1,now:d,due:true})),pct:57,d30:64};
  /* Jetta: kilometraje, gasolina, rendimiento y servicios */
  const J=D.jet||{odo:214072,fuel:22,oil:62,active:["airbag"],done:{oil:205100},fills:[],_def:true};
  {const fl=(J.fills||[]).slice().sort((a,c)=>a.odo-c.odo);let km=0,L=0;for(let i=1;i<fl.length;i++){km+=fl[i].odo-fl[i-1].odo;L+=fl[i].litros}
    const kmpl=L>0&&km/L>3&&km/L<30?km/L:11.5,oilLeft=J.done&&J.done.oil!=null?J.done.oil+10000-J.odo:null;
    M.jet={ok:!J._def,odo:J.odo,fuel:J.fuel,oil:J.oil,active:J.active||[],kmpl,measured:L>0,price:fl.length?fl[fl.length-1].price:null,fills:fl.length,cpk:km>0?fl.slice(1).reduce((s,f)=>s+f.pesos,0)/km:null,oilLeft}}
  /* Riff y Cajas */
  const S=D.riff;M.riff=S&&Array.isArray(S.songs)?{ok:true,songs:S.songs,cur:S.songs.find(s=>s.id===S.cur)||S.songs[0]}:{ok:false,songs:[{title:"Let It Be",artist:"The Beatles"},{title:"Wonderwall",artist:"Oasis"},{title:"Hotel California",artist:"Eagles"}],cur:{title:"Let It Be",artist:"The Beatles"}};
  const C=D.caj;M.caj=C&&Array.isArray(C.boxes)?{ok:true,boxes:C.boxes.length,items:C.boxes.reduce((n,b)=>n+(b.items||[]).length,0),zones:(C.zones||[]).map(z=>({n:z.n||z.name||z.id,c:C.boxes.filter(b=>b.z===z.id).length}))}
    :{ok:false,boxes:14,items:52,zones:[{n:"Cuarto",c:6},{n:"Bodega",c:8}]};
  /* Energía de la ciudad: promedio de cómo van hábitos, gasto y el coche */
  const parts=[M.rut.pct];
  parts.push(M.fin.avg>0?Math.max(0,Math.min(100,Math.round(100-(M.fin.wk/M.fin.avg-1)*100))):80);
  let jh=100-25*M.jet.active.length-(M.jet.oilLeft!=null&&M.jet.oilLeft<0?30:0)-(M.jet.fuel<15?15:0);parts.push(Math.max(0,jh));
  M.score=Math.round(parts.reduce((s,x)=>s+x,0)/parts.length);
  return M;
}

/* Actividad por día de los últimos n días (más viejo primero): gasto, hábitos cumplidos, cargas de gasolina, canciones nuevas */
function series(n){const t=dToday(),days=[];for(let i=n-1;i>=0;i--)days.push(dAdd(t,-i));const ix={};days.forEach((d,i)=>ix[d]=i);
  const z=()=>new Array(n).fill(0),S={days,gasto:z(),mov:z(),hab:z(),gas:z(),riff:z()};
  const F=D.fin;if(F&&Array.isArray(F.tx))F.tx.forEach(x=>{const i=ix[x.d];if(i==null)return;S.mov[i]++;if(x.type==="out")S.gasto[i]+=x.a});
  const R=D.rut;if(R&&R.log)for(const d in R.log){const i=ix[d];if(i==null)continue;for(const k in R.log[d])S.hab[i]+=(R.log[d][k]||[]).length}
  const J=D.jet;if(J&&Array.isArray(J.fills))J.fills.forEach(f=>{const i=ix[f.d];if(i!=null)S.gas[i]+=f.litros||1});
  const M=D.riff;if(M&&Array.isArray(M.songs))M.songs.forEach(s=>{const m=/^u(\d{12,})$/.exec(s.id||"");if(m){const i=ix[dIso(new Date(+m[1]))];if(i!=null)S.riff[i]++}});
  return S}
/* Alertas con nivel: danger (peligro), alert (atención), ok (protegido), unk (sin datos) */
function alerts(M){const A=[],t=dToday(),WN={airbag:"Bolsa de aire",engine:"Check engine",abs:"ABS",oil:"Presión de aceite",battery:"Batería",temp:"Temperatura",epc:"EPC",esp:"ESP",tpms:"Presión de llantas",brake:"Frenos"};
  const J=M.jet;
  if(!J.ok)A.push({lvl:"unk",app:"jet",t:"Jetta sin datos",s:"Abre la app una vez en este dispositivo o entra con tu cuenta"});
  J.active.forEach(a=>A.push({lvl:"danger",app:"jet",t:"Testigo: "+(WN[a]||a),s:"Encendido en el tablero"}));
  if(J.oilLeft!=null)A.push(J.oilLeft<0?{lvl:"danger",app:"jet",t:"Cambio de aceite vencido",s:"Hace "+Math.abs(Math.round(J.oilLeft)).toLocaleString("es-MX")+" km"}:J.oilLeft<1500?{lvl:"alert",app:"jet",t:"Aceite en "+Math.round(J.oilLeft).toLocaleString("es-MX")+" km",s:"Agenda el servicio"}:{lvl:"ok",app:"jet",t:"Aceite al día",s:"Faltan "+Math.round(J.oilLeft).toLocaleString("es-MX")+" km"});
  A.push(J.fuel<12?{lvl:"danger",app:"jet",t:"Reserva de gasolina",s:Math.round(J.fuel)+"% del tanque"}:J.fuel<25?{lvl:"alert",app:"jet",t:"Gasolina baja",s:Math.round(J.fuel)+"% del tanque"}:{lvl:"ok",app:"jet",t:"Tanque "+Math.round(J.fuel)+"%",s:"≈ "+Math.round(55*J.fuel/100*J.kmpl)+" km de autonomía"});
  const F=M.fin;
  if(!F.ok)A.push({lvl:"unk",app:"fin",t:"Finanzas sin datos",s:"Abre la app o entra con tu cuenta"});
  F.pots.forEach(p=>A.push(p.v<0?{lvl:"danger",app:"fin",t:"Apartado en negativo",s:p.n}:{lvl:"ok",app:"fin",t:p.n,s:"Apartado protegido",v:p.v}));
  if(F.avg>0)A.push(F.wk>F.avg*1.15?{lvl:"alert",app:"fin",t:"Gasto alto esta semana",s:Math.round((F.wk/F.avg-1)*100)+"% arriba de lo normal"}:{lvl:"ok",app:"fin",t:"Gasto de la semana en rango",s:"Debajo de tu promedio"});
  const R=M.rut;
  if(!R.ok)A.push({lvl:"unk",app:"rut",t:"Rutinas sin datos",s:"Abre la app o entra con tu cuenta"});
  R.habits.forEach(h=>{if(!h.due)return;if(h.done)A.push({lvl:"ok",app:"rut",t:h.n,s:h.kind==="day"?"Cumplido hoy · racha "+h.streak:"Meta de la semana cumplida"});
    else A.push({lvl:"alert",app:"rut",t:h.n+" pendiente",s:h.kind==="day"?h.now+" de "+h.target+" hoy":h.now+" de "+h.target+" esta semana"})});
  if(!M.riff.ok)A.push({lvl:"unk",app:"riff",t:"Riff sin datos",s:"Abre la app una vez"});
  if(!M.caj.ok)A.push({lvl:"unk",app:"caj",t:"Cajas sin datos",s:"Abre la app una vez"});
  const PA=D.pap;if(PA&&Array.isArray(PA.docs))PA.docs.filter(d=>d.date&&d.type!=="otro").forEach(d=>{const n=Math.round((new Date(d.date+"T12:00")-new Date(t+"T12:00"))/864e5);
    if(d.type==="vence"&&n<0)A.push({lvl:"danger",app:"pap",t:d.n+" vencido",s:"Venció hace "+(-n)+" día"+(n===-1?"":"s")});
    else if(n>=0&&n<=30)A.push({lvl:"alert",app:"pap",t:d.n,s:(n===0?"Hoy":"En "+n+" día"+(n===1?"":"s"))});
    else if(n>30&&d.file)A.push({lvl:"ok",app:"pap",t:d.n,s:"Vigente"})});
  A.push(window.Nube&&Nube.user()?{lvl:"ok",app:"nube",t:"Cuenta conectada",s:Nube.user().email}:{lvl:"unk",app:"nube",t:"Sin cuenta conectada",s:"Tus datos solo están en este dispositivo"});
  return A}
window.Vida={SRC,D,stamp,loadCloud,refresh,model,series,alerts,dToday,dAdd,dIso};
})();
