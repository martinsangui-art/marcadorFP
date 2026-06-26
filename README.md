# JAM7

Marcador semanal de ingreso/egreso laboral. PWA con backend en Firebase (Firestore + Cloud Functions + push real). Pensada para uso informal entre compañeros de oficina, cada uno ve solo sus propios datos — no hay panel compartido ni ranking.

**Demo / app en vivo:** _(completar con la URL de GitHub Pages una vez publicada)_

---

## Reglas de negocio (la parte que importa, no el código)

Esto es lo que el sistema tiene que cumplir. Si algo en la app contradice esto, es un bug.

- Jornada nominal: **8:30 a 16:00** (7,5 hs).
- Meta semanal: **37,5 horas** (5 días × 7,5 hs).
- Margen de ingreso: se puede marcar entre **7:30 y 9:30**.
- Egreso: nunca antes de las **15:30**, sin excepción.
- **La salida sugerida depende de la hora de ingreso real de ese día**, no solo del saldo acumulado de otros días. Fórmula:

  ```
  salida sugerida = hora de ingreso de hoy + 7:30 hs − saldo a favor/en contra de días previos
  (nunca por debajo de las 15:30)
  ```

  Ejemplos:
  - Entrás 8:30, sin saldo previo → salís 16:00.
  - Entrás 9:15, sin saldo previo → salís 16:45 (no 15:30 — el ingreso tardío corre la salida).
  - Entrás 8:30, venís debiendo 30 min de días anteriores → salís 16:30.
  - Entrás 8:30, venís con 20 min a favor → salís 15:40.

- **Salida fija semanal (opcional):** los lunes, la app pregunta si preferís fijar una hora de salida pareja para toda la semana (15:30 o 16:00) en vez de que varíe según el ingreso de cada día. Si se elige, esa hora reemplaza el cálculo dinámico todos los días de esa semana — incluida la sugerencia y las alertas. Si no se elige (o si se empieza a usar la app un día que no es lunes), el valor por defecto es **15:30**. Importante: con hora fija activa, la deuda por llegar tarde **deja de autocompensarse** corriendo la salida — solo queda reflejada en el saldo semanal del scoreboard.

- Feriados nacionales argentinos: bloquean marcación ese día (lista hardcodeada en `app.js`, hay que actualizarla a mano cada año — ver sección de mantenimiento).

---

## Arquitectura (resumen para no perderse)

**Cliente (lo que corre en el navegador de cada persona):**
- **Stack:** HTML + CSS + JavaScript vanilla. Sin frameworks, sin build step, sin npm del lado del cliente (Firebase se carga vía CDN, no vía `npm install`).
- **Archivos:**
  - `index.html` — estructura de la página
  - `styles.css` — toda la identidad visual (paleta "panel de control industrial": acero, LEDs de estado, biseles)
  - `app.js` — toda la lógica: cálculo de horas, validaciones, render, historial, import/export, alertas
  - `firebase-config.js` — credenciales públicas del proyecto Firebase (son públicas por diseño, no hay nada que ocultar acá — la seguridad real vive en las reglas de Firestore)
  - `firebase-sync.js` — sincronización: login anónimo, push/pull de datos a Firestore, registro del token de notificaciones push
  - `sw.js` — **un único service worker** que hace tres cosas a la vez: caché offline (PWA instalable), manejo de click en notificaciones, y recepción de push de Firebase Cloud Messaging en segundo plano. Importante: un sitio solo puede tener un service worker activo, por eso todo vive fusionado en este archivo en vez de tener uno separado para FCM (que es lo que la documentación estándar de Firebase sugiere, pero rompe la instalación PWA si se hace por separado).
  - `manifest.webmanifest` — metadata para instalación (ícono, nombre, colores)

**Backend (Firebase, proyecto `jam7-marcador`):**
- **Authentication:** modo anónimo. Cada dispositivo obtiene un ID único persistente sin pedir email ni contraseña a nadie.
- **Firestore:** una colección `users`, un documento por persona (ID = su UID anónimo). Cada documento tiene `state` (semana actual), `history` (semanas archivadas), `settings`, `name`, y `fcmToken` (para mandarle push).
- **Reglas de seguridad:** cada usuario solo puede leer/escribir su propio documento (`request.auth.uid == userId`). Nadie puede ver los datos de otro, ni siquiera con el código fuente público en GitHub — la regla vive del lado del servidor de Google.
- **Cloud Functions** (`functions/index.js`, carpeta separada del cliente, con su propio `package.json`): una función programada (`checkAlertsAndNotify`) que corre **cada minuto**, sin depender de que ningún usuario tenga la app abierta. Lee todos los documentos de `users`, replica la misma lógica de horarios que el cliente (margen de ingreso, salida sugerida, hora fija semanal), y manda push real vía FCM cuando corresponde. Requiere plan **Blaze** de Firebase (pago por uso) — Cloud Functions no es compatible con el plan gratuito Spark, aunque el costo real esperado para este volumen de uso es prácticamente $0.

**Estrategia de sincronización cliente↔servidor:** `localStorage` sigue siendo la fuente de verdad *inmediata* (la app responde al instante, sin esperar red). Cada cambio se guarda local primero y se empuja a Firestore en segundo plano (`pushToCloud()`). Al abrir la app, si hay datos más nuevos en la nube (por ejemplo, se usó otro dispositivo), se traen una sola vez al iniciar sesión, sin pisar nada después en esa sesión.

**Riesgo conocido:** si dos personas comparten el mismo navegador/dispositivo sin diferenciarse, sus datos se mezclan — no hay login real con email, solo anónimo por dispositivo. Aceptado como límite consciente para mantener la fricción de uso en cero.

---

