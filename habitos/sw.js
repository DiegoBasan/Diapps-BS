/* Service worker de Rutinas: abre sin conexión. Solo borra cachés con prefijo "ritmo-". */
const VERSION="ritmo-v6";
const CORE=["./","index.html","manifest.webmanifest","icons/apple-touch-icon.png","icons/icon.svg","icons/icon-192.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("ritmo-")&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const url=new URL(r.url);
  if(r.mode==="navigate"){e.respondWith(fetch(r).then(res=>{const c=res.clone();caches.open(VERSION).then(k=>k.put("index.html",c));return res}).catch(()=>caches.match("index.html")));return}
  if(url.href.startsWith(self.registration.scope)||/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)){
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok||res.type==="opaque"){const c=res.clone();caches.open(VERSION).then(k=>k.put(r,c))}return res})));
  }
});

/* Al tocar una notificación se abre (o enfoca) Rutinas */
self.addEventListener("notificationclick",e=>{e.notification.close();e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{for(const c of l)if("focus" in c)return c.focus();return clients.openWindow((e.notification.data&&e.notification.data.url)||"./")}))});
