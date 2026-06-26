// JAM7 — Sincronización con Firestore
// Estrategia: localStorage sigue siendo la fuente de verdad INMEDIATA (la app responde al instante,
// igual que antes). Firestore es la copia en la nube que se sincroniza en segundo plano.
// Esto evita reescribir toda la app a async/await de golpe, y además permite que la app
// siga funcionando offline (ya estaba pensada así, con el service worker).

let fbApp = null, fbAuth = null, fbDb = null, fbUser = null;
let syncReady = false;
let syncQueue = [];

function fbLog(...args){ console.log('[JAM7 sync]', ...args); }

async function initFirebaseSync(){
  try{
    fbApp = firebase.initializeApp(firebaseConfig);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();

    await new Promise((resolve)=>{
      fbAuth.onAuthStateChanged(async (user)=>{
        if(user){
          fbUser = user;
          fbLog('Autenticado como', user.uid);
          syncReady = true;
          resolve();
          flushSyncQueue();
          await pullFromCloudOnce();
        } else {
          try{ await fbAuth.signInAnonymously(); }
          catch(e){ fbLog('Error en login anónimo:', e); resolve(); }
        }
      });
    });
  }catch(e){
    fbLog('No se pudo inicializar Firebase, la app sigue funcionando solo local:', e);
  }
}

function userDocRef(){
  if(!fbDb || !fbUser) return null;
  return fbDb.collection('users').doc(fbUser.uid);
}

// Empuja el estado completo (state + history + settings + name) a Firestore.
// Se llama después de cada saveState/saveHistory/setSettings/setUserName locales.
function pushToCloud(){
  if(!syncReady){ syncQueue.push(true); return; } // se reintenta cuando esté listo
  const ref = userDocRef();
  if(!ref) return;
  try{
    const payload = {
      state: getState(),
      history: getHistory(),
      settings: getSettings(),
      name: getUserName(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    ref.set(payload, {merge:true}).catch(e=>fbLog('Error al sincronizar (se reintentará en el próximo cambio):', e));
  }catch(e){ fbLog('Error preparando datos para sync:', e); }
}

function flushSyncQueue(){
  if(syncQueue.length===0) return;
  syncQueue=[];
  pushToCloud();
}

// Al iniciar sesión, si la nube tiene datos más nuevos que el dispositivo (ej: usaste otro celu),
// los trae UNA VEZ al abrir la app. No pisa nada después de eso en esta sesión — evita pelear
// con lo que el usuario está tipeando/marcando en el momento.
async function pullFromCloudOnce(){
  const ref = userDocRef();
  if(!ref) return;
  try{
    const snap = await ref.get();
    if(!snap.exists) { pushToCloud(); return; } // primera vez de este usuario, sube lo que tiene local
    const cloud = snap.data();
    if(cloud.state) localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud.state));
    if(cloud.history) localStorage.setItem(HISTORY_KEY, JSON.stringify(cloud.history));
    if(cloud.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(cloud.settings));
    if(cloud.name) localStorage.setItem(NAME_KEY, cloud.name);
    fbLog('Datos traídos de la nube.');
    if(typeof render==='function') render();
    if(typeof applyGreeting==='function') applyGreeting();
  }catch(e){ fbLog('No se pudo traer datos de la nube (se sigue trabajando local):', e); }
}

// Pide permiso de notificación + token de FCM, y lo guarda en Firestore para que
// la Cloud Function (lado servidor) sepa a qué dispositivo mandarle el push.
async function registerPushToken(){
  if(!('Notification' in window) || !('serviceWorker' in navigator)){
    fbLog('Este navegador no soporta push.');
    return {ok:false, reason:'unsupported'};
  }
  try{
    const perm = await Notification.requestPermission();
    if(perm!=='granted') return {ok:false, reason:'denied'};

    // Usamos el MISMO service worker que ya cachea la app offline — un sitio solo
    // puede tener un service worker activo, así que FCM se registra sobre ese mismo.
    const reg = await navigator.serviceWorker.ready;
    const messaging = firebase.messaging();
    const token = await messaging.getToken({vapidKey: FCM_VAPID_KEY, serviceWorkerRegistration: reg});

    if(!token) return {ok:false, reason:'no-token'};

    const ref = userDocRef();
    if(ref){
      await ref.set({fcmToken: token, fcmTokenUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()}, {merge:true});
      fbLog('Token de notificaciones guardado.');
    }
    return {ok:true};
  }catch(e){
    fbLog('Error registrando token de push:', e);
    return {ok:false, reason:'error', error:e};
  }
}
