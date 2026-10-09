/* Service worker: la app abre sin conexión. Sube VERSION al cambiar archivos. */
const VERSION="jetta-v10";
const CORE=["./","index.html","manifest.webmanifest","jetta_iso.webp","jetta_side.webp","jetta_hood.webp","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith("jetta-")&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const url=new URL(r.url);
  // HTML: red primero para recibir actualizaciones, caché si no hay señal
  if(r.mode==="navigate"){e.respondWith(fetch(r).then(res=>{const c=res.clone();caches.open(VERSION).then(k=>k.put("index.html",c));return res}).catch(()=>caches.match("index.html")));return}
  // Resto (imágenes, fuentes): caché primero
  if(url.origin===location.origin||/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)){
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok||res.type==="opaque"){const c=res.clone();caches.open(VERSION).then(k=>k.put(r,c))}return res})));
  }
});
