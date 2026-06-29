# JAM7 — Informe de funcionalidades evaluadas
Preparado mientras dormís, para revisar al levantarte.

Criterio de evaluación: cada ítem responde a un problema real que ya viste en uso, no a "se ve cool". Separado en 3 tiers por relación esfuerzo/beneficio.

---

## TIER 1 — Alto impacto, bajo esfuerzo (haría estas primero)

### 1. Recordatorio de "olvidaste cerrar el día"
**Problema real:** si entrás y te olvidás de marcar egreso, el día queda colgado sin que nadie se dé cuenta hasta que abrís la app de nuevo — y para entonces ya no te acordás la hora real de salida.
**Cómo:** la misma Cloud Function que ya corre cada minuto, agregar un chequeo a las 21:00: si hay un `rec.in` sin `rec.out` para hoy, mandar push "Te olvidaste de marcar el egreso de hoy".
**Costo:** cero — mismo mecanismo que ya pagás (función ya desplegada, push ya funciona). Es agregar una condición más al `if`, no una pieza nueva.

### 2. Botón "deshacer" después de borrar un día
**Problema real:** el botón "Borrar" de cada tarjeta es irreversible. Un toque de más y perdiste el día sin aviso.
**Cómo:** guardar el último día borrado en una variable temporal (no persistente) y mostrar un toast con botón "Deshacer" por 5 segundos, patrón estándar de Gmail/Twitter.
**Costo:** bajo, una tarde. No toca arquitectura.

### 3. Indicador visual de "sincronizado" vs "pendiente de subir"
**Problema real:** hoy no hay ninguna señal de si tus datos ya llegaron a Firestore o todavía están solo locales. Si te quedás sin internet un rato, no te enterás.
**Cómo:** un ícono chico (nube con check / nube con reloj) en el header, que lea el estado de `pushToCloud()`.
**Costo:** bajo. Ya tenemos toda la lógica de sync, solo falta exponerla visualmente.

---

## TIER 2 — Impacto medio, esfuerzo medio

### 4. Vista de "racha" — días consecutivos sin debe
**Problema real:** lo charlamos indirectamente con el tema del viernes — hay un componente motivacional en ver "llevás 3 semanas sin deuda" que el saldo semanal solo no transmite.
**Cómo:** al archivar cada semana (ya lo hacemos), calcular si esa semana cerró en saldo ≥0 y mantener un contador de semanas consecutivas. Mostrarlo en el historial.
**Costo:** medio. Lógica simple, pero hay que decidir bien la regla (¿cuenta el primer día que faltás, o se resetea recién al cierre de semana?).
**Mi duda honesta:** esto empieza a acercarse a gamificación, que ya descartamos una vez (el ranking). Lo dejo en tier 2 a propósito — no lo haría sin que lo pidas explícitamente.

### 5. Exportar resumen mensual en PDF
**Problema real:** hoy el CSV es funcional pero crudo. Si alguna vez necesitás mostrarle el resumen a alguien (no para fichaje oficial, aclarado en el README), un PDF con cara prolija comunica mejor.
**Cómo:** usando una librería de generación de PDF en el cliente (jsPDF, gratis, vía CDN igual que Firebase) o aprovechando que yo ya tengo una skill de PDF en mi entorno para armarlo del lado del análisis y dejarte una plantilla.
**Costo:** medio. Nueva dependencia del cliente, hay que diseñar el layout del PDF.

### 6. Atajo de teclado para desktop (cuando usás la PC)
**Problema real:** detectamos que la app se adapta a desktop con `body.desktop`, pero hoy todo es a click. Si la usás seguido desde la compu, un atajo tipo "I" para marcar ingreso ahorra tiempo real.
**Costo:** bajo-medio. Hay que tener cuidado de no interferir con atajos del navegador.

---

## TIER 3 — Ideas con costo o riesgo que NO haría sin que lo decidas explícitamente

### 7. Resumen semanal automático por email
**Por qué no de entrada:** Firebase tiene Cloud Functions + un servicio de email (ej. Resend o SendGrid) con tier gratis, así que es viable sin costo para bajo volumen. Pero agrega una pieza más de infraestructura (otra cuenta, otra API key) para un beneficio que hoy nadie pidió. Lo pondría en lista solo si en algún momento decís "quiero un resumen los viernes sin abrir la app".

### 8. Modo oscuro/claro alternable
**Por qué no:** ya evaluamos esto al principio del proyecto y lo descartamos por ser puramente estético sin impacto funcional — la app ya es oscura fija por diseño industrial. Lo dejo en la lista solo para que conste que se evaluó, no porque lo recomiende.

### 9. Multi-dispositivo con login real (no solo anónimo)
**Por qué no ahora:** es la pieza que falta para que tus datos te sigan entre el celu y la compu sin perderse. Técnicamente simple (Firebase Auth ya soporta email/magic link gratis), pero es una decisión de producto, no solo técnica — cambia la fricción de "abrís y ya está" a "tenés que loguearte". Lo marco como candidato fuerte para la próxima conversación grande, no para meter de sorpresa.

---

## Mi recomendación concreta para arrancar

**Empezaría por el ítem 1 (recordatorio de egreso olvidado)** — es el que más se parece al problema real que ya viviste esta semana (deuda acumulada por días mal cerrados), reutiliza infraestructura que ya pagás, y es la extensión más natural de lo que armamos hoy.

Los ítems 2 y 3 los haría en la misma sesión que el 1, porque son chicos y no requieren que decidas nada de producto — son pulido técnico puro.

Todo lo de Tier 3 lo dejaría esperando a que surja la necesidad real, en vez de construir por las dudas.
