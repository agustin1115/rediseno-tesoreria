// ─────────────────────────────────────────────────────
// PATCHES — funcionalidades agregadas sobre app.js sin tocarlo
// (Cotización USD de Modo B + Resumen de Posición). Se cargan
// después de app.js y extienden renderModoB()/renderAll() por
// monkey-patch para que todo se mantenga sincronizado solo.
// ─────────────────────────────────────────────────────

// ── Cotización USD → ARS de Modo B, por empresa ─────────────────
const _mbCotiz = { tfc: null, tf: null };
(function loadCotiz(){
  try {
    const raw = localStorage.getItem('cf_mb_cotiz_v1');
    if (raw) Object.assign(_mbCotiz, JSON.parse(raw));
  } catch(e){}
})();
function saveCotiz(){ try{ localStorage.setItem('cf_mb_cotiz_v1', JSON.stringify(_mbCotiz)); }catch(e){} }

function setModoBCotizacion(co, value){
  const n = parseFloat(value);
  _mbCotiz[co] = (n > 0) ? n : null;
  saveCotiz();
  renderModoB(co);
  renderResumen();
}

// Precarga el input con la cotización guardada (los <input> ya existen en el DOM
// porque este script se carga al final del <body>, después del markup).
['tfc','tf'].forEach(co => {
  const el = document.getElementById(`mb-cotiz-${co}`);
  if (el && _mbCotiz[co]) el.value = _mbCotiz[co];
});

// ── Extiende renderModoB(): "Total equiv. pesos" (con USD convertidos si hay
// cotización cargada) y "Total compromisos" (= Vencido+Próx.7+Próx.15+Más15,
// mismos 4 buckets que ya calcula el renderModoB original, para que sume
// exactamente lo que se ve al lado) ────────────────────────────────────────
function renderModoBExtra(co){
  const mb = st[co].modoB;
  const cotiz = _mbCotiz[co];
  const dolaresEnPesos = (cotiz && mb.dolares) ? mb.dolares * cotiz : 0;
  const totalEquiv = (mb.pesos||0) + (mb.cheques||0) + dolaresEnPesos;

  const elTotal = document.getElementById(`mb-kpi-${co}-total`);
  if (elTotal) {
    elTotal.textContent = totalEquiv > 0 ? fN(totalEquiv) : '—';
    elTotal.className = 'mb-kpi-value' + (totalEquiv > 0 ? ' pos' : '');
  }
  const elSub = document.getElementById(`mb-kpi-${co}-total-sub`);
  if (elSub) {
    if (cotiz && mb.dolares) {
      elSub.textContent = `USD ${fN(mb.dolares)} × $${cotiz} = $${fN(dolaresEnPesos)}`;
    } else if (mb.dolares) {
      elSub.textContent = 'Ingresá la cotización para sumar los USD';
    } else {
      elSub.textContent = '';
    }
  }

  // Total compromisos: misma cuenta que los 4 buckets de al lado (Vencido/7/15/Más15).
  const today = new Date(); today.setHours(0,0,0,0);
  const prov = mb.provRaw || [];
  let vencido=0, d7=0, d15=0, d15plus=0;
  for (const r of prov) {
    const dias = r.fecha ? Math.round((r.fecha - today) / 86400000) : null;
    if (dias === null) continue;
    if (dias < 0) vencido += r.monto;
    else if (dias <= 7) d7 += r.monto;
    else if (dias <= 15) d15 += r.monto;
    else d15plus += r.monto;
  }
  const totalComp = vencido + d7 + d15 + d15plus;
  const elTV = document.getElementById(`mb-kpi-${co}-total-venc`);
  if (elTV) elTV.textContent = totalComp > 0 ? fN(totalComp) : '—';
}

const _origRenderModoB = renderModoB;
renderModoB = function(co){
  _origRenderModoB(co);
  renderModoBExtra(co);
};

