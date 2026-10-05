/* Lectura de estados de cuenta en PDF (BBVA México, cuenta de débito) dentro del dispositivo.
   Usa pdf.js para sacar el texto con su posición; la columna (cargo o abono) se decide por la posición
   horizontal del monto respecto a los encabezados CARGOS / ABONOS, y se valida contra los totales del PDF. */
const MES={ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SEP:9,OCT:10,NOV:11,DIC:12};
const AMT=/^\d{1,3}(?:,\d{3})*\.\d{2}$/;
const num=s=>parseFloat(String(s).replace(/,/g,""))||0;

/* Renglones de texto por página: [{page,y,items:[{x,w,s}]}] de arriba hacia abajo */
export async function pdfRows(pdfjs,data){
  const doc=await pdfjs.getDocument({data,isEvalSupported:false}).promise,out=[];
  for(let p=1;p<=doc.numPages;p++){
    const tc=await (await doc.getPage(p)).getTextContent(),rows=[];
    for(const it of tc.items){const s=(it.str||"").trim();if(!s)continue;const y=it.transform[5],x=it.transform[4];
      let r=rows.find(r=>Math.abs(r.y-y)<=2.5);if(!r){r={page:p,y,items:[]};rows.push(r)}r.items.push({x,w:it.width||0,s})}
    rows.sort((a,b)=>b.y-a.y).forEach(r=>{r.items.sort((a,b)=>a.x-b.x);r.text=r.items.map(i=>i.s).join(" ").replace(/\s+/g," ")});
    out.push(...rows);
  }
  return out;
}

const NOISE=/^(BBVA MEXICO|Av\. Paseo|Estado de Cuenta|Libret|PAGINA|No\. de|La GAT|DIEGO |Total de Movimientos|FECHA|OPER|\d{20,}|[A-Z0-9]{25,}$)/;

/* Devuelve {banco,cuenta,periodo:{de,a},saldoAnterior,saldoFinal,list:[{d,desc,extra:[],cargo,abono}],totales,ok} */
export function parseBBVA(rows){
  const all=rows.map(r=>r.text).join("\n");
  if(!/BBVA/i.test(all))throw new Error("no parece un estado de cuenta de BBVA");
  const per=all.match(/DEL\s+(\d{2})\/(\d{2})\/(\d{4})\s+AL\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if(!per)throw new Error("no encontré el periodo del estado de cuenta");
  const de={d:+per[1],m:+per[2],y:+per[3]},a={d:+per[4],m:+per[5],y:+per[6]};
  const pick=re=>{const m=all.match(re);return m?num(m[1]):null};
  const res={banco:"BBVA",cuenta:(all.match(/Libret[oó]n[^\n]*|Cuenta Digital|Tarjeta[^\n]*/)||[""])[0].trim(),
    periodo:{de:iso(de.y,de.m,de.d),a:iso(a.y,a.m,a.d)},saldoAnterior:pick(/Saldo Anterior\s+([\d,]+\.\d{2})/),saldoFinal:pick(/Saldo Final\s+([\d,]+\.\d{2})/),
    totales:{cargos:pick(/TOTAL IMPORTE CARGOS\s+([\d,]+\.\d{2})/),abonos:pick(/TOTAL IMPORTE ABONOS\s+([\d,]+\.\d{2})/)},list:[]};
  let col=null,cur=null,done=false;
  const yearFor=m=>m<de.m?a.y:de.y;
  for(const r of rows){
    if(done)break;
    if(/TOTAL IMPORTE CARGOS|Total de Movimientos/.test(r.text)){done=true;break}
    // encabezados de columnas en cada página
    // (pueden venir juntos, ej. "ABONOS OPERACION": se calcula el borde derecho de la palabra; solo aparecen en la primera página)
    const edge=(it,word)=>{const k=it.s.indexOf(word);return it.x+it.w*(k+word.length)/it.s.length};
    const hc=r.items.find(i=>/(^|\s)CARGOS(\s|$)/.test(i.s)),ha=r.items.find(i=>/(^|\s)ABONOS(\s|$)/.test(i.s));
    if(hc&&ha){col={c:edge(hc,"CARGOS"),a:edge(ha,"ABONOS")};continue}
    const m=r.text.match(/^(\d{2})\/([A-Z]{3})\s+(\d{2})\/([A-Z]{3})\s*(.*)$/);
    if(m&&MES[m[2]]){
      const amts=r.items.filter(i=>AMT.test(i.s));let cargo=0,abono=0;
      if(amts.length){const first=amts[0],right=first.x+first.w;
        if(col){const dc=Math.abs(right-col.c),da=Math.abs(right-col.a);if(dc<=da)cargo=num(first.s);else abono=num(first.s)}
        else cargo=num(first.s)}
      const desc=r.items.filter(i=>!AMT.test(i.s)).map(i=>i.s).join(" ").replace(/^\d{2}\/[A-Z]{3}\s+\d{2}\/[A-Z]{3}\s*/,"").replace(/\s+/g," ").trim();
      cur={d:iso(yearFor(MES[m[2]]),MES[m[2]],+m[1]),desc,extra:[],cargo,abono};res.list.push(cur);continue;
    }
    if(cur&&!NOISE.test(r.text)&&!/^RFC:/.test(r.text)&&cur.extra.length<5)cur.extra.push(r.text);
  }
  const sc=res.list.reduce((s,t)=>s+t.cargo,0),sa=res.list.reduce((s,t)=>s+t.abono,0);
  res.ok=res.totales.cargos==null||(Math.abs(sc-res.totales.cargos)<0.05&&Math.abs(sa-res.totales.abonos)<0.05);
  res.sumas={cargos:Math.round(sc*100)/100,abonos:Math.round(sa*100)/100};
  return res;
}
const iso=(y,m,d)=>`${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

/* Carga pdf.js del propio sitio (shared/vendor) solo cuando se necesita */
let lib=null;
export async function readBankPdf(buf,base){
  if(!lib){lib=await import(base+"vendor/pdfjs/pdf.min.mjs");lib.GlobalWorkerOptions.workerSrc=base+"vendor/pdfjs/pdf.worker.min.mjs"}
  return parseBBVA(await pdfRows(lib,new Uint8Array(buf)));
}
