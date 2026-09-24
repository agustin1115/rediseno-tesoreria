# Cash Flow Proyectado · Tesorería (rediseño, preview)

⚠️ **Este repo es una copia de vista previa** del proyecto real
[`cashflow-tesoreria`](https://github.com/agustin1115/cashflow-tesoreria), con
`index.html`/`css/style.css` reorganizados visualmente: topbar con el switch
de empresa, franja de KPIs, pestañas (Financiera / Modo B / Cargar archivos)
en vez de la tira larga de uploads, y Cash Flow proyectado + Resumen de
Posición lado a lado en vez de uno abajo del otro. Sirve para evaluar el
rediseño antes de aplicarlo al repo real.

⚠️ **`js/app.js` es copia idéntica del repo real — `js/app-patches.js` NO.**
Este repo tiene funcionalidad que el repo real todavía no tiene: el Resumen
de Posición con Modo A/Modo B y la lectura de Cobrar/Incobrables desde
TFcobranzas (ver abajo). Si en algún momento querés llevar esto al repo real,
avisame — no es un simple copy-paste porque ahí `app-patches.js` es distinto.

⚠️ **Usa la misma base de Supabase que producción.** No cambié `SUPABASE_URL`
ni las tablas — si subís un Excel acá, se guarda en la misma base que usa el
sitio real (`agustin1115.github.io/cashflow-tesoreria`). Para solo mirar el
diseño no hay problema; para probar subidas, tené en cuenta que van a
impactar en los datos reales de ambas empresas.

## Qué cambió respecto al original

- **Topbar** fija arriba con el switch TF Carnes/Trade Food, en vez de un header
  separado + una fila de horizonte/estado aparte.
- **Grilla de KPIs** con números grandes (Teko) en vez de la tabla de tarjetas chica.
- **Financiera, Modo B y Cargar archivos** pasan a ser pestañas dentro de cada
  panel de empresa, en vez de secciones siempre visibles + una tira de uploads
  compartida arriba de todo.
- **Cash Flow proyectado y Resumen de Posición van lado a lado** (grid de 2
  columnas) en vez de uno abajo del otro. El Resumen sigue siendo una sola
  instancia compartida entre las dos empresas (mismos números de ambas
  columnas TFC/TF siempre) — lo que cambia es que se muda al lado del Cash
  Flow de la empresa que tengas seleccionada. Se apila en una sola columna
  por debajo de los 960px de ancho.
- **Resumen de Posición con Modo A / Modo B** (pestañas, mismo patrón que
  Cartera de Cheques/Cuentas a Pagar en Detalle) — ver el detalle de cada
  número más abajo.
- Una sola tipografía de números (Teko + DM Sans) y un único estilo de tabla
  reutilizado en Cash Flow / Financiera / Modo B / Detalle / Resumen.
- Los colores de marca (`--tfc-primary:#506E3E`, `--tf-primary:#630000`) son
  exactamente los mismos que el repo real — no se inventó ninguna paleta nueva.

## Estructura

- `index.html` — markup reorganizado
- `css/style.css` — estilos nuevos (mismos selectores que usa `app.js`, redefinidos)
- `js/app.js` — copia idéntica del repo real, sin tocar
- `js/app-patches.js` — parches sobre `app.js` (cotización Modo B, Resumen de
  Posición con Modo A/B, lectura de Cobrar/Incobrables desde TFcobranzas,
  reubicación del Resumen al cambiar de empresa) — **este archivo SÍ tiene
  lógica nueva que no existe en el repo real**

## Supabase

Mismo proyecto y tablas que `cashflow-tesoreria` — ver el README de ese repo para
el detalle completo (tablas, RLS, `anon` key).

## Deploy

GitHub Pages sirve `index.html` directo desde `main`.

---

## De dónde sale cada número

Todo lo que sigue está separado por sección de la pantalla, en el orden en
que aparecen. "Sheet" = Google Sheet leído en vivo por `gviz/tq` (JSONP, sin
login) cada vez que cargás la página o apretás "↺ Actualizar". "Excel
manual" = un archivo que subís vos con el botón correspondiente; queda
guardado en `localStorage` **y** en Supabase (mismo proyecto que
`cashflow-tesoreria`) para que persista entre dispositivos.

### Franja de KPIs (arriba de cada empresa) — `renderKPIs()` en `app.js`

| KPI | De dónde sale |
|---|---|
| **Saldo bancos** | Sheet "Reporte Tesorería" de cada empresa (fila "TOTAL"), o el .xlsm de respaldo si el Sheet falla. Para TFC es la suma de **solo** los bancos operativos Galicia+Macro+CMF (`tfcOpBancos()`), no el total de la fila TOTAL — BAVSA se muestra aparte. |
| **Acuerdos descubierto** | Misma fila del Sheet, columna de al lado del saldo. |
| **Disponible para operar** | Saldo bancos + Acuerdos descubierto. |
| **Saldo BAVSA** (solo TFC) | Fila del banco "BAVSA" dentro del mismo Sheet "Reporte Tesorería" — no es una fuente separada. |
| **Fondos disponibles** (solo TFC) | Cartera cheques + Saldo BAVSA. |
| **Cartera cheques** | Excel manual que subís vos ("Cargar archivos" → cartera de cheques), más — solo TFC — los cheques físicos del Sheet "Cheques fisicos". Se descuentan los que marcaste como excluidos/adjudicados en la pantalla. |
| **Chq emitidos (total)** | Sheet "Ch. Emitidos" de cada empresa (misma planilla "Reporte Tesorería"), o el .xlsm de respaldo. |
| **Cuentas a pagar** | Excel manual que subís vos ("Cargar archivos" → cuentas a pagar), menos los ítems que marcaste como excluidos. |

### Cash Flow proyectado (tabla, `buildCF()` en `app.js`)

Cada fila es un día. **Saldo inicio** del primer día = Saldo bancos (TFC:
solo Galicia+Macro+CMF); de ahí en adelante es el Saldo fin del día
anterior. Por día:
- **Chq emitidos**: cheques del Sheet "Ch. Emitidos" cuya fecha de débito cae ese día.
- **Pagos**: ítems de Cuentas a pagar (Excel manual) con vencimiento ese día, más cualquier pago manual que hayas cargado a mano en el panel de detalle.
- **Ingresos**: en el día de HOY, es la Cartera de cheques activa (no adjudicada) — para TFC, **Fondos disponibles** completo (Cartera + BAVSA), mismo número que la tarjeta KPI. Para los días siguientes, solo ingresos manuales que hayas cargado a mano (no hay una fuente automática de cobranzas futuras acá — eso es justamente lo que ahora te trae el Resumen de Posición desde TFcobranzas, ver más abajo).
- **Saldo fin** = Saldo inicio − Chq emitidos − Pagos + Ingresos.
- **Disponible** = Saldo fin (mismo número, nombre distinto por columna).

### Financiera · Compromisos de Efectivo (solo TF Carnes)

Todo sale de un Excel que subís vos ("📄 Subir compromisos" en la pestaña
Financiera, `onCompromisosUpload()`), con Cliente / Fecha vto. cheque /
Importe. La fecha de entrega de efectivo se calcula sola: vencimiento del
cheque + 2 días hábiles.

| KPI | De dónde sale |
|---|---|
| **Compromisos** | Cantidad de filas del Excel que no marcaste como "pagado" en la tabla. |
| **Efectivo a entregar** | Suma del importe de esas filas. |
| **Costo financiero (3%)** | Efectivo a entregar × 3% — cálculo simple y directo (no es el cálculo con tope de $70M/día que arma el plan de cheques del Excel exportable; son dos cuentas distintas a propósito). |
| **Efectivo + costo (3%)** | Efectivo a entregar + Costo financiero. |

### Modo B (pestaña, `loadModoB()`/`renderModoB()` en `app.js`)

| KPI | De dónde sale |
|---|---|
| **Pesos en caja / Dólares en caja / Cheques Modo B** | Sheet compartido "resumen" (mismo Sheet ID para ambas empresas, una fila por empresa+concepto). |
| **Total equiv. pesos** | Pesos + Cheques + (Dólares × cotización que cargaste arriba, si la cargaste). El campo de cotización es tuyo, no sale de ningún Sheet — se guarda en tu navegador (`localStorage`). |
| **Total compromisos** (los 4 buckets Vencido/7/15/Más15) | Excel manual que subís vos en esta misma pestaña ("📄 Subir compromisos" de Modo B) — reutiliza el mismo parser que Cuentas a pagar. |

### Resumen de Posición — Modo A

Fórmula: **Bancos − Cheques emitidos − Cuentas a pagar + Cheques en cartera
+ Cobrar − Incobrables**. Confirmada contra el ejemplo de referencia que me
pasaste.

| Fila | De dónde sale |
|---|---|
| **Bancos** | Mismo número que "Saldo bancos" de la franja de KPIs. |
| **Cheques emitidos** | Mismo número que "Chq emitidos (total)". |
| **Cuentas a pagar** | Mismo número que "Cuentas a pagar" de la franja de KPIs. |
| **Cheques en cartera** | Mismo número que "Cartera cheques" de la franja de KPIs. |
| **Cobrar** | **TFcobranzas** (ver abajo). |
| **Incobrables** | **TFcobranzas** (ver abajo). |

### Resumen de Posición — Modo B

Fórmula: **Disponible (Modo B) − Cuentas a pagar + Cobrar − Movidas −
Incobrables**. ⚠️ **A diferencia de Modo A, esta fórmula es una inferencia
mía a partir de los nombres de fila de tu imagen de referencia — no tuve un
número concreto contra el cual confirmarla.** Si el total no te cierra,
avisame y la ajustamos.

| Fila | De dónde sale |
|---|---|
| **Disponible (Modo B)** | Mismo número que "Total equiv. pesos" de la pestaña Modo B. |
| **Cuentas a pagar** | Mismo número que Modo A. |
| **Cobrar** | **TFcobranzas** (ver abajo) — mismo número que Modo A. |
| **Movidas** | Solo TFC: mismo número que "Efectivo a entregar" de Financiera (compromisos activos, sin contar los que marcaste como pagados). Trade Food no tiene Financiera, así que queda "—". |
| **Incobrables** | **TFcobranzas** (ver abajo) — mismo número que Modo A. |

### Cobrar / Incobrables — desde TFcobranzas

TFcobranzas ([`agustin1115/TFcobranzas`](https://github.com/agustin1115/TFcobranzas))
no tiene base de datos propia: calcula todo al vuelo en el navegador leyendo
dos Google Sheets (uno por empresa, cada uno con pestañas "Archivo A" /
"Archivo B" o "A"/"B"). Este repo replica **exactamente la misma lógica**
(mismas listas de clientes excluidos/difícil-cobro, mismo criterio de
coincidencia parcial para TF Carnes) en `js/app-patches.js`, leyendo los
mismos dos Sheets en vivo — no hay una fuente nueva ni distinta.

- **Cobrar** = Total a cobrar de Archivo A + Total a cobrar de Archivo B (TFcobranzas muestra estos dos números por separado, nunca sumados — la suma es una decisión mía; si preferís otro criterio, decime).
- **Incobrables** = Difícil cobro/A resolver de Archivo A + de Archivo B, misma lógica de suma.
- Se refresca solo cada 10 minutos (no hace falta más frecuencia para un Sheet que no cambia todo el tiempo) y muestra "—" mientras carga la primera vez.
- Verificado corriendo el `app.js`/`tfcarnes.js` **real** de TFcobranzas contra los Sheets en vivo y comparando los totales byte a byte contra el puerto de este repo — coinciden exactos.

### Detalle (Cartera de Cheques / Cuentas a Pagar)

Listado fila por fila de exactamente los mismos datos que arman "Cartera
cheques" y "Cuentas a pagar" de arriba (mismos Excel manuales) — no hay
ninguna fuente adicional acá, es el detalle de esos mismos totales.
