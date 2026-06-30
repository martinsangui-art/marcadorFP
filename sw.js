// JAM7 v7.0 SW — cache offline + notification click handler + Firebase Cloud Messaging
// IMPORTANTE: solo puede haber UN service worker por sitio. Por eso FCM no tiene
// su propio archivo separado (firebase-messaging-sw.js) — todo vive acá junto.
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCICPlzGFljBQEZIafB7_LFzQ-HiMYNj5k",
  authDomain: "jam7-marcador.firebaseapp.com",
  projectId: "jam7-marcador",
  storageBucket: "jam7-marcador.firebasestorage.app",
  messagingSenderId: "109218075671",
  appId: "1:109218075671:web:a8100c9d715d5c7a6ef852"
});
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload)=>{
  const title = payload.notification?.title || 'JAM7';
  const body = payload.notification?.body || '';
  self.registration.showNotification(title, {body, icon:'assets/icons/icon-192.png', tag:'jam7-alert'});
});

const CACHE='jam7-v8-fix-nan-saldo';
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