// ── Cobrar / Incobrables: se leen en vivo de los mismos Google Sheets que usa
// TFcobranzas (ese proyecto no tiene base de datos propia — todo lo calcula al
// vuelo en el navegador a partir de la hoja). Acá se replica exactamente la
// misma lógica (processSheet/clasificarClientes/buildProyeccion, y las mismas
// listas de clientes excluidos/difícil-cobro) para poder usarla en el Resumen
// de Posición, con nombres "cob"-prefijados para no chocar con las funciones
// de este proyecto (que ya tiene su propio gvizDate/lectura de sheets, con
// otra forma). "Cobrar" y "Incobrables" = Archivo A + Archivo B de cada
// empresa, sumados.
const COB_SHEETS = {
  tfc: { id: '1gcXrr3djFrdTTvMWn_9XkjFGm_TqQDVo5hMS0ZPqeAI', tabs: ['Archivo A', 'Archivo B'] },
  tf:  { id: '1ws-DoN_nPtlqV8jeTjpl2uaosXHczBJYxia_KI-HRKI', tabs: ['A', 'B'] },
};

function cobLoadSheetJSONP(sheetId, sheetName){
  return new Promise((resolve, reject) => {
    const cb = '_cobgviz_' + sheetName.replace(/\W/g,'_') + '_' + Date.now();
    let done = false;
    const timeout = setTimeout(() => { if (!done){ done=true; cleanup(); reject(new Error('timeout')); } }, 20000);
    function cleanup(){ clearTimeout(timeout); delete window[cb]; if (s.parentNode) s.parentNode.removeChild(s); }
    window[cb] = function(data){
      if (done) return; done = true; cleanup();
      if (!data || data.status === 'error') { reject(new Error('sheet error')); return; }
      resolve(data);
    };
    const s = document.createElement('script');
    s.onerror = () => { if (!done){ done=true; cleanup(); reject(new Error('load error')); } };
    s.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;responseHandler:${cb}&sheet=${encodeURIComponent(sheetName)}&headers=1`;
    document.head.appendChild(s);
  });
}
function cobGvizToRows(data){
  const rawCols = (data.table.cols || []).map(c => (c.label || c.id || '').trim());
  const allEmpty = rawCols.every(c => !c);
  const rawRows  = data.table.rows || [];
  let cols, dataRows;
  if (allEmpty && rawRows.length > 0) {
    cols     = (rawRows[0].c || []).map(cell => (cell && cell.v ? String(cell.v).trim() : ''));
    dataRows = rawRows.slice(1);
  } else { cols = rawCols; dataRows = rawRows; }
  return dataRows.map(row => {
    const obj = {};
    (row.c || []).forEach((cell, i) => {
      const key = cols[i]; if (!key) return;
      obj[key]         = (cell && cell.v !== null && cell.v !== undefined) ? cell.v : '';
      obj[key + '__f'] = (cell && cell.f) ? cell.f : '';
    });
    return obj;
  });
}
function cobParseImporte(v){
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/,/g, '')) || 0;
}
function cobProcessSheet(rows, esExcluido){
  return rows.map(row => ({
    cliente: String(row['Razón social'] || '').trim(),
    importe: cobParseImporte(row['Importe'] !== '' ? row['Importe'] : row['Importe__f']),
  })).filter(r => r.cliente && !esExcluido(r.cliente));
}
function cobClasificar(datosA, datosB){
  const porCliente = {};
  function acc(datos, key){
    datos.forEach(d => {
      if (!porCliente[d.cliente]) porCliente[d.cliente] = { debeA:0, aplicarA:0, debeB:0, aplicarB:0 };
      const r = porCliente[d.cliente];
      if (d.importe > 0) { if (key==='A') r.debeA += d.importe; else r.debeB += d.importe; }
      else if (d.importe < 0) { if (key==='A') r.aplicarA += Math.abs(d.importe); else r.aplicarB += Math.abs(d.importe); }
    });
  }
  acc(datosA, 'A'); acc(datosB, 'B');
  return porCliente;
}
function cobTotales(datos, key, porCliente, esDificil){
  let dificilCobro = 0;
  datos.forEach(d => {
    const r = porCliente[d.cliente];
    const elegible = r && (r.debeA + r.debeB) > 0;
    if (!elegible) return;
    if (esDificil(d.cliente) && d.importe > 0) dificilCobro += d.importe;
  });
  let totalCobrar = 0;
  Object.entries(porCliente).forEach(([cliente, r]) => {
    if ((r.debeA + r.debeB) <= 0 || esDificil(cliente)) return;
    const debe = key === 'A' ? r.debeA : r.debeB;
    const aplicar = key === 'A' ? r.aplicarA : r.aplicarB;
    totalCobrar += debe - aplicar;
  });
  return { totalCobrar, dificilCobro };
}

// Listas de clientes, copiadas verbatim del repo TFcobranzas (js/app.js y
// js/tfcarnes.js) — Trade Food compara nombre exacto (sin uppercase, sin
// partial-match); TF Carnes compara en mayúsculas y también por coincidencia
// parcial (indexOf) para apellidos que vienen con variantes.
const COB_TF_EXCLUIDOS = new Set([
  "BUENOS AIRES VALORES S.A.","CASTRO TOMAS","FRANCISCO MIGUEL RAVETTI ESCUDERO",
  "GASTON EZEQUIEL IRIGOYEN","HAUSWAGEN - PILAR S A","HERNAN GONZALEZ",
  "JERONIMO DELGADO","MARIANO IVAN GIGENA","MULLER RENE SEBASTIAN",
  "NICOLAS ALEJANDRO VILLALBA","OSDE ORGANIZACION DE SERVICIOS DIRECTOS EMPRESARIOS",
  "PAOLO COLANTONIO","POTENCIAR SGR","PROVINCIA LEASING SA",
  "SANCOR COOPERATIVA DE SEGUROS LIMITADA","TRADE FOOD S.A","YPF SOCIEDAD ANONIMA",
  "ZURICH ASEGURADORA ARGENTINA S.A","CLARA MARIA SUGASTI","CONSTANZA CASTRO CRANWELL",
  "CONSTANZA MARIA CASTRO CRANWELL","FRANCISCO JOSÉ CANEPA","FRANCISCO RAVETTI ESCUDERO",
  "GIULIANO ALFREDO RAPETTI DOMINGUEZ","IGNACIO CAZENAVE","JUAN BAUTISTA ARRICAU",
  "JUAN PEDRO IRIGARAY","MARIANO GIGENA","Martin Rohner","Nicolas binaghi",
  "RAINIER JAVIER DIAZ","YBARES SONIA LORENA","VARIOS CANGALLO","FIORELLA MOUTTET",
  "ENZO GUSTAVO ALGAÑARAZ NASTA","FLETES","NERA S.A.U.","CARLOS RAMON CASTRO ACHAVAL",
  "HECTOR SALVADOR CAÑETE","CARLOS RAMON CASTRO ACHAVAL - RETIROS",
  "FRANCISCO CIRO CASTRO SUGASTI","Francisco Ciro Castro Sugasti - Retiros",
  "TOMAS CARLOS CASTRO - RETIROS","TELEFONICA MOVILES ARGENTINA SOCIEDAD ANONIMA",
  "MERITI SRL","SINDICATO EMPLEADOS DE COMERCIO CAPITAL FEDERAL","CAFFARO TOMAS JOSE",
  "MENDEZ MATIAS","LEONARDO JESUS THEILER","ARAMBURU RAMIRO","FRANCISCO MANUEL DELGADO",
  "JUAN PABLO DIAZ (MOTO)"
]);
const COB_TF_DIFICIL = new Set([
  "MONICA EVANGELINA CAMPORA","MOSAINER CARLOS ARTURO","CARNES VIREYES S.A",
  "HECTOR EDUARDO DE LA FUENTE","CIA CARDINAL ALIMENTARIA S.A.","LEONARDO DANIEL ORZAN",
  "FRIGORIFICO UNION SA.","ECOCARNES S.A.","MATADERO Y FRIGORÍFICO FEDERAL S.A.",
  "SEMOTRA EMPRENDIMIENTOS SRL",
  "LOS CHARANGUITOS SOCIEDAD SIMPLE DE LEANDRO FABIAN CIAN Y DANIELA TERESA CIAN S. CAP I SECC IV",
  "CARNES EL DIAMANTE S.R.L."
]);
const cobTfEsExcluido = n => COB_TF_EXCLUIDOS.has(n);
const cobTfEsDificil  = n => COB_TF_DIFICIL.has(n);

const COB_TFC_EXCLUDED = new Set([
  'AGENCIA DE RECAUDACION Y CONTROL ADUANERO','BUENOS AIRES VALORES S.A.',
  'CAMPOS Y GANADOS S A REMATES COMISIONES Y CONSIGNACIONES','CARLOS TOMAS CASTRO SUGASTI',
  'CASTRO TOMAS','CONSUMIDOR FINAL','DHF S.A','DISTRIBUIDORA NAS S.R.L. - FLETES',
  'ENTIVOX SA','FLETES','FRANCISCO CIRO CASTRO SUGASTI','FRANCISCO NAHUEL ADIMARO',
  'INDUSTRIA CUENTA 2','JAVIER ALEJANDRO MEDINA','MERCADO AGROGANADERO SA',
  'MUNICIPALIDAD DE SAN ISIDRO','NICOLAS PULLEIRO',
  'OSDE ORGANIZACION DE SERVICIOS DIRECTOS EMPRESARIOS','POTENCIAR SGR',
  'PROVINCIA LEASING SA','SOLUCIONES EN ETIQUETAS S.A.','SWISS MEDICAL S A',
  'TELEFONICA MOVILES ARGENTINA SOCIEDAD ANONIMA','TF CARNES S.A.','TRADE FOOD S.A',
  'TRANSCONT S R L','YPF SOCIEDAD ANONIMA','1CLARA S','ADRIAN CALI','AGUSTIN CAJAS',
  'AGUSTINA PULLEIRO','ALEJANDRO MARTINEZ','ALEJANDRO OSVALDO PULLEIRO','ANA FRACICA',
  'CLAUDIO CASTAÑEDA (TF PLANTA)','COMISIONES PEDIDOS YA','DAMIAN MOTOQUERO',
  'DAMIAN SOBRINO DE PIRI','DISTRIBUIDORA NAS - COMISIONES','DISTRIBUIDORA NAS - FLETES',
  'ELIAN TF','ENDERLIS ROMERO','ENZO ALGAÑARAZ','FEDE FRIGO','FERNANDO MARICHALAR',
  'FIORELLA MOUTTET (TRADE FOOD)','FLOR GARCIA','FRANCISCO CANEPA','FRANCISCO CAPOZZI',
  'FRANCISCO RAVETTI TRADE FOOD','FRANCO ADIMARO (FRIGO)','GASTON IRIGOYEN',
  'GESTIONES ADUANERAS Y SANITARIAS','GINTER','HERNAN GONZALEZ (TRADE FOOD)RRHH',
  'INDUSTRIA CARNICA DEL OESTE SRL','JUAN PABLO DIAZ (MOTO)','JUAN SOLIS',
  'KAREN SENASSA (FRIGO)','KUKO','LEA DE CARLO (PAJARITO)','MARIA SOFIA AMESTOY',
  'MARIANO GIGENA (TRADE FOOD)','MARTIN BILBAO','MARTIN ROHNER (TRADE FOOD)',
  'MARTIN RUOCCO','MILAM HUBER','NACHO CAZENAVE TRADEFOOD','NICOLAS BINAGUI',
  'PANCHO ADIMARO','RAMIRO FREUE','RAMIRO MIGUEL PARODI','SANTIAGO CHUBURU',
  'SONIA YBARES TRADE FOOD','TFC LA CARNICERIA','VARIOS CANGALLO',
  'TARDITI DIEGO ALBERTO','GASTON EZEQUIEL IRIGOYEN','HERNAN GONZALEZ','MARTIN ROHNER',
  'IGNACIO CAZENAVE','MARIANO GIGENA','MARIANO IVAN GIGENA','FIORELLA MOUTTET',
  'FRANCISCO JOSE CANEPA','FRANCISCO JOSÉ CANEPA','FRANCISCO RAVETTI ESCUDERO',
  'FRANCISCO MIGUEL RAVETTI ESCUDERO','YBARES SONIA LORENA','ENZO GUSTAVO ALGAÑARAZ NASTA',
  'UNO SUPERMERCADOS SA','TITO PEREZ E HIJO S.A.','DIEGO ALBERTO TARDITI','TITO PEREZ',
  'SERVICIOS CARNICOS DEL SUR','TARDITI','DELTACAR S A','CASNEM S.A.S.',
  'GUIDO JORGE MUÑOZ','ROBOL LUIS MARIA','LUCIANO RINALDI (LUCHO)','SODECAR SA',
  'SOCIEDAD ANONIMA CARNES PAMPEANAS SA','CARNES PAMPEANAS SA',
  'FRIGORIFICO ALBERDI SOCIEDAD ANONIMA','GANADERA GRANADA S.A.',
  'ETCHEVEHERE RURAL S. R. L.','HACIENDAS DEL NORTE','GLOBALWING','VILLAMAGNA HNOS SRL',
  'SENASA (FRIGO)','LUCANI S.R.L.','ORELLA S.R.L.','5L SA',
  'COMERCIALIZADORA DE CARNES ROMERO VACA S.A.','LA MERIDIONAL CIA ARG DE SEGUROS S A',
  'MARCELO RAUL LAURO','NETLATIN S.R.L.','P & Z S.A.','SUMATIK SRL','MARIANO BLUMENFELD'
].map(s => s.trim().toUpperCase()));
const COB_TFC_PARCIALES_EXCL = ['TARDITI','DELTACAR','CASNEM','GUIDO JORGE MU','ROBOL','RINALDI',
  'SODECAR','PAMPEANAS','ALBERDI','GANADERA GRANADA','ETCHEVEHERE','HACIENDAS DEL NORTE',
  'GLOBALWING','VILLAMAGNA','SENASA','LUCANI','ORELLA','ROMERO VACA','LA MERIDIONAL',
  'MARCELO RAUL LAURO','NETLATIN','SUMATIK','BLUMENFELD'];
function cobTfcEsExcluido(name){
  if (!name || name === 'NaN') return true;
  const n = name.trim().toUpperCase();
  if (COB_TFC_EXCLUDED.has(n)) return true;
  return COB_TFC_PARCIALES_EXCL.some(p => n.indexOf(p) > -1);
}
const COB_TFC_RESOLVER = new Set([
  'HENAN HENG YE TRADE CO., LTD ADD','FRESH EXPRESS KUWAIT','GONZALO BADANO',
  'PATAGONIA VIANDAS Y CATERING S.R.L.','SUPERMERCADOS MAYORISTAS YAGUAR SOCIEDAD ANONIMA',
  'SUPERMERCADOS MAYORISTAS YAGUAR SOCIEDA','VITAFIL S.A.','CARDINAL ALIMENTARIA',
  'CIA CARDINAL ALIMENTARIA S.A.','CIA CARDINAL ALIMENTARIA SA','CARDINAL ALIMENTARIA S.A.',
  'ROJAS VERA ALEX NAHUEL','VENTA ZONA NORTE','JOCKEY','OFICINA TF'
].map(s => s.trim().toUpperCase()));
const COB_TFC_PARCIALES_RES = ['HENAN HENG','FRESH EXPRESS','BADANO','PATAGONIA VIANDAS','YAGUAR',
  'VITAFIL','CARDINAL','ROJAS VERA','VENTA ZONA NORTE','JOCKEY','OFICINA TF'];
function cobTfcEsAResolver(cliente){
  if (!cliente) return false;
  const n = cliente.trim().toUpperCase();
  if (COB_TFC_RESOLVER.has(n)) return true;
  return COB_TFC_PARCIALES_RES.some(p => n.indexOf(p) > -1);
}

// Cache en memoria (se recalcula al cargar la página y cada 10 min; no hace
// falta más frecuencia, esto se lee de un Sheet que no cambia todo el tiempo).
const _cobCache = { tfc: null, tf: null };
async function cobFetchCompany(co){
  const cfg = COB_SHEETS[co];
  const esExcluido = co === 'tfc' ? cobTfcEsExcluido : cobTfEsExcluido;
  const esDificil  = co === 'tfc' ? cobTfcEsAResolver : cobTfEsDificil;
  const [gA, gB] = await Promise.all(cfg.tabs.map(t => cobLoadSheetJSONP(cfg.id, t)));
  const datosA = cobProcessSheet(cobGvizToRows(gA), esExcluido);
  const datosB = cobProcessSheet(cobGvizToRows(gB), esExcluido);
  const porCliente = cobClasificar(datosA, datosB);
  const rA = cobTotales(datosA, 'A', porCliente, esDificil);
  const rB = cobTotales(datosB, 'B', porCliente, esDificil);
  // Cobrar SÍ se suma (es "lo que falta cobrar en total"), pero Incobrables se
  // deja por archivo — TFcobranzas muestra "A resolver (excluido)" de Archivo A
  // y de Archivo B como dos números separados, nunca sumados, así que el
  // Resumen de Posición respeta esa misma separación en vez de mezclarlos.
  return { totalCobrar: rA.totalCobrar + rB.totalCobrar, dificilCobroA: rA.dificilCobro, dificilCobroB: rB.dificilCobro };
}
async function cobRefresh(){
  try {
    const [tfc, tf] = await Promise.all([cobFetchCompany('tfc'), cobFetchCompany('tf')]);
    _cobCache.tfc = tfc; _cobCache.tf = tf;
  } catch(e) {
    console.warn('No se pudo leer Cobrar/Incobrables de TFcobranzas:', e);
  }
  renderResumen();
}
cobRefresh();
setInterval(cobRefresh, 10 * 60 * 1000);

// ── Resumen de Posición: Modo A / Modo B, TF Carnes vs. Trade Food ─────────
// Modo A = posición "banco": saldo bancario ajustado por cheques emitidos,
// cuentas a pagar y cartera de cheques propia, más lo que falta cobrar (menos
// lo incobrable). Modo B = posición "caja": lo que ya está disponible en Modo
// B (pesos + cheques + USD convertidos) en vez del saldo bancario, ajustado
// por cuentas a pagar, cobrar/incobrables y lo movido a Financiera.
let _resumenModo = 'a';
function switchResumenModo(modo){
  _resumenModo = modo;
  document.getElementById('rsmtab-a').classList.toggle('active', modo === 'a');
  document.getElementById('rsmtab-b').classList.toggle('active', modo === 'b');
  renderResumen();
}

function renderResumen(){
  const tableEl = document.getElementById('resumen-table');
  if (!tableEl) return;

  const fmt = v => (v == null) ? '—' : fN(v);
  const cls = v => (v == null) ? '' : (v >= 0 ? 'rs-pos' : 'rs-neg');
  const row = (label, vTfc, vTf) => `<tr>
    <td class="rs-label">${label}</td>
    <td class="rs-val tfc-col ${cls(vTfc)}">${fmt(vTfc)}</td>
    <td class="rs-val tf-col ${cls(vTf)}">${fmt(vTf)}</td>
  </tr>`;
  const secHeader = title => `<tr class="rs-sec-header"><td colspan="3" class="rs-sec-title">${title}</td></tr>`;

  // Bancos: TF Carnes usa solo los bancos operativos (Galicia/Macro/CMF), igual
  // que la tarjeta "Saldo bancos" de su panel (tfcOpBancos()).
  const opTfc = tfcOpBancos();
  const bancosTfc = opTfc.saldo;
  const bancosTf  = st.tf.saldoBancos;

  const carteraTfc = st.tfc.cartera || 0;
  const carteraTf  = st.tf.cartera  || 0;

  const emitidosTfc = (st.tfc.chequesEmitidos||[]).reduce((s,c)=>s+c.importe,0);
  const emitidosTf  = (st.tf.chequesEmitidos ||[]).reduce((s,c)=>s+c.importe,0);

  const cpagarTfc = getProv('tfc').reduce((s,r)=>s+r.monto,0);
  const cpagarTf  = getProv('tf').reduce((s,r)=>s+r.monto,0);

  const cotizTfc = _mbCotiz.tfc, cotizTf = _mbCotiz.tf;
  const mbTotalTfc = (st.tfc.modoB.pesos||0) + (st.tfc.modoB.cheques||0) + (cotizTfc ? (st.tfc.modoB.dolares||0)*cotizTfc : 0);
  const mbTotalTf  = (st.tf.modoB.pesos ||0) + (st.tf.modoB.cheques ||0) + (cotizTf  ? (st.tf.modoB.dolares ||0)*cotizTf  : 0);

  // Cobrar / Incobrables: de TFcobranzas. "—" mientras se está leyendo el
  // Sheet la primera vez. Cobrar es la suma de Archivo A + Archivo B (es "lo
  // que falta cobrar en total"); Incobrables se muestra por archivo, igual
  // que TFcobranzas lo hace en su propia pantalla (dos números separados,
  // "A resolver (excluido)" de Archivo A y de Archivo B) — el total de Modo
  // A/B sigue restando la suma de los dos, solo cambia cómo se ve.
  const cobTfc = _cobCache.tfc, cobTf = _cobCache.tf;
  const cobrarTfc = cobTfc ? cobTfc.totalCobrar : null;
  const cobrarTf  = cobTf  ? cobTf.totalCobrar  : null;
  const incobrATfc = cobTfc ? cobTfc.dificilCobroA : null;
  const incobrBTfc = cobTfc ? cobTfc.dificilCobroB : null;
  const incobrATf  = cobTf  ? cobTf.dificilCobroA  : null;
  const incobrBTf  = cobTf  ? cobTf.dificilCobroB  : null;

  // Movidas (Modo B): lo que ya se giró a Financiera, = "Efectivo a entregar"
  // de Compromisos de Efectivo (mismo cálculo que arma finkpi-efec en
  // renderFinanciera(): compromisos activos, sin contar los ya marcados como
  // pagados — _finPagados/compromisos son variables de app.js, visibles acá
  // porque los <script> clásicos comparten el mismo scope de nivel superior).
  // Solo existe para TFC; Trade Food no tiene panel de Financiera → "—".
  const activosTfc = (st.tfc.compromisos || []).filter(c => !_finPagados.has(c.id));
  const movidasTfc = activosTfc.reduce((s,c) => s + c.importeEfectivo, 0);

  let bodyHtml, footHtml;

  if (_resumenModo === 'a') {
    // Incobrables en Modo A = solo Archivo A de TFcobranzas (no se suma con B).
    const totalATfc = (bancosTfc||0) - emitidosTfc - cpagarTfc + carteraTfc + (cobrarTfc||0) - (incobrATfc||0);
    const totalATf  = (bancosTf ||0) - emitidosTf  - cpagarTf  + carteraTf  + (cobrarTf ||0) - (incobrATf ||0);
    bodyHtml = `
      ${row('Bancos', bancosTfc, bancosTf)}
      ${row('Cheques emitidos', emitidosTfc ? -emitidosTfc : null, emitidosTf ? -emitidosTf : null)}
      ${row('Cuentas a pagar', cpagarTfc ? -cpagarTfc : null, cpagarTf ? -cpagarTf : null)}
      ${row('Cheques en cartera', carteraTfc || null, carteraTf || null)}
      ${row('Cobrar', cobrarTfc, cobrarTf)}
      ${row('Incobrables', incobrATfc ? -incobrATfc : (incobrATfc===0?0:null), incobrATf ? -incobrATf : (incobrATf===0?0:null))}
      <tr class="rs-total-row">
        <td class="rs-label rs-total">Posición Modo A</td>
        <td class="rs-val rs-total tfc-col ${cls(totalATfc)}">${fmt(totalATfc)}</td>
        <td class="rs-val rs-total tf-col ${cls(totalATf)}">${fmt(totalATf)}</td>
      </tr>`;
    footHtml = `Modo A = Bancos − Cheques emitidos − Cuentas a pagar + Cheques en cartera + Cobrar − Incobrables.
      Cobrar suma Archivo A + Archivo B de TFcobranzas; Incobrables acá es solo Archivo A (el de Archivo B se usa en Modo B).`;
  } else {
    // Modo B: la "posición" parte de lo disponible en Modo B (caja), no del
    // saldo bancario — el resto de los ajustes es el mismo criterio que Modo A.
    // Incobrables en Modo B = solo Archivo B de TFcobranzas.
    // NOTA: esta fórmula de Modo B es una inferencia mía a partir del ejemplo
    // que pasaste (no la confirmé contra un número de referencia como sí hice
    // con Modo A) — avisame si el total no coincide con lo que esperás.
    const totalBTfc = (mbTotalTfc||0) - cpagarTfc + (cobrarTfc||0) - movidasTfc - (incobrBTfc||0);
    const totalBTf  = (mbTotalTf ||0) - cpagarTf  + (cobrarTf ||0) - (incobrBTf ||0);
    bodyHtml = `
      ${row('Disponible (Modo B)', mbTotalTfc || null, mbTotalTf || null)}
      ${row('Cuentas a pagar', cpagarTfc ? -cpagarTfc : null, cpagarTf ? -cpagarTf : null)}
      ${row('Cobrar', cobrarTfc, cobrarTf)}
      ${row('Movidas (a Financiera)', movidasTfc ? -movidasTfc : null, null)}
      ${row('Incobrables', incobrBTfc ? -incobrBTfc : (incobrBTfc===0?0:null), incobrBTf ? -incobrBTf : (incobrBTf===0?0:null))}
      <tr class="rs-total-row">
        <td class="rs-label rs-total">Posición Modo B</td>
        <td class="rs-val rs-total tfc-col ${cls(totalBTfc)}">${fmt(totalBTfc)}</td>
        <td class="rs-val rs-total tf-col ${cls(totalBTf)}">${fmt(totalBTf)}</td>
      </tr>`;
    footHtml = `Modo B = Disponible (Modo B) − Cuentas a pagar + Cobrar − Movidas (a Financiera) − Incobrables.
      "Movidas" = Efectivo a entregar de Compromisos de Efectivo (solo TF Carnes). Incobrables acá es solo Archivo B de TFcobranzas (el de Archivo A se usa en Modo A). Fórmula de Modo B sin confirmar contra un número de referencia — revisala.`;
  }

  tableEl.innerHTML = `
    <thead><tr>
      <th class="rs-th-label"></th>
      <th class="rs-th-co tfc-col">TF Carnes</th>
      <th class="rs-th-co tf-col">Trade Food</th>
    </tr></thead>
    <tbody>${bodyHtml}</tbody>
    <tfoot>
      <tr><td colspan="3" style="font-size:10px;color:#999;padding:8px 14px">${footHtml}</td></tr>
    </tfoot>`;
}

// renderAll() es la función que ya llama app.js después de cualquier cambio
// (subida de archivo, exclusión, refresh, etc.) — enganchamos el resumen ahí
// para que se mantenga al día sin tener que tocar cada lugar que la llama.
const _origRenderAll = renderAll;
renderAll = function(){
  _origRenderAll();
  renderResumen();
};

// ── Resumen de Posición al lado del Cash Flow de la empresa activa ─────────
// #resumen-section es una sola instancia (un solo resumen-table, un solo
// switchResumenModo) que se muda de contenedor según la empresa activa, en
// vez de duplicarse — así no hay dos tablas ni ids repetidos. rs-slot-tfc/
// rs-slot-tf son los dos posibles destinos (uno al lado de cada Cash Flow).
function cobPlaceResumen(co){
  const section = document.getElementById('resumen-section');
  const slot = document.getElementById(co === 'tf' ? 'rs-slot-tf' : 'rs-slot-tfc');
  if (section && slot && section.parentElement !== slot) slot.appendChild(section);
}
cobPlaceResumen(typeof _coTab !== 'undefined' ? _coTab : 'tfc');

const _origSwitchCoTab = switchCoTab;
switchCoTab = function(co){
  _origSwitchCoTab(co);
  cobPlaceResumen(co);
};
