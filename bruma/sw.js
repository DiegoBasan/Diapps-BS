/* Service worker de Bruma: abre sin conexión después de la primera visita (código, modelos y texturas se
   guardan al usarse). Solo borra cachés con prefijo "bruma-". */
const VERSION="bruma-v1";
const CORE=["./","index.html","app.js","manifest.webmanifest","icons/apple-touch-icon.png","icons/icon-192.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("bruma-")&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const url=new URL(r.url);
  if(r.mode==="navigate"){e.respondWith(fetch(r).then(res=>{const c=res.clone();caches.open(VERSION).then(k=>k.put("index.html",c));return res}).catch(()=>caches.match("index.html")));return}
  if(url.href.startsWith(self.registration.scope)||/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)){
    // código: red primero (para recibir cambios); modelos, texturas y fuentes: caché primero
    if(/\.(js|html|webmanifest)$/.test(url.pathname)){e.respondWith(fetch(r).then(res=>{if(res.ok){const c=res.clone();caches.open(VERSION).then(k=>k.put(r,c))}return res}).catch(()=>caches.match(r)));return}
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok||res.type==="opaque"){const c=res.clone();caches.open(VERSION).then(k=>k.put(r,c))}return res})));
  }
});
