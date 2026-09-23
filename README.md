# Cash Flow Proyectado · Tesorería (rediseño, preview)

⚠️ **Este repo es una copia de vista previa** del proyecto real
[`cashflow-tesoreria`](https://github.com/agustin1115/cashflow-tesoreria), con la
misma lógica exacta (`js/app.js` y `js/app-patches.js` son copias idénticas, sin
ningún cambio) pero un `index.html`/`css/style.css` reorganizados visualmente:
topbar con el switch de empresa, franja de KPIs, y pestañas (Financiera / Modo B /
Cargar archivos) en vez de la tira larga de uploads y las secciones siempre
apiladas. Sirve para evaluar el rediseño antes de aplicarlo al repo real.

⚠️ **Usa la misma base de Supabase que producción.** No cambié `SUPABASE_URL` ni
las tablas — si subís un Excel acá, se guarda en la misma base que usa el sitio
real (`agustin1115.github.io/cashflow-tesoreria`). Para solo mirar el diseño no
hay problema; para probar subidas, tené en cuenta que van a impactar en los datos
reales de ambas empresas.

## Qué cambió respecto al original

- **Topbar** fija arriba con el switch TF Carnes/Trade Food, en vez de un header
  separado + una fila de horizonte/estado aparte.
- **Grilla de KPIs** con números grandes (Teko) en vez de la tabla de tarjetas chica.
- **Financiera, Modo B y Cargar archivos** pasan a ser pestañas dentro de cada
  panel de empresa, en vez de secciones siempre visibles + una tira de uploads
  compartida arriba de todo.
- **Resumen de Posición** y **Detalle** siguen compartidos entre ambas empresas
  (no cambian con el switch), pero el Resumen se movió más arriba en la página.
- Una sola tipografía de números (Teko + DM Sans) y un único estilo de tabla
  reutilizado en Cash Flow / Financiera / Modo B / Detalle / Resumen.
- Los colores de marca (`--tfc-primary:#506E3E`, `--tf-primary:#630000`) son
  exactamente los mismos que el repo real — no se inventó ninguna paleta nueva.

## Estructura

- `index.html` — markup reorganizado
- `css/style.css` — estilos nuevos (mismos selectores que usa `app.js`, redefinidos)
- `js/app.js` / `js/app-patches.js` — **copias idénticas** del repo real, sin tocar

## Supabase

Mismo proyecto y tablas que `cashflow-tesoreria` — ver el README de ese repo para
el detalle completo (tablas, RLS, `anon` key).

## Deploy

GitHub Pages sirve `index.html` directo desde `main`.
