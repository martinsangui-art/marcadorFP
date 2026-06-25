// JAM7 v6.2 SW — cache bust + notification click handler
const CACHE='jam7-v6-2';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./assets/icons/icon-192.png','./assets/icons/icon-512.png','./assets/icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE&&caches.delete(k))))) });
self.addEventListener('fetch',e=>{ if(e.request.method!=='GET')return; e.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(e.request);const network=fetch(e.request).then(res=>{if(res&&res.status===200)cache.put(e.request,res.clone());return res}).catch(()=>cached);return cached||network})()) });
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window'}).then(clients=>{
    if(clients.length>0) return clients[0].focus();
    return self.clients.openWindow('./');
  }));
});
