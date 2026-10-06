const C='snapfree-v2';
self.addEventListener('install',e=>{e.waitUntil(self.skipWaiting());});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// Network-first: la app siempre trae el JS nuevo; solo usa caché sin conexión.
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 e.respondWith(fetch(e.request).then(r=>{
  const c=r.clone(); caches.open(C).then(cache=>cache.put(e.request,c)).catch(()=>{});
  return r;
 }).catch(()=>caches.match(e.request).then(h=>h||caches.match('./index.html'))));
});
