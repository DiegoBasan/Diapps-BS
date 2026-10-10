/* Service worker del selector. Cada app de una subcarpeta tiene el suyo; solo se borran cachés con prefijo "hub-". */
const VERSION="hub-v12";
const CORE=["./","index.html","manifest.webmanifest","icons/apple-touch-icon.png","icons/icon.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("hub-")&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const url=new URL(r.url);
  // Solo la página del selector; las apps de subcarpetas tienen su propio service worker
  if(r.mode==="navigate"){
    const root=new URL("./",self.registration.scope).pathname;if(url.pathname!==root&&url.pathname!==root+"index.html")return;
    e.respondWith(fetch(r).then(res=>{const c=res.clone();caches.open(VERSION).then(k=>k.put("index.html",c));return res}).catch(()=>caches.match("index.html")));return}
  if(/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)||CORE.some(p=>url.href===new URL(p,self.registration.scope).href)){
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok||res.type==="opaque"){const c=res.clone();caches.open(VERSION).then(k=>k.put(r,c))}return res})));
  }
});
