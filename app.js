// JAM7 v9 — Firebase + push real + panel industrial + alertas completas
const WEEKDAYS=["Lunes","Martes","Miércoles","Jueves","Viernes"];
const HOLIDAYS=new Set([
  // 2025
  "2025-01-01","2025-03-03","2025-03-04","2025-03-24","2025-04-02","2025-04-17","2025-04-18","2025-05-01","2025-05-02","2025-06-16","2025-06-20","2025-07-09","2025-08-15","2025-11-21","2025-11-24","2025-12-08","2025-12-25",
  // 2026 (no laborables/feriados nacionales Argentina — verificar oficialmente cada año)
  "2026-01-01","2026-02-16","2026-02-17","2026-03-24","2026-04-02","2026-04-03","2026-05-01","2026-05-25","2026-06-15","2026-06-20","2026-07-09","2026-08-17","2026-10-12","2026-11-23","2026-12-08","2026-12-25"
]);
const STORAGE_KEY="jam7_v6_state"; const RO_KEY="jam7_readonly_v1"; const SETTINGS_KEY="jam7_settings_v3"; const HISTORY_KEY="jam7_history_v1";
const NAME_KEY="jam7_username_v1";
const INSTALL_TIP_DISMISSED_KEY="jam7_install_tip_dismissed_v1";
const NOTIFIED_KEY="jam7_notified_v1"; // qué avisos ya se dispararon hoy, para no repetir
const IN_BOUNDS=[7*60+30,9*60+30]; const OUT_MIN=15*60+30;
const IN_WARN_LEAD=20; // minutos antes del tope de ingreso (9:30) para empezar a avisar
const OUT_WARN_LEAD=10; // minutos antes de la salida sugerida para avisar
const $=s=>document.querySelector(s);
const daysEl=()=>$('#days'); const wbTotal=()=>$('#wbTotal'); const wbSaldo=()=>$('#wbSaldo'); const wbSuggestTop=()=>$('#wbSuggestTop'); const toast=()=>$('#toast');
let editCtx=null; let deferredPrompt=null; let lastTap=0; const TAP_DELAY=260; const LONGPRESS_DELAY=420;
let alertTimer=null;

function pad(n){return n.toString().padStart(2,'0')}
function fmtMinutes(mins){const sgn=mins<0?"-":""; mins=Math.abs(mins); const h=Math.floor(mins/60),m=Math.round(mins%60);return `${sgn}${pad(h)}:${pad(m)}`;}
function startOfISOWeek(d){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());const day=(x.getDay()+6)%7;x.setDate(x.getDate()-day);x.setHours(0,0,0,0);return x;}
function toISODate(d){return d.toISOString().slice(0,10)}
function minutesBetween(a,b){return Math.max(0,Math.round((b-a)/60000))}
function vibrate(ms=15){try{navigator.vibrate&&navigator.vibrate(ms)}catch(e){}}
function readonly(){return localStorage.getItem(RO_KEY)==="1"}

// --- Sonidos (sintetizados con Web Audio API, sin archivos externos) ---
const SOUND_KEY="jam7_sound_enabled_v1";
function soundEnabled(){ return localStorage.getItem(SOUND_KEY)!=='0' } // activado por defecto
function setSoundEnabled(on){ localStorage.setItem(SOUND_KEY, on?'1':'0'); }

let _audioCtx=null;
function getAudioCtx(){
  if(_audioCtx) return _audioCtx;
  try{ _audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; }
  return _audioCtx;
}

// Tono simple: frecuencia, duración (seg), tipo de onda, volumen pico, retardo de inicio
function playTone(freq, duration, type='sine', peakGain=0.12, startTime=0){
  const ctx=getAudioCtx();
  if(!ctx) return;
  if(ctx.state==='suspended') ctx.resume().catch(()=>{});
  const osc=ctx.createOscillator();
  const gain=ctx.createGain();
  osc.type=type;
  osc.frequency.value=freq;
  const t0=ctx.currentTime+startTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peakGain, t0+0.015); // ataque rápido, evita "click" seco
  gain.gain.exponentialRampToValueAtTime(0.0001, t0+duration); // caída suave
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(t0); osc.stop(t0+duration+0.02);
}

// Ingreso: dos notas ascendentes cortas, sensación de "switch encendido"
function playSoundIn(){
  if(!soundEnabled()) return;
  playTone(523.25, 0.09, 'sine', 0.11, 0);    // C5
  playTone(783.99, 0.13, 'sine', 0.11, 0.08); // G5
}
// Egreso: dos notas descendentes, sensación de "cierre"
function playSoundOut(){
  if(!soundEnabled()) return;
  playTone(659.25, 0.09, 'sine', 0.11, 0);    // E5
  playTone(440.00, 0.16, 'sine', 0.11, 0.08); // A4
}
// Alerta: dos (o tres si es urgente) tonos tipo "sirena suave", coherente con panel industrial
function playSoundAlert(urgent){
  if(!soundEnabled()) return;
  const f1 = urgent ? 880 : 660;
  const f2 = urgent ? 660 : 523.25;
  playTone(f1, 0.14, 'triangle', 0.13, 0);
  playTone(f2, 0.14, 'triangle', 0.13, 0.16);
  if(urgent){ playTone(f1, 0.14, 'triangle', 0.13, 0.32); }
}

