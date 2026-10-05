/* Nube de Diapps: cuenta (Firebase Authentication con correo y contraseña) + respaldo en Firestore
   + bloqueo con Face ID (passkey del iPhone).
   La configuración de Firebase no es secreta: lo que protege los datos son las reglas de Firestore,
   que solo dejan a cada cuenta leer y escribir su propio documento (users/{uid}/...).
   Se usa la API REST de Firebase (sin SDK) para que la app pese poco y funcione igual en Safari y en la pantalla de inicio. */
(function(){
  const CFG={apiKey:"AIzaSyDfWuyJFV2vV8yQAdngrorTMZWn9p0DIqI",projectId:"diagram-diapp"};
  const LS="diapps-nube",LOCK="diapps-lock";
  const get=k=>{try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}};
  const put=(k,v)=>{try{v==null?localStorage.removeItem(k):localStorage.setItem(k,JSON.stringify(v))}catch(e){}};
  const ERR={EMAIL_EXISTS:"ya existe una cuenta con ese correo; usa Entrar",EMAIL_NOT_FOUND:"no hay cuenta con ese correo; usa Crear cuenta",INVALID_PASSWORD:"contraseña incorrecta",
    INVALID_LOGIN_CREDENTIALS:"correo o contraseña incorrectos",INVALID_EMAIL:"el correo no es válido",MISSING_PASSWORD:"escribe una contraseña",
    WEAK_PASSWORD:"la contraseña debe tener al menos 6 caracteres",TOO_MANY_ATTEMPTS_TRY_LATER:"demasiados intentos; espera unos minutos",
    OPERATION_NOT_ALLOWED:"falta activar Correo/contraseña en Firebase (Authentication → Sign-in method)",USER_DISABLED:"esta cuenta está deshabilitada"};
  const msg=e=>{const c=String(e||"").split(" ")[0].replace(/:$/,"");return ERR[c]||e||"error"};

  async function idt(path,body){
    const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${path}?key=${CFG.apiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(msg(j.error&&j.error.message));return j}
  const keep=(j,email)=>{const u={uid:j.localId||j.user_id,email:email||j.email,idToken:j.idToken||j.id_token,refresh:j.refreshToken||j.refresh_token,exp:Date.now()+((+j.expiresIn||+j.expires_in||3600)-120)*1000};put(LS,u);return u};
  const signIn=async(email,password)=>keep(await idt("signInWithPassword",{email,password,returnSecureToken:true}),email);
  const signUp=async(email,password)=>keep(await idt("signUp",{email,password,returnSecureToken:true}),email);
  const resetPassword=email=>idt("sendOobCode",{requestType:"PASSWORD_RESET",email});
  const signOut=()=>put(LS,null);
  const user=()=>{const u=get(LS);return u&&u.uid?{uid:u.uid,email:u.email}:null};
  async function token(){const u=get(LS);if(!u)throw new Error("sin sesión");if(Date.now()<u.exp)return u;
    const r=await fetch(`https://securetoken.googleapis.com/v1/token?key=${CFG.apiKey}`,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=refresh_token&refresh_token="+encodeURIComponent(u.refresh)});
    const j=await r.json().catch(()=>({}));if(!r.ok){if(/TOKEN_EXPIRED|INVALID_REFRESH|USER_NOT_FOUND|USER_DISABLED/.test(j.error&&j.error.message||""))signOut();throw new Error("vuelve a iniciar sesión")}
    return keep(j,u.email)}
  const docUrl=(uid,app)=>`https://firestore.googleapis.com/v1/projects/${CFG.projectId}/databases/(default)/documents/users/${uid}/apps/${app}`;
  /* Lee {data, updated} del documento de la app; null si todavía no existe */
  async function load(app){const u=await token();const r=await fetch(docUrl(u.uid,app),{headers:{Authorization:"Bearer "+u.idToken}});
    if(r.status===404)return null;const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(r.status===403?"Firestore rechazó el acceso (revisa las reglas)":"no se pudo leer la nube ("+r.status+")");
    const f=j.fields||{};return {data:f.data?JSON.parse(f.data.stringValue):null,updated:+(f.updated&&f.updated.integerValue)||0}}
  async function save(app,data,updated){const u=await token();
    const r=await fetch(docUrl(u.uid,app),{method:"PATCH",headers:{Authorization:"Bearer "+u.idToken,"Content-Type":"application/json"},
      body:JSON.stringify({fields:{data:{stringValue:JSON.stringify(data)},updated:{integerValue:String(updated||Date.now())},device:{stringValue:navigator.userAgent.slice(0,120)}}})});
    if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(r.status===403?"Firestore rechazó el acceso (revisa las reglas)":(j.error&&j.error.message)||"no se pudo guardar en la nube")}return true}

  /* ---------- Bloqueo con Face ID / Touch ID (passkey del dispositivo) ----------
     Pide la verificación del iPhone antes de mostrar la app. Protege si alguien toma tu teléfono desbloqueado. */
  const rnd=n=>crypto.getRandomValues(new Uint8Array(n));
  const b64=a=>btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((s.length+3)%4)),c=>c.charCodeAt(0));
  const lockAvailable=async()=>!!(window.PublicKeyCredential&&PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable&&await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  async function lockEnable(label){
    const c=await navigator.credentials.create({publicKey:{rp:{name:"Diapps"},user:{id:rnd(16),name:label||"Diapps",displayName:label||"Diapps"},challenge:rnd(32),
      pubKeyCredParams:[{type:"public-key",alg:-7},{type:"public-key",alg:-257}],authenticatorSelection:{authenticatorAttachment:"platform",userVerification:"required",residentKey:"preferred"},timeout:60000}});
    put(LOCK,{id:b64(c.rawId)});return true}
  const lockOn=()=>!!(get(LOCK)||{}).id;
  const lockDisable=()=>put(LOCK,null);
  async function unlock(){const l=get(LOCK);if(!l)return true;
    await navigator.credentials.get({publicKey:{challenge:rnd(32),allowCredentials:[{type:"public-key",id:unb64(l.id)}],userVerification:"required",timeout:60000}});return true}

  /* ---------- Sincronizador para cualquier app ----------
     o.get() da el estado, o.set(d) lo reemplaza (y redibuja). La app llama sync.touch() al guardar un cambio del usuario.
     Gana la versión más reciente (campo _u). Los guardados del primer segundo (al abrir) no cuentan como cambio. */
  function sync(app,o){let t=null,ready=false;setTimeout(()=>ready=true,1500);
    const st={msg:"",at:0,
      touch(){if(!ready)return;o.get()._u=Date.now();if(user())st.push()},
      push(){clearTimeout(t);t=setTimeout(async()=>{t=null;try{const d=o.get();await save(app,d,d._u||Date.now());st.msg="";st.at=Date.now()}catch(e){st.msg=e.message}},1500)},
      async pull(){if(!user()||t)return false;try{const r=await load(app),d=o.get();
        if(r&&r.data&&r.updated>(d._u||0)){o.set(r.data);st.msg="";st.at=Date.now();return true}
        if(d._u&&(!r||d._u>r.updated))await save(app,d,d._u);st.msg="";st.at=Date.now()}catch(e){st.msg=e.message}return false}};
    document.addEventListener("visibilitychange",()=>{if(!document.hidden)st.pull()});setTimeout(()=>st.pull(),400);
    return st}
  /* Hoja de cuenta reutilizable. u: {open(html),close(),toast(msg),sync} */
  const escA=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  function accountSheet(u){const me=user(),st=u.sync;
    if(!me){u.open(`<h3>Cuenta y respaldo</h3><p class="lbl" style="margin:0 0 6px">Con tu cuenta de Diapps tus datos se respaldan y quedan iguales en todos tus dispositivos. Es la misma cuenta que en Finanzas.</p>
      <form id="nbF" autocomplete="on"><div class="field"><input id="nbE" type="email" autocomplete="username" placeholder="Correo" autocapitalize="off" style="width:100%;height:48px;border:0;border-radius:16px;background:var(--card2,#f2f2f3);padding:0 14px;font:inherit;font-size:16px"></div>
      <div class="field"><input id="nbP" type="password" autocomplete="current-password" placeholder="Contraseña" style="width:100%;height:48px;border:0;border-radius:16px;background:var(--card2,#f2f2f3);padding:0 14px;font:inherit;font-size:16px"></div>
      <div class="btns"><button type="button" class="btn" id="nbUp">Crear cuenta</button><button class="btn dark" id="nbIn">Entrar</button></div></form>`);
      const go=async up=>{const e=document.getElementById("nbE").value.trim(),p=document.getElementById("nbP").value;if(!e||!p){u.toast("Escribe correo y contraseña");return}
        try{u.toast(up?"Creando cuenta…":"Entrando…");await(up?signUp(e,p):signIn(e,p));const got=st?await st.pull():false;if(st&&!got)st.push();u.close();u.toast(got?"Datos actualizados desde tu cuenta":"Listo, respaldado en tu cuenta")}catch(err){u.toast("No se pudo: "+err.message)}};
      document.getElementById("nbF").onsubmit=ev=>{ev.preventDefault();go(false)};document.getElementById("nbUp").onclick=()=>go(true);return}
    u.open(`<h3>Cuenta y respaldo</h3><p style="margin:4px 0 2px;font-weight:600">${escA(me.email)}</p><p class="lbl" style="margin:0">${st&&st.msg?"⚠︎ "+escA(st.msg):st&&st.at?"Sincronizado "+new Date(st.at).toLocaleTimeString("es-MX",{hour:"numeric",minute:"2-digit"}):"Conectado"}</p>
      <div class="btns"><button class="btn" id="nbOut">Cerrar sesión</button><button class="btn dark" id="nbSync">Sincronizar ahora</button></div>`);
    document.getElementById("nbSync").onclick=async()=>{if(!st)return;u.toast("Sincronizando…");const got=await st.pull();if(!got&&!st.msg){st.push()}setTimeout(()=>{u.toast(st.msg?"⚠︎ "+st.msg:"Sincronizado");u.close()},got?0:1800)};
    document.getElementById("nbOut").onclick=()=>{signOut();u.close();u.toast("Sesión cerrada")}}

  window.Nube={signIn,signUp,signOut,resetPassword,user,load,save,sync,accountSheet,lock:{available:lockAvailable,enable:lockEnable,disable:lockDisable,on:lockOn,unlock}};
})();
