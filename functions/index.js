// JAM7 — Cloud Function: chequeo de alertas y envío de push real
// Corre cada minuto en el servidor de Firebase, sin depender de que la app esté abierta.
// Replica la misma lógica de horarios que vive en app.js (checkAlerts), para que el
// servidor y el cliente nunca se desincronicen sobre qué corresponde avisar.

const {onSchedule} = require("firebase-functions/v2/scheduler");
const {logger} = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

// --- Mismas reglas de negocio que en app.js ---
const IN_BOUNDS = [7 * 60 + 30, 9 * 60 + 30]; // 07:30 a 09:30
const OUT_MIN = 15 * 60 + 30;                  // nunca antes de 15:30
const IN_WARN_LEAD = 20; // minutos antes del límite de ingreso para avisar
const OUT_WARN_LEAD = 10; // minutos antes de la salida sugerida para avisar

function nowMinutesInTZ(tz) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const hh = parseInt(parts.find(p => p.type === "hour").value, 10);
  const mm = parseInt(parts.find(p => p.type === "minute").value, 10);
  return hh * 60 + mm;
}

function weekdayIndexInTZ(tz) {
  // 0=Lunes ... 4=Viernes, -1 si es sábado o domingo
  const now = new Date();
  const dayName = new Intl.DateTimeFormat("en-US", {timeZone: tz, weekday: "short"}).format(now);
  const map = {Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: -1, Sun: -1};
  return map[dayName] ?? -1;
}

function targetDayMin(settings) {
  const s = (settings && settings.dailyTarget) || "07:30";
  const [hh, mm] = s.split(":").map(Number);
  return hh * 60 + (mm || 0);
}

function minutesFromISO(iso, tz) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const hh = parseInt(parts.find(p => p.type === "hour").value, 10);
  const mm = parseInt(parts.find(p => p.type === "minute").value, 10);
  return hh * 60 + mm;
}

function minutesBetween(isoA, isoB) {
  return Math.max(0, Math.round((new Date(isoB) - new Date(isoA)) / 60000));
}

function computeSaldoPrevios(days, idx, tgt) {
  let s = 0;
  for (let i = 0; i < idx; i++) {
    const r = days[i];
    if (r && r.in && r.out) s += minutesBetween(r.in, r.out) - tgt;
  }
  return s;
}

function suggestedExitMinutes(ingresoHoyMin, saldoPreviosMin, tgt) {
  const raw = ingresoHoyMin + tgt - saldoPreviosMin;
  return Math.max(raw, OUT_MIN);
}

function fmtMinutes(mins) {
  const sgn = mins < 0 ? "-" : "";
  mins = Math.abs(mins);
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${sgn}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function fmtClock(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

const TZ = "America/Argentina/Buenos_Aires";

async function sendPush(token, title, body) {
  try {
    await messaging.send({token, notification: {title, body}});
  } catch (e) {
    logger.warn("Error enviando push (token probablemente inválido/expirado):", e.message);
  }
}

exports.checkAlertsAndNotify = onSchedule(
  {schedule: "every 1 minutes", timeZone: TZ},
  async () => {
    const idxToday = weekdayIndexInTZ(TZ);
    if (idxToday < 0) return; // fin de semana, nada que avisar

    const mins = nowMinutesInTZ(TZ);
    const snapshot = await db.collection("users").get();

    const batch = [];
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.fcmToken) return; // usuario sin notificaciones activadas

      const state = data.state || {};
      const days = state.days || [];
      const tgt = targetDayMin(data.settings);
      const notified = data.notified || {};
      const today = new Date().toLocaleDateString("en-CA", {timeZone: TZ}); // YYYY-MM-DD
      const todayNotified = notified.date === today ? notified : {date: today};

      const rec = days[idxToday] || {};
      let updates = null;

      if (!rec.in) {
        const minsToLimit = IN_BOUNDS[1] - mins;
        if (mins > IN_BOUNDS[1] && !todayNotified.inMissed) {
          batch.push(sendPush(data.fcmToken, "JAM7", "Pasaste el margen de ingreso (09:30). Registrá el horario real en edición manual."));
          updates = {...todayNotified, inMissed: true};
        } else if (minsToLimit > 0 && minsToLimit <= IN_WARN_LEAD && !todayNotified.inWarn) {
          batch.push(sendPush(data.fcmToken, "JAM7", `Te quedan ${minsToLimit} min para marcar ingreso (límite 09:30).`));
          updates = {...todayNotified, inWarn: true};
        }
      } else if (rec.in && !rec.out) {
        const ingresoMin = minutesFromISO(rec.in, TZ);
        const saldoPrevios = computeSaldoPrevios(days, idxToday, tgt);
        const exitMin = suggestedExitMinutes(ingresoMin, saldoPrevios, tgt);
        const minsToExit = exitMin - mins;
        const esViernes = idxToday === 4;

        if (mins >= exitMin && !todayNotified.outReached) {
          const msg = esViernes
            ? `Último día para recuperar saldo. Salida de cierre: ${fmtClock(exitMin)}.`
            : "Llegó tu hora de salida sugerida.";
          batch.push(sendPush(data.fcmToken, "JAM7", msg));
          updates = {...todayNotified, outReached: true};
        } else if (minsToExit > 0 && minsToExit <= OUT_WARN_LEAD && !todayNotified.outWarn) {
          const msg = esViernes
            ? `Faltan ${minsToExit} min para tu salida de cierre de semana.`
            : `Faltan ${minsToExit} min para tu salida sugerida.`;
          batch.push(sendPush(data.fcmToken, "JAM7", msg));
          updates = {...todayNotified, outWarn: true};
        }
      }

      if (updates) {
        batch.push(doc.ref.set({notified: updates}, {merge: true}));
      }
    });

    await Promise.all(batch);
    logger.info(`Chequeo completo. Usuarios revisados: ${snapshot.size}.`);
  }
);
