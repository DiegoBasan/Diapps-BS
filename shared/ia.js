/* IA compartida (Gemini) para todas las apps de Diapps.
   La clave NO va en el código (el repo es público): se pide la primera vez y se guarda solo en el dispositivo.
   Prueba varios modelos en orden por si uno está saturado o sin cuota. */
(function(){
  const MODELS=["gemini-3.5-flash","gemini-3.1-flash-lite","gemini-flash-lite-latest"];
  const LS="diapps-gemini-key";
  const key=()=>{try{return localStorage.getItem(LS)||""}catch(e){return ""}};
  /* Pide la clave una sola vez (cada app de pantalla de inicio guarda la suya) */
  function ensureKey(){let k=key();if(k)return k;k=(prompt("Pega tu clave de Gemini para usar la IA.\nSe guarda solo en este iPhone, no se sube a ningún lado.")||"").trim();if(k)setKey(k);return k}
  const setKey=k=>{try{k?localStorage.setItem(LS,k):localStorage.removeItem(LS)}catch(e){}};
  const toB64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(",")[1]);r.onerror=rej;r.readAsDataURL(blob)});
  /* ask(prompt,{json,image,system,temperature}) → texto u objeto (si json:true) */
  async function ask(prompt,opt={}){
    if(!ensureKey())throw new Error("falta la clave de IA");
    const parts=[{text:prompt}];
    if(opt.image)parts.unshift({inline_data:{mime_type:opt.image.type||"image/jpeg",data:await toB64(opt.image)}});
    const body={contents:[{role:"user",parts}]};
    if(opt.system)body.system_instruction={parts:[{text:opt.system}]};
    const gc={};if(opt.json)gc.responseMimeType="application/json";if(opt.temperature!=null)gc.temperature=opt.temperature;
    if(Object.keys(gc).length)body.generationConfig=gc;
    let last="sin respuesta";
    for(const m of MODELS){
      try{
        const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(key())}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
        if(!r.ok&&(r.status===400||r.status===403)){const t=await r.text();if(/API key|API_KEY|PERMISSION_DENIED|UNAUTHENTICATED/i.test(t)){setKey("");throw new Error("la clave no es válida; vuelve a intentar para escribir otra")}}
        if(!r.ok){last=r.status===400||r.status===403?"la IA rechazó la petición":r.status===429?"se acabó la cuota de la IA por ahora":"la IA no respondió ("+r.status+")";if([429,500,503,404].includes(r.status))continue;break}
        const j=await r.json(),txt=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").trim();
        if(!txt){last="respuesta vacía";continue}
        if(!opt.json)return txt;
        const m2=txt.match(/[\[{][\s\S]*[\]}]/);return JSON.parse(m2?m2[0]:txt);
      }catch(e){if(/clave/.test(e.message))throw e;last=navigator.onLine===false?"sin internet":"error de conexión"}
    }
    throw new Error(last);
  }
  window.IA={ask,key,setKey,isCustom:()=>{try{return !!localStorage.getItem(LS)}catch(e){return false}}};
})();
