# JAM7

Marcador semanal de ingreso/egreso laboral. PWA sin backend — todo se guarda en el navegador (localStorage). Pensada para uso informal entre compañeros de oficina, cada uno ve solo sus propios datos.

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

- Feriados nacionales argentinos: bloquean marcación ese día (lista hardcodeada en `app.js`, hay que actualizarla a mano cada año — ver sección de mantenimiento).

---

## Arquitectura (resumen para no perderse)

- **Sin servidor, sin base de datos.** Todo vive en `localStorage` del navegador de cada persona. Cada usuario tiene su propia semana, su propio historial, su propio backup. No hay forma de ver los datos de otra persona ni un panel centralizado — es la decisión correcta para este uso (competencia informal entre compañeros, no fichaje de RRHH).
- **Stack:** HTML + CSS + JavaScript vanilla. Sin frameworks, sin build step, sin dependencias de npm.
- **Archivos:**
  - `index.html` — estructura de la página
  - `styles.css` — toda la identidad visual (paleta oscura "marcador/scoreboard")
  - `app.js` — toda la lógica: cálculo de horas, validaciones, render, historial, import/export
  - `sw.js` — service worker, permite que la app funcione offline e instalarse como PWA
  - `manifest.webmanifest` — metadata para instalación (ícono, nombre, colores)
- **Persistencia:** tres claves de `localStorage`:
  - `jam7_v6_state` — semana actual
  - `jam7_history_v1` — semanas archivadas (hasta 26)
  - `jam7_settings_v3` — preferencias (meta diaria, modo solo lectura, etc.)
- **Riesgo conocido y aceptado:** si alguien borra el caché del navegador o cambia de dispositivo, pierde sus datos salvo que haya exportado un backup JSON antes. No hay sync automático. Mitigación: botón de exportar/importar JSON ya incluido.

---

## Cómo publicarla (GitHub Pages)

1. Repo público en GitHub, con todos estos archivos en la **raíz** (no en una subcarpeta).
2. `Settings` → `Pages` → Source: `Deploy from a branch` → Branch `main`, carpeta `/ (root)`.
3. Esperar 1-2 minutos. La URL queda en `https://tu-usuario.github.io/nombre-repo/`.
4. Cada actualización: commit + push desde GitHub Desktop, se despliega solo.

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

   > Estoy trabajando en JAM7, una PWA de marcador horario (sin backend, todo en localStorage). Stack: HTML/CSS/JS vanilla, sin frameworks. Reglas de negocio: jornada 8:30-16:00, ingreso flexible 7:30-9:30, egreso no antes de 15:30, meta 37.5hs/semana (7.5hs/día). Repo: [URL]. Antes de tocar código, decime tu diagnóstico y esperá mi confirmación.

   Esto evita que el modelo tenga que adivinar contexto o arquitectura cada vez, y fuerza a que te expliquen antes de ejecutar.

---

## Mantenimiento pendiente

- **Feriados:** la lista vive en `app.js`, constante `HOLIDAYS`. Hay que agregar los feriados de cada año nuevo a mano (verificar fechas oficiales, no son siempre las mismas — algunos se trasladan a lunes).
- **Techo de seguridad de 20:00** en el cálculo de salida sugerida: es un clamp interno que no debería activarse en la práctica. Si en algún momento se define una política de horas extra o jornada máxima, este es el lugar a revisar (`OUT_MAX` en `app.js`, aunque hoy no se usa para bloquear nada, solo queda documentado como referencia).

## Decisión registrada: notificaciones sin servidor (por ahora)

Las alertas (margen de ingreso, hora de salida sugerida) usan `setInterval` + Notification API del navegador — **sin backend, sin push real**. Limitación conocida y aceptada: si la pestaña/app está en segundo plano por mucho tiempo o el dispositivo está bloqueado, el chequeo periódico no corre de forma confiable (los navegadores lo frenan para ahorrar batería). Se mitigó agregando un re-chequeo inmediato cada vez que la app vuelve a primer plano (`visibilitychange`), que cubre el caso real más común: abrís la app para marcar tu egreso y ahí mismo te avisa si corresponde.

**Alternativa evaluada y descartada (por ahora):** notificaciones push reales vía Firebase Cloud Messaging u otro servidor. Se descartó porque requiere migrar de "todo en localStorage" a una base de datos compartida con backend — cambio de arquitectura significativo para el tamaño del problema (uso informal entre pocas personas). Si en el futuro la deuda de horas se vuelve un problema recurrente y el fix liviano no alcanza, revisar esta decisión.