## Cómo publicarla (GitHub Pages)

1. Repo público en GitHub, con todos estos archivos en la **raíz** (no en una subcarpeta).
2. `Settings` → `Pages` → Source: `Deploy from a branch` → Branch `main`, carpeta `/ (root)`.
3. Esperar 1-2 minutos. La URL queda en `https://tu-usuario.github.io/nombre-repo/`.
4. Cada actualización: commit + push desde GitHub Desktop, se despliega solo.

## Cómo actualizar la Cloud Function (cuando cambia la lógica de horarios)

A diferencia del resto de la app (que se actualiza solo con subir a GitHub), la función vive en un proceso de deploy separado, manual, desde la terminal:

```
cd functions
npm install          # solo si se agregaron dependencias nuevas
cd ..
firebase deploy --only functions
```

Requiere tener **Node.js**, **Firebase CLI** (`npm install -g firebase-tools`) y estar logueado (`firebase login`) en la máquina desde la que se despliega. El deploy tarda 1-3 minutos. Confirmar éxito con `✔ Deploy complete!` en la terminal, o revisando los logs en Google Cloud Console.

---

## Cómo seguir pidiendo cambios (sin saber programar)

No hace falta leer el código para mantener este proyecto. Lo que hace falta es describir bien **el comportamiento**, no el código. Guía rápida:

1. **Describí síntoma con números reales**, no en abstracto.
   - Mal: "el cálculo de salida está mal".
   - Bien: "entro a las 9:15, el sistema me sugiere 15:30, pero según la regla debería sugerirme 16:45".

2. **Pedí diagnóstico antes que arreglo.**
   - "Antes de tocar nada, explicame en español llano qué está mal y por qué pasa." Así controlás que el diagnóstico tenga sentido antes de que se reescriba nada.

3. **Pedí prueba con ejemplos de la app, no de código.**
   - "Mostrame 4-5 casos (hora de entrada → hora de salida sugerida) que demuestren que ahora funciona." No necesitás leer JavaScript para verificar números.

4. **Empezá cada conversación nueva sobre este proyecto con este prompt ancla:**

   > Estoy trabajando en JAM7, una PWA de marcador horario con backend en Firebase (Firestore + Cloud Functions + push real vía FCM). El cliente es HTML/CSS/JS vanilla sin frameworks; la Cloud Function vive en una carpeta separada con su propio package.json. Reglas de negocio: jornada 8:30-16:00, ingreso flexible 7:30-9:30, egreso no antes de 15:30, meta 37.5hs/semana (7.5hs/día), con opción de fijar una salida pareja (15:30 o 16:00) elegida los lunes. Importante: la lógica de horarios está duplicada en app.js (cliente) y functions/index.js (servidor) — cualquier cambio de regla de negocio hay que aplicarlo en los dos lugares. Repo: [URL]. Antes de tocar código, decime tu diagnóstico y esperá mi confirmación.

   Esto evita que el modelo tenga que adivinar contexto o arquitectura cada vez, y fuerza a que te expliquen antes de ejecutar.

---

## Mantenimiento pendiente

- **Feriados:** la lista vive en `app.js`, constante `HOLIDAYS`. Hay que agregar los feriados de cada año nuevo a mano (verificar fechas oficiales, no son siempre las mismas — algunos se trasladan a lunes).
- **Techo de seguridad de 20:00** en el cálculo de salida sugerida: es un clamp interno que no debería activarse en la práctica. Si en algún momento se define una política de horas extra o jornada máxima, este es el lugar a revisar (`OUT_MAX` en `app.js`, aunque hoy no se usa para bloquear nada, solo queda documentado como referencia).

---

## Notificaciones push: cómo funcionan realmente

Decisión tomada (revertida respecto a una evaluación anterior, ver historia más abajo): **sí se implementó push real con servidor**, no solo el fallback liviano del lado del cliente.

- El cliente pide permiso de notificaciones y un **token de FCM** (Firebase Cloud Messaging), que se guarda en su documento de Firestore.
- La Cloud Function `checkAlertsAndNotify` corre cada minuto en el servidor de Google, sin importar si el celular está bloqueado o la app cerrada del todo.
- Si corresponde avisar (margen de ingreso por vencer, hora de salida sugerida llegando), manda el push directo al dispositivo vía FCM.
- Se guarda un campo `notified` por usuario para no mandar el mismo aviso más de una vez por día.

**Verificación de que funciona:** revisar los logs de la función en Google Cloud Console (`Functions` → `checkAlertsAndNotify` → link a "vista de registros"). Cada ejecución exitosa deja una línea `Chequeo completo. Usuarios revisados: N.` — si aparece cada minuto sin errores, el motor funciona; que no dispare push no es un bug si en ese momento no hay ninguna condición de alerta vigente.

**Limitación que persiste igual:** la fórmula de horarios vive duplicada en dos lugares (`app.js` del cliente y `functions/index.js` del servidor) porque Cloud Functions no puede importar directamente código del cliente sin un paso de build adicional. Si se cambia una regla de negocio (por ejemplo el margen de ingreso, o la fórmula de salida sugerida), **hay que actualizar ambos archivos a mano** o el cliente y el servidor van a calcular cosas distintas. Ver `functions/index.js`, comentario al inicio.

### Historia de la decisión (para no repetir la discusión)

En una primera pasada se evaluó y se descartó meter servidor, priorizando simpleza. La razón para revertir esa decisión: la deuda de horas empezó a acumularse de forma real semana a semana (llegadas tarde sin compensar), y el fallback liviano (avisar solo al reabrir la app) no alcanzaba para evitarlo a tiempo. Con backend real, el push llega aunque la app esté cerrada — que es justamente el momento en que más hace falta el aviso.