function getSettings(){try{return JSON.parse(localStorage.getItem(SETTINGS_KEY))||{dailyTarget:"07:30",density:"comfy",accent:"lime"}}catch(e){return {dailyTarget:"07:30",density:"comfy",accent:"lime"}}}
function setSettings(s){localStorage.setItem(SETTINGS_KEY,JSON.stringify(s));applySettings();if(typeof pushToCloud==='function')pushToCloud();}

function getUserName(){ return (localStorage.getItem(NAME_KEY)||"").trim() }
function setUserName(n){ n=(n||"").trim().slice(0,20); if(n) localStorage.setItem(NAME_KEY,n); applyGreeting(); if(typeof pushToCloud==='function')pushToCloud(); }
function greetingPhrase(){
  const h=new Date().getHours();
  if(h<12) return "Buen día";
  if(h<19) return "Buenas tardes";
  return "Buenas noches";
}
function applyGreeting(){
  const name=getUserName();
  const el=$('#greeting');
  if(!el) return;
  el.textContent = name ? `${greetingPhrase()}, ${name} 👋` : "JAM7";
}
function maybeAskName(){
  if(getUserName()) return;
  $('#nameModal').hidden=false; $('#nameModal').style.display='flex';
  setTimeout(()=>$('#nameInput').focus(),80);
}
$('#saveNameBtn')?.addEventListener('click',()=>{
  const v=$('#nameInput').value.trim();
  if(v){ setUserName(v); }
  $('#nameModal').style.display='none'; $('#nameModal').hidden=true;
});
$('#nameInput')?.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ $('#saveNameBtn').click(); } });
function targetDayMin(){const s=getSettings().dailyTarget||"07:30";const [hh,mm]=s.split(":").map(Number);return hh*60+(mm||0)}

function getState(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||initWeek()}catch(e){return initWeek()}}
function initWeek(){const ws=startOfISOWeek(new Date()).toISOString();const data={weekStart:ws,days:[null,null,null,null,null]};localStorage.setItem(STORAGE_KEY,JSON.stringify(data));return data}
function saveState(d){localStorage.setItem(STORAGE_KEY,JSON.stringify(d));if(typeof pushToCloud==='function')pushToCloud();}

// --- Historial ---
function getHistory(){try{return JSON.parse(localStorage.getItem(HISTORY_KEY))||[]}catch(e){return []}}
function saveHistory(h){localStorage.setItem(HISTORY_KEY,JSON.stringify(h));if(typeof pushToCloud==='function')pushToCloud();}
function archiveWeekIfChanged(prevData){
  if(!prevData||!prevData.weekStart) return;
  const hasAny=prevData.days.some(d=>d&&d.in&&d.out);
  if(!hasAny) return;
  const hist=getHistory();
  if(hist.some(h=>h.weekStart===prevData.weekStart)) return; // ya archivada
  const total=computeTotals(prevData);
  const saldo=computeSaldoMin(prevData);
  hist.unshift({weekStart:prevData.weekStart,total,saldo,days:prevData.days});
  saveHistory(hist.slice(0,26)); // hasta 26 semanas (~6 meses)
}

function computeTotals(data){let t=0;for(let i=0;i<5;i++){const r=data.days[i];if(r&&r.in&&r.out){t+=minutesBetween(new Date(r.in),new Date(r.out))}}return t}
function computeSaldoMin(data){let s=0,tgt=targetDayMin();for(let i=0;i<5;i++){const r=data.days[i];if(r&&r.in&&r.out){const m=minutesBetween(new Date(r.in),new Date(r.out));s+=m-tgt}}return s}
function computeSaldoPrevios(data,idx){let s=0,tgt=targetDayMin();for(let i=0;i<idx;i++){const r=data.days[i];if(r&&r.in&&r.out){const m=minutesBetween(new Date(r.in),new Date(r.out));s+=m-tgt}}return s}
// Calcula la salida sugerida para HOY a partir de:
//  - la hora de ingreso real de hoy (ingresoHoyMin, en minutos desde 00:00)
//  - la meta diaria (7:30hs = 450min por defecto)
//  - el saldo acumulado de días previos de la semana (saldoPreviosMin: + a favor, - en contra)
// Regla: salida = ingreso_hoy + meta_diaria - saldo_previos (si venís a favor, restás; si venís en contra, sumás)
// Piso normativo: nunca antes de las 15:30, sin importar cuánto saldo a favor tengas.
function suggestedExitFromIngreso(ingresoHoyMin, saldoPreviosMin){
  const tgt=targetDayMin();
  const raw = ingresoHoyMin + tgt - saldoPreviosMin;
  const clamp = Math.max(raw, OUT_MIN);
  return `${pad(Math.floor(clamp/60))}:${pad(clamp%60)}`;
}
function suggestedExitMinutes(ingresoHoyMin, saldoPreviosMin){
  const tgt=targetDayMin();
  const raw = ingresoHoyMin + tgt - saldoPreviosMin;
  return Math.max(raw, OUT_MIN);
}

// --- Alertas (visual + notificación del sistema) ---
function nowMin(){ const n=new Date(); return n.getHours()*60+n.getMinutes() }
function todayKey(){ return toISODate(new Date()) }

function getNotified(){ try{ const d=JSON.parse(localStorage.getItem(NOTIFIED_KEY))||{}; return d.date===todayKey()?d:{date:todayKey()} }catch(e){ return {date:todayKey()} } }
function markNotified(flag){ const d=getNotified(); d[flag]=true; localStorage.setItem(NOTIFIED_KEY, JSON.stringify(d)) }

function canNotify(){ return 'Notification' in window && Notification.permission==='granted' }
async function fireNotification(title,body){
  if(!canNotify()) return;
  try{
    if('serviceWorker' in navigator){
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title,{body,icon:'assets/icons/icon-192.png',tag:'jam7-alert'});
      return;
    }
    new Notification(title,{body});
  }catch(e){
    console.warn('JAM7: no se pudo mostrar la notificación del sistema (queda el banner visual igual).', e);
    try{ new Notification(title,{body}); }catch(e2){ console.warn('JAM7: fallback de Notification también falló.', e2); }
  }
}

let _lastBannerKind=null;
function setBanner(kind,text){
  const b=$('#alertBanner'), t=$('#alertBannerText');
  if(!text){ b.hidden=true; _lastBannerKind=null; return }
  b.hidden=false; b.className='alert-banner '+kind; t.textContent=text;
  // Sonido solo en la transición hacia warn/urgent (no se repite mientras la alerta sigue activa,
  // ni suena en good/info que son tono positivo/neutral).
  if((kind==='warn'||kind==='urgent') && _lastBannerKind!==kind){
    playSoundAlert(kind==='urgent');
  }
  _lastBannerKind=kind;
}

let pinnedBanner=null; let pinnedUntil=0;
function setPinnedBanner(kind,text,durationMs){
  pinnedBanner={kind,text}; pinnedUntil=Date.now()+durationMs;
  setBanner(kind,text);
}
function pinnedActive(){ return pinnedBanner && Date.now()<pinnedUntil }

// Corre cada vez que se renderiza Y cada 60s en segundo plano (ver startAlertLoop)
function checkAlerts(){
  if(pinnedActive()){ setBanner(pinnedBanner.kind, pinnedBanner.text); return }
  const data=getState();
  const idxToday=(new Date().getDay()+6)%7;
  if(idxToday<0||idxToday>4){ setBanner(null,null); return } // fin de semana
  const dayDate=startOfISOWeek(new Date()); dayDate.setDate(dayDate.getDate()+idxToday);
  if(HOLIDAYS.has(toISODate(dayDate))){ setBanner(null,null); return }

  const rec=data.days[idxToday]||{};
  const mins=nowMin();
  const notified=getNotified();

  if(!rec.in){
    // Todavía no marcó ingreso hoy
    const minsToLimit = IN_BOUNDS[1]-mins; // minutos hasta las 9:30
    if(mins<IN_BOUNDS[0]){
      // Madrugada: todavía no abrió la ventana de ingreso (00:00 a 07:30)
      setBanner('warn', `Todavía no es horario para marcar ingreso. La ventana abre a las ${pad(Math.floor(IN_BOUNDS[0]/60))}:${pad(IN_BOUNDS[0]%60)}.`);
    } else if(mins>IN_BOUNDS[1]){
      setBanner('urgent','Pasaste el margen de ingreso (09:30). Si llegaste, registrá el horario real en edición manual.');
    } else if(minsToLimit<=IN_WARN_LEAD){
      setBanner('warn',`Te quedan ${minsToLimit} min para marcar ingreso (límite 09:30).`);
      if(!notified.inWarn){ fireNotification('JAM7','Te quedan '+minsToLimit+' min para marcar tu ingreso.'); markNotified('inWarn'); }
    } else {
      setBanner(null,null);
    }
    return;
  }

  if(rec.in && !rec.out){
    // Ya entró, todavía no salió: avisar cerca de la hora de salida sugerida
    const ingresoMin = new Date(rec.in).getHours()*60+new Date(rec.in).getMinutes();
    const saldoPrevios = computeSaldoPrevios(data, idxToday);
    const exitMin = suggestedExitMinutes(ingresoMin, saldoPrevios);
    const minsToExit = exitMin-mins;
    const esViernes = idxToday===4;
    if(mins>=exitMin){
      const msg = esViernes
        ? 'Hoy es viernes: si salís ahora, la semana queda sin saldo recuperado. Tu salida de cierre es '+suggestedExitFromIngreso(ingresoMin,saldoPrevios)+'.'
        : 'Llegó tu hora de salida sugerida ('+suggestedExitFromIngreso(ingresoMin,saldoPrevios)+').';
      setBanner('urgent',msg);
      if(!notified.outReached){ fireNotification('JAM7', esViernes ? 'Último día para recuperar saldo. Salida de cierre: '+suggestedExitFromIngreso(ingresoMin,saldoPrevios) : 'Llegó tu hora de salida sugerida.'); markNotified('outReached'); }
    } else if(minsToExit<=OUT_WARN_LEAD){
      const msg = esViernes
        ? `Faltan ${minsToExit} min para tu salida de cierre de semana (${suggestedExitFromIngreso(ingresoMin,saldoPrevios)}). Es viernes: no hay otro día para recuperar.`
        : `Faltan ${minsToExit} min para tu salida sugerida (${suggestedExitFromIngreso(ingresoMin,saldoPrevios)}).`;
      setBanner('warn',msg);
      if(!notified.outWarn){ fireNotification('JAM7', esViernes ? 'Faltan '+minsToExit+' min para tu salida de cierre de semana.' : 'Faltan '+minsToExit+' min para tu salida sugerida.'); markNotified('outWarn'); }
    } else {
      setBanner(null,null);
    }
    return;
  }

  setBanner(null,null); // día completo
}

function startAlertLoop(){
  checkAlerts();
  if(alertTimer) clearInterval(alertTimer);
  alertTimer=setInterval(checkAlerts, 60*1000);
}

let liveClockTimer=null;
function updateLiveClock(){
  const el=$('#liveClockTime');
  if(!el) return;
  const n=new Date();
  el.textContent = `${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}
function startLiveClock(){
  updateLiveClock();
  if(liveClockTimer) clearInterval(liveClockTimer);
  liveClockTimer=setInterval(updateLiveClock, 1000);
}
// Un solo listener de visibilidad para todos los timers — evita acumular listeners duplicados
// si startAlertLoop/startLiveClock se llaman más de una vez (ej. en resize).
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible'){
    checkAlerts();
    updateLiveClock();
  }
});

function updateNotifUI(){
  const btn=$('#notifBtn'), status=$('#notifStatus');
  if(!('Notification' in window)){ btn.disabled=true; btn.textContent='No disponible'; status.textContent='Este navegador no soporta notificaciones.'; return }
  if(Notification.permission==='granted'){ btn.textContent='Avisos activados'; btn.disabled=true; }
  else if(Notification.permission==='denied'){ btn.textContent='Bloqueadas'; btn.disabled=true; status.textContent='Las bloqueaste en el navegador. Para reactivarlas, cambiá el permiso del sitio en ajustes del navegador.'; }
  else { btn.textContent='Activar avisos'; btn.disabled=false; }
}
$('#notifBtn')?.addEventListener('click', async ()=>{
  if(typeof registerPushToken!=='function'){ showToast('Notificaciones no disponibles todavía.'); return; }
  const result = await registerPushToken();
  updateNotifUI();
  if(result.ok){ showToast('Avisos activados — incluso con la app cerrada.'); }
  else if(result.reason==='denied'){ showToast('Permiso denegado.'); }
  else { showToast('No se pudo activar. Probá de nuevo en unos segundos.'); }
});

function detectDevice(){const ua=navigator.userAgent||"";const mobile=/Mobi|Android|iPhone|iPad|iPod/i.test(ua)||window.matchMedia("(pointer:coarse)").matches||window.innerWidth<=600;document.body.classList.toggle('desktop',!mobile);updateInstallTip();}
function applySettings(){const s=getSettings();const root=document.documentElement;root.classList.remove('accent-amber','accent-cyan','accent-mono');if(s.accent&&s.accent!=='lime')root.classList.add('accent-'+s.accent);const app=$('#app');app.classList.remove('density-compact','density-comfy');app.classList.add('density-'+(s.density||'comfy'))}

function showToast(msg){const t=toast();t.textContent=msg;t.style.display='block';setTimeout(()=>{t.style.display='none';t.textContent=''},2200)}

function weekLabel(weekStartIso){
  const d=new Date(weekStartIso);
  const end=new Date(d); end.setDate(d.getDate()+4);
  const fmt=(x)=>`${pad(x.getDate())}/${pad(x.getMonth()+1)}`;
  return `${fmt(d)} – ${fmt(end)}`;
}

function render(){
  detectDevice(); applySettings();
  let data=getState(); const ws=startOfISOWeek(new Date()).toISOString();
  if(data.weekStart!==ws){ archiveWeekIfChanged(data); data=initWeek(); }
  const cont=daysEl(); cont.replaceChildren(); const weekStart=new Date(data.weekStart); const idxToday=(new Date().getDay()+6)%7;

  $('#weekSub').textContent=`Semana ${weekLabel(data.weekStart)}`;

  wbTotal().textContent=fmtMinutes(computeTotals(data));
  const saldo=computeSaldoMin(data); wbSaldo().textContent=saldo>0?("+"+fmtMinutes(saldo)):fmtMinutes(saldo); wbSaldo().className="seg-val "+(saldo>0?"pos":(saldo<0?"neg":"neu"));
  let suggest="—";
  if(idxToday>=0&&idxToday<=4){
    const recToday=data.days[idxToday]||{};
    if(recToday.in){
      const ingresoHoyMin = new Date(recToday.in).getHours()*60 + new Date(recToday.in).getMinutes();
      const saldoPrevios = computeSaldoPrevios(data,idxToday);
      suggest = suggestedExitFromIngreso(ingresoHoyMin, saldoPrevios);
    } else {
      suggest = "Marcá ingreso";
    }
  }
  wbSuggestTop().textContent=suggest;
  checkAlerts();

  for(let i=0;i<5;i++){
    const rec=data.days[i]||{}; const card=document.createElement('div');card.className='dayCard';card.id='day-'+i;
    if(i===idxToday) card.classList.add('active');

    const head=document.createElement('div'); head.className='dayHead';
    const led=document.createElement('div'); led.className='led';
    const num=document.createElement('div'); num.className='dayNum'; num.textContent=pad(i+1);
    const title=document.createElement('div');title.className='dayTitle';title.textContent=WEEKDAYS[i];
    const dur=document.createElement('div');dur.className='dayDur';
    const hasBoth=rec.in&&rec.out;
    dur.textContent=hasBoth?fmtMinutes(minutesBetween(new Date(rec.in),new Date(rec.out))):"—";
    if(hasBoth) { dur.classList.add('win'); led.style.background='var(--lime)'; led.style.boxShadow='0 0 7px var(--lime), inset 0 1px 1px rgba(255,255,255,.4)'; }
    head.appendChild(led);head.appendChild(num);head.appendChild(title);head.appendChild(dur);
    card.appendChild(head);

    const row=document.createElement('div');row.className='clockRow';
    const inP=document.createElement('button');inP.className='pill'+(rec.in?'':' empty');inP.textContent=rec.in?new Date(rec.in).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):"Ingreso";
    const outP=document.createElement('button');outP.className='pill'+(rec.out?'':' empty');outP.textContent=rec.out?new Date(rec.out).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):"Egreso";
    inP.onclick=()=>{if(readonly())return;openManual(i,'in',rec.in)};
    outP.onclick=()=>{if(readonly())return;openManual(i,'out',rec.out)};
    row.appendChild(inP);row.appendChild(outP);card.appendChild(row);

    attachGestures(card,i);

    if(i===idxToday){const sdiv=document.createElement('div');sdiv.className='suggestRow';const lab=document.createElement('span');lab.textContent='Salida sugerida';const v=document.createElement('span');v.className='value';v.textContent=suggest;sdiv.appendChild(lab);sdiv.appendChild(v);card.appendChild(sdiv)}

    const actions=document.createElement('div');actions.className='actions';
    const bIn=document.createElement('button');bIn.textContent='Marcar ingreso';bIn.className='btn good small';bIn.onclick=()=>{if(readonly())return;mark(i,'in')};
    const bOut=document.createElement('button');bOut.textContent='Marcar egreso';bOut.className='btn primary small';bOut.onclick=()=>{if(readonly())return;mark(i,'out')};
    const bClr=document.createElement('button');bClr.textContent='Borrar';bClr.className='btn warn small';bClr.onclick=()=>{if(readonly())return;if(confirm('¿Borrar '+WEEKDAYS[i]+'?')){let d=getState();d.days[i]=null;saveState(d);render()}};
    actions.appendChild(bIn);actions.appendChild(bOut);actions.appendChild(bClr);card.appendChild(actions);

    const dayDate=new Date(weekStart);dayDate.setDate(weekStart.getDate()+i);
    if(HOLIDAYS.has(dayDate.toISOString().slice(0,10))){[inP,outP,bIn,bOut].forEach(el=>{el.disabled=true;el.title='Feriado - bloqueado'});dur.textContent='Feriado';dur.style.opacity=.9}
    cont.appendChild(card);
  }
}

function attachGestures(card,i){
  let pressed=false; let timer=null;
  card.addEventListener('pointerdown',(e)=>{ if(readonly())return; if(e.target.closest('button')) return; pressed=true; timer=setTimeout(()=>{ if(pressed){ openSheet(i) } },LONGPRESS_DELAY)});
  card.addEventListener('pointerup',(e)=>{
    if(timer) clearTimeout(timer);
    if(!pressed) return;
    pressed=false;
    if(e.target.closest('button')) return;
    const now=Date.now();
    if(now-lastTap<TAP_DELAY){ e.preventDefault(); quickTap(i); lastTap=0 } else { lastTap=now }
  });
  card.addEventListener('pointerleave',()=>{ pressed=false; if(timer) clearTimeout(timer) });
}

function quickTap(i){
  let data=getState(); const rec=data.days[i]||{};
  if(!rec.in){ mark(i,'in'); vibrate(10) }
  else if(!rec.out){ mark(i,'out'); vibrate(10) }
  else showToast("Ese día ya tiene ingreso y egreso.");
}

// Sheet simple
function openSheet(i){
  $('#sheetDay').textContent=WEEKDAYS[i];
  const a=$('#sheetActions'); a.replaceChildren();
  const mk=(txt,cls,fn)=>{const b=document.createElement('button');b.className='btn '+(cls||'');b.textContent=txt;b.onclick=()=>{fn();closeSheet()};a.appendChild(b)};
  mk("Marcar ingreso","good",()=>mark(i,'in'));
  mk("Marcar egreso","primary",()=>mark(i,'out'));
  mk("Editar ingreso","",()=>openManual(i,'in',getState().days[i]?.in));
  mk("Editar egreso","",()=>openManual(i,'out',getState().days[i]?.out));
  mk("Ingreso 09:00","",()=>setManual(i,'in',9,0));
  mk("Egreso 15:30","",()=>setManual(i,'out',15,30));
  mk("Borrar día","warn",()=>{let d=getState();d.days[i]=null;saveState(d);render()});
  $('#sheetBackdrop').hidden=false; $('#sheetBackdrop').style.display='flex';
}
function closeSheet(){ $('#sheetBackdrop').style.display='none'; $('#sheetBackdrop').hidden=true }
$('#sheetClose').onclick=closeSheet;
$('#sheetBackdrop').addEventListener('pointerdown',(e)=>{ if(e.target.id==='sheetBackdrop') closeSheet() });

// Advertencia (informativa, no bloqueante) al marcar/editar un egreso que deja la semana en negativo.
// Devuelve true si corresponde continuar (no había problema, o el usuario confirmó igual), false si canceló.
function confirmSaldoNegativoSiCorresponde(dayIdx, data, inIso, outIso){
  const minutosHoyProyectado = minutesBetween(new Date(inIso), new Date(outIso));
  const saldoPrevios = computeSaldoPrevios(data, dayIdx);
  const saldoProyectado = saldoPrevios + (minutosHoyProyectado - targetDayMin());
  if(saldoProyectado>=0) return true;
  const esViernes = dayIdx===4;
  const msg = esViernes
    ? `Es viernes: si marcás ahora, la semana cierra con ${fmtMinutes(saldoProyectado)} y ya no hay otro día para recuperarlo. ¿Marcar igual?`
    : `Si marcás ahora, vas a quedar con ${fmtMinutes(saldoProyectado)} en la semana. Todavía tenés días para recuperarlo. ¿Marcar igual?`;
  return confirm(msg);
}

function setManual(dayIdx,field,hh,mm){
  let data=getState(); const s=new Date(data.weekStart); const d=new Date(s); d.setDate(s.getDate()+dayIdx); d.setHours(hh,mm,0,0);
  const mins=hh*60+mm;
  if(field==='in'){ if(mins<IN_BOUNDS[0]||mins>IN_BOUNDS[1]){alert("Ingreso permitido: 07:30–09:30");return} }
  else { if(mins<OUT_MIN){alert("Egreso no permitido antes de las 15:30");return}
         if(!data.days[dayIdx]||!data.days[dayIdx].in){alert("Primero cargá el ingreso.");return}
         const inTime=new Date(data.days[dayIdx].in); if(d<=inTime){alert("Egreso debe ser después del ingreso.");return}
         if(!confirmSaldoNegativoSiCorresponde(dayIdx, data, data.days[dayIdx].in, d.toISOString())) return; }
  if(!data.days[dayIdx]) data.days[dayIdx]={};
  data.days[dayIdx][field]=d.toISOString(); saveState(data); render();
}

// Modal manual HH→MM con salto
function openManual(dayIdx,field,iso){
  editCtx={dayIdx,field};
  $('#modalLabel').innerText=WEEKDAYS[dayIdx]+" — "+(field==='in'?'Ingreso':'Egreso');
  $('#modalHint').innerText= field==='out' ? "Egreso: no antes de las 15:30." : "Ingreso permitido: 07:30 a 09:30.";
  const hh=$('#hh'), mm=$('#mm'); if(iso){const d=new Date(iso);hh.value=d.getHours();mm.value=d.getMinutes()} else {hh.value="";mm.value=""}
  $('#timeModal').hidden=false; $('#timeModal').style.display='flex'; setTimeout(()=>{hh.focus();hh.select()},50);
}
$('#cancelEdit').onclick=()=>{ $('#timeModal').style.display='none'; $('#timeModal').hidden=true; editCtx=null };
function maybeJump(){ const hh=$('#hh'), mm=$('#mm'); const v=(hh.value||'').trim(); if(v.length>=2){ const n=parseInt(v,10); if(!isNaN(n)&&n>=0&&n<=23){ mm.focus(); mm.select(); } } }
$('#hh').addEventListener('input', maybeJump);
$('#hh').addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); maybeJump(); }});
$('#saveEdit').onclick=()=>{
  const hh=parseInt($('#hh').value,10), mm=parseInt($('#mm').value,10);
  if(isNaN(hh)||isNaN(mm)||hh<0||hh>23||mm<0||mm>59){alert("Hora inválida");return}
  let data=getState(); const s=new Date(data.weekStart); const d=new Date(s); d.setDate(s.getDate()+editCtx.dayIdx); d.setHours(hh,mm,0,0);
  const mins=hh*60+mm;
  if(editCtx.field==='in'){ if(mins<IN_BOUNDS[0]||mins>IN_BOUNDS[1]){alert("Ingreso permitido: 07:30–09:30");return} }
  else { if(mins<OUT_MIN){alert("Egreso no permitido antes de las 15:30");return}
         if(!data.days[editCtx.dayIdx]||!data.days[editCtx.dayIdx].in){alert("Primero cargá el ingreso.");return}
         const inTime=new Date(data.days[editCtx.dayIdx].in); if(d<=inTime){alert("Egreso debe ser después del ingreso.");return}
         if(!confirmSaldoNegativoSiCorresponde(editCtx.dayIdx, data, data.days[editCtx.dayIdx].in, d.toISOString())) return; }
  if(!data.days[editCtx.dayIdx]) data.days[editCtx.dayIdx]={};
  data.days[editCtx.dayIdx][editCtx.field]=d.toISOString(); saveState(data);
  $('#timeModal').style.display='none'; $('#timeModal').hidden=true; editCtx=null; render();
};

// Marcación
function mark(dayIdx,kind){
  let data=getState(); const s=new Date(data.weekStart); const now=new Date();
  const d=new Date(s); d.setDate(s.getDate()+dayIdx); d.setHours(now.getHours(),now.getMinutes(),0,0);
  const mins=now.getHours()*60+now.getMinutes(); const dayDate=new Date(s); dayDate.setDate(s.getDate()+dayIdx);
  if(HOLIDAYS.has(dayDate.toISOString().slice(0,10))){alert("Feriado nacional");return}
  if(kind==='in'){ if(mins<IN_BOUNDS[0]||mins>IN_BOUNDS[1]){alert("Ingreso fuera de horario permitido (07:30–09:30). Usá edición manual si necesitás registrar una excepción.");return} }
  if(kind==='out'){ if(mins<OUT_MIN){alert("Egreso no permitido antes de las 15:30");return}
    if(!data.days[dayIdx]||!data.days[dayIdx].in){alert("Primero cargá el ingreso.");return}
    const inTime=new Date(data.days[dayIdx].in); if(d<=inTime){alert("Egreso debe ser después del ingreso.");return}
    if(!confirmSaldoNegativoSiCorresponde(dayIdx, data, data.days[dayIdx].in, d.toISOString())) return; }
  if(!data.days[dayIdx]) data.days[dayIdx]={};
  data.days[dayIdx][kind]=d.toISOString(); saveState(data);
  if(kind==='in') playSoundIn(); else playSoundOut();
  if(kind==='in'){
    const ingresoHoyMin = now.getHours()*60+now.getMinutes();
    const saldoPrevios = computeSaldoPrevios(data,dayIdx);
    const sugerida = suggestedExitFromIngreso(ingresoHoyMin, saldoPrevios);
    const PIN_MS = 5*60*1000; // 5 minutos visible antes de que las reglas normales puedan retomar el banner
    if(dayIdx===4){
      // Viernes: aviso especial al marcar ingreso, con todo el día por delante para reaccionar
      if(saldoPrevios<0){
        setPinnedBanner('urgent', `Hoy es viernes y debés ${fmtMinutes(Math.abs(saldoPrevios))} de la semana. Tu salida de cierre es ${sugerida}.`, PIN_MS);
        fireNotification('JAM7', `Viernes: debés ${fmtMinutes(Math.abs(saldoPrevios))}. Salida de cierre: ${sugerida}.`);
      } else if(saldoPrevios>0){
        setPinnedBanner('good', `Vas con ${fmtMinutes(saldoPrevios)} a favor. Si salís 15:30 hoy, te sobran. Tip: la próxima semana repartilos mejor en los días en vez de juntarlos para el viernes.`, PIN_MS);
        showToast(`Vas ${fmtMinutes(saldoPrevios)} a favor 🎉 — salida de cierre: ${sugerida}`);
      } else {
        showToast("Salida sugerida (cierre de semana): "+sugerida);
      }
    } else {
      showToast("Salida sugerida: "+sugerida);
    }
  }
  render();
}

// Exports
$('#exportBtn').onclick=()=>{ const data=getState(); const s=new Date(data.weekStart); const rows=[["Día","Fecha","Ingreso","Egreso","Minutos","Horas"].join(",")];
  for(let i=0;i<5;i++){const d=new Date(s);d.setDate(s.getDate()+i);const rec=data.days[i]||{};if(HOLIDAYS.has(d.toISOString().slice(0,10))){rows.push([WEEKDAYS[i],d.toLocaleDateString(),"Feriado","Feriado",0,"00:00"].join(","));continue}
    let ing="",eg="",min=0,hhmm="";if(rec.in)ing=new Date(rec.in).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});if(rec.out)eg=new Date(rec.out).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});if(rec.in&&rec.out){min=Math.max(0,Math.round((new Date(rec.out)-new Date(rec.in))/60000));hhmm=fmtMinutes(min)}rows.push([WEEKDAYS[i],d.toLocaleDateString(),ing,eg,min,hhmm].join(","))}
  const total=computeTotals(data); rows.push(["Total semana","","","",total,fmtMinutes(total)].join(","));
  const blob=new Blob([rows.join("\n")],{type:"text/csv"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="jam7_semana.csv"; a.click(); URL.revokeObjectURL(url);
};
$('#exportJsonBtn').onclick=()=>{ const payload={version:6,settings:getSettings(),state:getState(),history:getHistory()}; const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download="jam7_backup.json"; a.click(); URL.revokeObjectURL(url); };

// Import JSON
$('#importJsonBtn').onclick=()=>{ $('#importJsonInput').click(); };
$('#importJsonInput').addEventListener('change', async (e)=>{
  const file=e.target.files[0]; if(!file) return;
  try{
    const text=await file.text();
    const payload=JSON.parse(text);
    if(!payload || !payload.state || !payload.state.days){ alert("El archivo no tiene el formato esperado de backup JAM7."); return; }
    if(!confirm("Esto va a reemplazar tus datos actuales (semana en curso + ajustes + historial) con los del backup. ¿Continuar?")) return;
    if(payload.settings) setSettings(payload.settings);
    saveState(payload.state);
    if(Array.isArray(payload.history)) saveHistory(payload.history);
    showToast("Backup importado correctamente.");
    render();
  }catch(err){
    alert("No se pudo leer el archivo. Verificá que sea un backup JSON exportado por JAM7.");
  }finally{
    e.target.value="";
  }
});

// Historial
$('#historyBtn').onclick=()=>{
  const list=$('#historyList'); list.replaceChildren();
  const hist=getHistory();
  if(hist.length===0){
    const e=document.createElement('div'); e.className='history-empty'; e.textContent='Todavía no hay semanas archivadas. Se guardan automáticamente cuando empieza una semana nueva.';
    list.appendChild(e);
  } else {
    hist.forEach(h=>{
      const item=document.createElement('div'); item.className='history-item';
      const left=document.createElement('div'); left.className='hw'; left.textContent=weekLabel(h.weekStart);
      const right=document.createElement('div'); right.className='hv'; right.textContent=fmtMinutes(h.total)+ " ("+(h.saldo>0?"+":"")+fmtMinutes(h.saldo)+")";
      item.appendChild(left); item.appendChild(right); list.appendChild(item);
    });
  }
  $('#historyModal').hidden=false; $('#historyModal').style.display='flex';
};
$('#closeHistory').onclick=()=>{ $('#historyModal').style.display='none'; $('#historyModal').hidden=true; };

// Settings
$('#settingsBtn').onclick=()=>{ const s=getSettings(); $('#settingsModal').hidden=false; $('#settingsModal').style.display='flex'; $('#readonlyToggle').checked=readonly(); $('#dailyTarget').value=s.dailyTarget||"07:30"; $('#densitySel').value=s.density||"comfy"; $('#accentSel').value=s.accent||"lime"; $('#nameSettingsInput').value=getUserName(); $('#soundToggle').checked=soundEnabled(); updateNotifUI(); };
$('#soundToggle')?.addEventListener('change',(e)=>{ setSoundEnabled(e.target.checked); if(e.target.checked) playSoundIn(); });
$('#nameSettingsInput')?.addEventListener('change',(e)=>{ setUserName(e.target.value); });
$('#closeSettings').onclick=()=>{ $('#settingsModal').style.display='none'; $('#settingsModal').hidden=true };
$('#readonlyToggle').onchange=e=>{ localStorage.setItem(RO_KEY, e.target.checked?'1':'0'); applyReadonly(); };
$('#dailyTarget').addEventListener('change',e=>{ const s=getSettings(); s.dailyTarget=e.target.value||"07:30"; setSettings(s); render(); });
$('#densitySel').addEventListener('change',e=>{ const s=getSettings(); s.density=e.target.value; setSettings(s); });
$('#accentSel').addEventListener('change',e=>{ const s=getSettings(); s.accent=e.target.value; setSettings(s); });

function applyReadonly(){ const on=readonly(); document.querySelectorAll('.btn.good,.btn.primary,.btn.warn,.pill').forEach(el=>{ on?el.setAttribute('disabled',''):el.removeAttribute('disabled') }) }

// Install / tip de "agregar a inicio" — adaptado a iOS, Android o Desktop
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true }
window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredPrompt=e;$('#installBtn').style.display='inline-block';updateInstallTip();});
$('#installBtn').addEventListener('click',async()=>{ if(!deferredPrompt)return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('#installBtn').style.display='none' });
function hideInstallIfStandalone(){ if(isStandalone()) $('#installBtn').style.display='none' }

function updateInstallTip(){
  const tip=$('#installTip'), txt=$('#installTipText');
  if(!tip||!txt) return;

  if(isStandalone()){ tip.hidden=true; return; } // ya instalada, no hay nada que decir
  if(localStorage.getItem(INSTALL_TIP_DISMISSED_KEY)==='1'){ tip.hidden=true; return; } // ya lo vio y lo cerró

  const ua=navigator.userAgent||"";
  const isIOS=/iPhone|iPad|iPod/i.test(ua);
  const isAndroid=/Android/i.test(ua);

  if(isIOS){
    txt.innerHTML='<strong>Instalar en iPhone:</strong> abrí esta página en Safari → tocá el ícono de compartir <span aria-hidden="true">⬆️</span> → "Agregar a inicio".';
  } else if(isAndroid){
    if(deferredPrompt){
      txt.innerHTML='<strong>Instalar en Android:</strong> tocá el botón "Instalar" arriba, o usá el menú ⋮ del navegador → "Instalar app" / "Agregar a pantalla de inicio".';
    } else {
      txt.innerHTML='<strong>Instalar en Android:</strong> abrí el menú ⋮ del navegador (arriba a la derecha) → "Instalar app" o "Agregar a pantalla de inicio".';
    }
  } else {
    // Desktop: no es el caso de uso principal, pero igual damos la instrucción genérica
    txt.innerHTML='<strong>Instalar en la compu:</strong> buscá el ícono de instalar en la barra de direcciones del navegador (Chrome/Edge), o el menú ⋮ → "Instalar JAM7".';
  }
  tip.hidden=false;
}
$('#hideInstallTip').addEventListener('click',()=>{ localStorage.setItem(INSTALL_TIP_DISMISSED_KEY,'1'); $('#installTip').hidden=true; });
$('#showInstallTipBtn')?.addEventListener('click',()=>{
  localStorage.removeItem(INSTALL_TIP_DISMISSED_KEY);
  updateInstallTip();
  $('#settingsModal').style.display='none'; $('#settingsModal').hidden=true;
  $('#installTip')?.scrollIntoView({behavior:'smooth', block:'start'});
});

// Reset
$('#resetBtn').onclick=()=>{ if(confirm("¿Reiniciar semana? (esto NO borra el historial ni el backup)")){ let data=getState(); archiveWeekIfChanged(data); localStorage.removeItem(STORAGE_KEY); const d=initWeek(); saveState(d); render(); } };

// SW
if('serviceWorker' in navigator){ window.addEventListener('load',()=>{ navigator.serviceWorker.register('./sw.js').catch(()=>{}) }) }

window.addEventListener('resize',()=>{ detectDevice(); applyReadonly(); });
// El navegador bloquea el audio hasta la primera interacción real del usuario.
// Destrabamos el AudioContext en el primer toque/click, así cuando llegue una alerta
// disparada sola por el timer (sin interacción en ese momento), el sonido ya funciona.
function unlockAudioOnce(){
  getAudioCtx();
  document.removeEventListener('pointerdown', unlockAudioOnce);
  document.removeEventListener('keydown', unlockAudioOnce);
}
document.addEventListener('pointerdown', unlockAudioOnce, {once:true});
document.addEventListener('keydown', unlockAudioOnce, {once:true});

(function init(){ hideInstallIfStandalone(); render(); applyReadonly(); startAlertLoop(); startLiveClock(); applyGreeting(); maybeAskName(); if(typeof initFirebaseSync==='function') initFirebaseSync(); })();
