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

// ── BAVSA (Trade Food): 4 montos de carga manual (Títulos, Cheques en
// custodia, Cupo Caución, Caución tomada) — no vienen de ningún Sheet ni
// Excel, es información que no se puede leer de ningún lado automático,
// así que se cargan a mano y quedan guardados en este navegador. La suma
// de los 4 (getBavsaSaldoTf(), más abajo) se muestra en la tarjeta KPI
// "Saldo BAVSA" de Trade Food y, a pedido tuyo, suma a la Posición Modo A
// de Trade Food (mismo criterio que BAVSA ya usaba en TF Carnes).
const _bavsaTf = { titulos: null, custodia: null, cupo: null, caucion: null };
(function loadBavsaTf(){
  try {
    const raw = localStorage.getItem('cf_bavsa_tf_v1');
    if (raw) Object.assign(_bavsaTf, JSON.parse(raw));
  } catch(e){}
})();
function saveBavsaTf(){ try{ localStorage.setItem('cf_bavsa_tf_v1', JSON.stringify(_bavsaTf)); }catch(e){} }

// Saldo BAVSA (Trade Food) = suma de los 4 montos manuales. null solo si
// no se cargó ninguno todavía (para mostrar "—" en vez de "0").
function getBavsaSaldoTf(){
  const { titulos, custodia, cupo, caucion } = _bavsaTf;
  if (titulos == null && custodia == null && cupo == null && caucion == null) return null;
  return (titulos||0) + (custodia||0) + (cupo||0) + (caucion||0);
}
// Actualiza solo la tarjeta KPI "Saldo BAVSA" de Trade Food (Cash Flow
// Proyectado) — separada de renderResumen() a propósito: esta se llama
// también en la precarga inicial del script, ANTES de que _cobCache (más
// abajo en este archivo) esté inicializado, y renderResumen() lo necesita.
function renderBavsaTfKpi(){
  const el = document.getElementById('kpi-tf-bavsa');
  if (el) {
    const v = getBavsaSaldoTf();
    el.textContent = (v != null) ? fN(v) : '—';
  }
}
function setBavsaTf(campo, value){
  const n = parseFloat(value);
  _bavsaTf[campo] = Number.isFinite(n) ? n : null;
  saveBavsaTf();
  renderBavsaTfKpi();
  // Acá sí es seguro llamar a renderResumen() (que también muestra el
  // Saldo BAVSA, en la fila BAVSA/columna Trade Food): esto solo corre
  // cuando el usuario toca un input, mucho después de que el script
  // terminó de cargar por completo.
  renderResumen();
}
// Precarga los inputs con lo guardado (mismo criterio que la cotización de arriba).
Object.entries({ titulos: 'bavsa-tf-titulos', custodia: 'bavsa-tf-custodia', cupo: 'bavsa-tf-cupo', caucion: 'bavsa-tf-caucion' }).forEach(([campo, id]) => {
  const el = document.getElementById(id);
  if (el && _bavsaTf[campo] != null) el.value = _bavsaTf[campo];
});
renderBavsaTfKpi();

// ── Cheques cargados a mano en "Cartera de Cheques" ─────────────────
// A veces hay un cheque real en cartera que no viene ni del Excel del banco
// ni del Sheet de físicos (llegó por otro medio, se traspapeló el archivo,
// etc.) — el botón "+ Agregar cheque" de la pestaña Cartera de Cheques deja
// cargarlo a mano, con las mismas columnas que ya tiene la tabla. Igual que
// BAVSA (Trade Food), vive solo en este navegador — se guarda aparte en
// localStorage (no en `${co}_cheques_v2`) para que no se pierda cuando se
// vuelve a subir el Excel del banco (ese array se reemplaza entero en cada
// subida).
let _manualChqs = [];
let _manualChqId = 0;
(function loadManualChqs(){
  try {
    const raw = localStorage.getItem('cf_cheques_manual_v1');
    if (raw) {
      _manualChqs = JSON.parse(raw);
      _manualChqId = _manualChqs.reduce((max, m) => Math.max(max, m.id || 0), 0);
    }
  } catch(e){}
})();
function saveManualChqs(){ try{ localStorage.setItem('cf_cheques_manual_v1', JSON.stringify(_manualChqs)); }catch(e){} }

function openAddChqPanel(){
  document.getElementById('ov-title').textContent = '+ Agregar cheque a cartera';
  renderAddChqPanelBody();
  document.getElementById('ov-overlay').classList.add('open');
  document.getElementById('ov-panel').classList.add('open');
}
function renderAddChqPanelBody(){
  const coSel = document.getElementById('df-empresa');
  const co = (coSel && coSel.value) || 'tfc';
  let html = `<div class="man-section" style="flex:1;border-top:none">
    <div class="man-sec-hdr">Cargar cheque a mano</div>
    <div class="man-form man-form-chq">
      <select id="chq-man-co">
        <option value="tfc" ${co==='tfc'?'selected':''}>TF Carnes</option>
        <option value="tf" ${co==='tf'?'selected':''}>Trade Food</option>
      </select>
      <input type="text" id="chq-man-numero" placeholder="N° Cheque">
      <input type="text" id="chq-man-recibido" placeholder="Recibido de">
      <input type="text" id="chq-man-librador" placeholder="Librador">
      <input type="text" id="chq-man-cuit" placeholder="CUIT">
      <input type="date" id="chq-man-fecha">
      <input type="number" id="chq-man-importe" placeholder="Importe" step="1" min="0">
      <button class="btn-add-man" onclick="addManualChq()">+ Agregar</button>
    </div>
    <p class="ov-note">Se guarda en este navegador y aparece en la tabla de Cartera de Cheques junto con el resto — se puede adjudicar/restaurar igual que un cheque subido por Excel.</p>`;

  const mine = [..._manualChqs].sort((a,b) => (a.fecha||'').localeCompare(b.fecha||''));
  if (mine.length) {
    html += `<div style="margin-top:12px;border:1px solid #eee;border-radius:6px;overflow:hidden">`;
    for (const m of mine) {
      const fechaStr = m.fecha ? fDateShort(new Date(m.fecha+'T00:00:00')) : '—';
      html += `<div class="man-list-item">
        <span class="man-d">${coBadge(m.co)}</span>
        <span class="man-d">${fechaStr}</span>
        <span class="man-l" title="${m.librador||''} · #${m.numero||''}">${m.librador||m.recibidoDe||'—'} · #${m.numero||'—'}</span>
        <span class="man-a">${fN(m.importe)}</span>
        <button class="btn-rm-man" onclick="deleteManualChq(${m.id})" title="Eliminar">×</button>
      </div>`;
    }
    html += `</div>`;
  } else {
    html += `<div style="margin-top:16px;text-align:center;color:#ccc;font-size:11px;padding:20px">Sin cheques cargados a mano todavía.</div>`;
  }
  html += `</div>`;
  document.getElementById('ov-body').innerHTML = html;
}
function addManualChq(){
  const co = document.getElementById('chq-man-co').value;
  const numero = document.getElementById('chq-man-numero').value.trim();
  const recibidoDe = document.getElementById('chq-man-recibido').value.trim();
  const librador = document.getElementById('chq-man-librador').value.trim();
  const cuit = document.getElementById('chq-man-cuit').value.trim();
  const fecha = document.getElementById('chq-man-fecha').value;
  const importe = parseFloat(document.getElementById('chq-man-importe').value);
  if (!fecha || isNaN(importe) || importe <= 0) { alert('Completá al menos la fecha de cobro y el importe.'); return; }
  _manualChqs.push({ id: ++_manualChqId, co, numero, recibidoDe, librador, cuit, fecha, importe });
  saveManualChqs();
  ['chq-man-numero','chq-man-recibido','chq-man-librador','chq-man-cuit','chq-man-fecha','chq-man-importe'].forEach(id => {
    document.getElementById(id).value = '';
  });
  renderAddChqPanelBody();
  renderAll();
}
function deleteManualChq(id){
  _manualChqs = _manualChqs.filter(m => m.id !== id);
  saveManualChqs();
  renderAddChqPanelBody();
  renderAll();
}

// "Total compromisos" de Modo B: Vencido+Próx.7+Próx.15+Más15 de los
// compromisos subidos en "Subir compromisos" de Modo B (st[co].modoB.provRaw)
// — un archivo distinto de "Cuentas a pagar" (st[co].provRaw). Se usa tanto
// en la franja de Modo B (mb-kpi-*-total-venc) como en la fila "Cuentas a
// pagar" del Resumen de Posición cuando está en Modo B (ver renderResumen).
function getModoBTotalCompromisos(co){
  const today = new Date(); today.setHours(0,0,0,0);
  const prov = st[co].modoB.provRaw || [];
  let vencido=0, d7=0, d15=0, d15plus=0;
  for (const r of prov) {
    const dias = r.fecha ? Math.round((r.fecha - today) / 86400000) : null;
    if (dias === null) continue;
    if (dias < 0) vencido += r.monto;
    else if (dias <= 7) d7 += r.monto;
    else if (dias <= 15) d15 += r.monto;
    else d15plus += r.monto;
  }
  return vencido + d7 + d15 + d15plus;
}

// ── Extiende renderModoB(): "Total equiv. pesos" (con USD convertidos si hay
// cotización cargada) y "Total compromisos" (= Vencido+Próx.7+Próx.15+Más15,
// mismos 4 buckets que ya calcula el renderModoB original, para que sume
// exactamente lo que se ve al lado) ────────────────────────────────────────
function renderModoBExtra(co){
  const mb = st[co].modoB;
  const cotiz = _mbCotiz[co];
  const dolaresEnPesos = (cotiz && mb.dolares) ? mb.dolares * cotiz : 0;
  // Saldo Financiera entra acá a pedido tuyo — para Trade Food mb.saldoFinanciera
  // no existe (queda undefined), así que no suma nada ahí.
  const totalEquiv = (mb.pesos||0) + (mb.cheques||0) + dolaresEnPesos + (mb.saldoFinanciera||0);

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

  const totalComp = getModoBTotalCompromisos(co);
  const elTV = document.getElementById(`mb-kpi-${co}-total-venc`);
  if (elTV) elTV.textContent = totalComp > 0 ? fN(totalComp) : '—';

  // Saldo Financiera (solo TF Carnes): celda B6 del Sheet "resumen" — la
  // trae loadModoB() parcheado más abajo, acá solo se muestra.
  if (co === 'tfc') {
    const elFin = document.getElementById('mb-kpi-tfc-financiera');
    if (elFin) {
      const v = mb.saldoFinanciera;
      elFin.textContent = (v != null) ? fN(v) : '—';
      elFin.className = 'mb-kpi-value' + (v == null ? '' : v >= 0 ? ' pos' : ' neg');
    }
  }
}

const _origRenderModoB = renderModoB;
renderModoB = function(co){
  _origRenderModoB(co);
  renderModoBExtra(co);
};

// ── Saldo Financiera (solo TF Carnes): una fila más del mismo Sheet
// "resumen" que ya lee loadModoB() para Pesos/Dólares/Cheques — a
// diferencia de esas, esta fila no lleva el nombre de la empresa adelante
// ("Saldo Financiera", no "TF Carnes Saldo Financiera"), así que no la
// agarra el matcheo por MODOB_CO_LABELS del original. Se busca por label
// en vez de por número de fila fijo (la fila en el Sheet real es la 6,
// pero matchear por texto es más robusto si el día de mañana se agrega o
// reordena una fila arriba). Lectura aparte de la misma hoja, mismo
// criterio que ya usa esta página para otros datos que no vienen de
// app.js, en vez de tocar loadModoB().
const _origLoadModoB = loadModoB;
loadModoB = async function(co){
  await _origLoadModoB(co);
  if (co !== 'tfc') return;
  try {
    const data = await loadSheetRaw(MODOB_SHEET_IDS.tfc, MODOB_TAB);
    const rows = data.table?.rows || [];
    const fila = rows.find(r => /financiera/i.test(String(r.c?.[0]?.v ?? r.c?.[0]?.f ?? '')));
    const val = fila?.c?.[1]?.v;
    st.tfc.modoB.saldoFinanciera = (typeof val === 'number') ? val : null;
  } catch (e) {
    console.warn('[Saldo Financiera]', e.message);
    st.tfc.modoB.saldoFinanciera = null;
  }
  renderModoB('tfc');
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
// restarAplicar: TF Carnes SÍ resta "a aplicar" (notas de crédito) de Total
// a cobrar (tfcarnes.js); Trade Food NO la resta desde el cambio que
// pediste en TFcobranzas (app.js: "Total a cobrar = solo debe, sin restar
// a aplicar") — cobTotales() tiene que replicar esa diferencia por empresa,
// si no el Cobrar de Trade Food queda descontado de más acá.
function cobTotales(datos, key, porCliente, esDificil, restarAplicar){
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
    totalCobrar += restarAplicar ? (debe - aplicar) : debe;
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
  'MARCELO RAUL LAURO','NETLATIN S.R.L.','P & Z S.A.','SUMATIK SRL','MARIANO BLUMENFELD',
  // Agregados después (copiados de tfcarnes.js) — no se toman en cuenta en ningún lado.
  'CARNES VIREYES S.A','AUTOSERVICIO MAYORISTA DIARCO SA','FRIMARC - INDUSTIRA E COMERCIO, SA',
  'OPEN ROUTE SAS','SUDAMBEEF TRADING S.A.','TIMBRO TRADING (AC COMERCIAL IMP E EXP LTDA)'
].map(s => s.trim().toUpperCase()));
const COB_TFC_PARCIALES_EXCL = ['TARDITI','DELTACAR','CASNEM','GUIDO JORGE MU','ROBOL','RINALDI',
  'SODECAR','PAMPEANAS','ALBERDI','GANADERA GRANADA','ETCHEVEHERE','HACIENDAS DEL NORTE',
  'GLOBALWING','VILLAMAGNA','SENASA','LUCANI','ORELLA','ROMERO VACA','LA MERIDIONAL',
  'MARCELO RAUL LAURO','NETLATIN','SUMATIK','BLUMENFELD',
  // Red de contención para los 6 agregados arriba (variantes de tipeo/espaciado).
  'VIREYES','DIARCO','FRIMARC','OPEN ROUTE','SUDAMBEEF','TIMBRO TRADING','AC COMERCIAL'];
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
  const restarAplicar = co === 'tfc'; // ver comentario en cobTotales()
  const rA = cobTotales(datosA, 'A', porCliente, esDificil, restarAplicar);
  const rB = cobTotales(datosB, 'B', porCliente, esDificil, restarAplicar);
  // totalCobrarA (Modo A) y totalCobrarB (Modo B) nunca se suman entre sí —
  // a pedido tuyo, mismo criterio que ya se aplicaba a Incobrables
  // (dificilCobroA/dificilCobroB).
  return {
    totalCobrarA: rA.totalCobrar,
    totalCobrarB: rB.totalCobrar,
    dificilCobroA: rA.dificilCobro,
    dificilCobroB: rB.dificilCobro,
  };
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
// Última foto de los números del Resumen (los dos modos, las dos empresas),
// la recalcula renderResumen() cada vez que corre — la usa cerrarSemana().
let _resumenSnapshot = null;
function switchResumenModo(modo){
  _resumenModo = modo;
  document.getElementById('rsmtab-a').classList.toggle('active', modo === 'a');
  document.getElementById('rsmtab-b').classList.toggle('active', modo === 'b');
  renderResumen();
}

// Activar/desactivar Incobrables del total de Posición — a pedido tuyo, se
// toca el nombre de la fila. Un toggle por modo (A y B son archivos
// distintos de TFcobranzas, independientes entre sí). No se guarda en
// localStorage a propósito: arranca siempre activado en cada carga, para
// no dejar un número "raro" guardado sin querer de una sesión anterior.
let _incobrablesOn = { a: true, b: true };
function toggleIncobrables(modo){
  _incobrablesOn[modo] = !_incobrablesOn[modo];
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

  // BAVSA: solo TF Carnes (Trade Food no tiene ese banco). Se suma en Modo A
  // a pedido tuyo — antes esta fórmula estaba confirmada contra tu ejemplo
  // de referencia SIN BAVSA; con este agregado el total de Modo A en TF
  // Carnes queda más alto que antes.
  const bavsaTfc = opTfc.bavsa ? (opTfc.bavsa.saldo || 0) : 0;

  // getCarteraTotal() recalcula en vivo descontando los cheques adjudicados
  // (excl[co].chq) — antes acá se usaba st[co].cartera, que es la suma
  // cruda de cuando subiste el archivo y no se actualizaba al adjudicar un
  // cheque (por eso "Cheques en cartera" no cambiaba ni con "↺ Actualizar").
  const carteraTfc = getCarteraTotal('tfc');
  const carteraTf  = getCarteraTotal('tf');

  const emitidosTfc = (st.tfc.chequesEmitidos||[]).reduce((s,c)=>s+c.importe,0);
  const emitidosTf  = (st.tf.chequesEmitidos ||[]).reduce((s,c)=>s+c.importe,0);

  const cpagarTfc = getProv('tfc').reduce((s,r)=>s+r.monto,0);
  const cpagarTf  = getProv('tf').reduce((s,r)=>s+r.monto,0);

  // Modo B usa "Total compromisos" (Vencido+7+15+Más15 de Modo B) en la fila
  // "Cuentas a pagar" en vez del cpagarTfc/cpagarTf de arriba — son fuentes
  // distintas (Modo B tiene su propio Excel "Subir compromisos"), a pedido tuyo.
  const compromisosBTfc = getModoBTotalCompromisos('tfc');
  const compromisosBTf  = getModoBTotalCompromisos('tf');

  const cotizTfc = _mbCotiz.tfc, cotizTf = _mbCotiz.tf;
  // Mismo cálculo que "Total equiv. pesos" de la pestaña Modo B (renderModoBExtra) —
  // incluye Saldo Financiera (solo TFC) a pedido tuyo.
  const mbTotalTfc = (st.tfc.modoB.pesos||0) + (st.tfc.modoB.cheques||0) + (cotizTfc ? (st.tfc.modoB.dolares||0)*cotizTfc : 0) + (st.tfc.modoB.saldoFinanciera||0);
  const mbTotalTf  = (st.tf.modoB.pesos ||0) + (st.tf.modoB.cheques ||0) + (cotizTf  ? (st.tf.modoB.dolares ||0)*cotizTf  : 0);

  // Cobrar / Incobrables: de TFcobranzas. "—" mientras se está leyendo el
  // Sheet la primera vez. Cobrar es SOLO Archivo A en Modo A y SOLO Archivo B
  // en Modo B — nunca sumados entre sí, a pedido tuyo, mismo criterio que ya
  // se usaba para Incobrables ("A resolver (excluido)" de Archivo A y de
  // Archivo B, dos números separados) — Incobrables SE SUMA al total de
  // Modo A/B (no se resta).
  const cobTfc = _cobCache.tfc, cobTf = _cobCache.tf;
  const cobrarATfc = cobTfc ? cobTfc.totalCobrarA : null;
  const cobrarATf  = cobTf  ? cobTf.totalCobrarA  : null;
  const cobrarBTfc = cobTfc ? cobTfc.totalCobrarB : null;
  const cobrarBTf  = cobTf  ? cobTf.totalCobrarB  : null;
  const incobrATfc = cobTfc ? cobTfc.dificilCobroA : null;
  const incobrBTfc = cobTfc ? cobTfc.dificilCobroB : null;
  const incobrATf  = cobTf  ? cobTf.dificilCobroA  : null;
  const incobrBTf  = cobTf  ? cobTf.dificilCobroB  : null;

  // Movidas (a Financiera): lo que ya se giró a Financiera, = "Efectivo a
  // entregar" de Compromisos de Efectivo (mismo cálculo que arma finkpi-efec
  // en renderFinanciera(): compromisos activos, sin contar los ya marcados
  // como pagados — _finPagados/compromisos son variables de app.js, visibles
  // acá porque los <script> clásicos comparten el mismo scope de nivel
  // superior). Solo existe para TFC; Trade Food no tiene panel de Financiera
  // → "—". Vive en Modo B (a pedido tuyo — antes estuvo en Modo A).
  const activosTfc = (st.tfc.compromisos || []).filter(c => !_finPagados.has(c.id));
  const movidasTfc = activosTfc.reduce((s,c) => s + c.importeEfectivo, 0);

  // Incobrables se puede activar/desactivar tocando el nombre de la fila
  // (toggleIncobrables) — cuando está desactivado, no entra en el total
  // (factor 0) pero el número sigue mostrándose, tachado, para que quede
  // claro qué se está dejando afuera.
  const incobrablesFactorA = _incobrablesOn.a ? 1 : 0;
  const incobrablesFactorB = _incobrablesOn.b ? 1 : 0;

  // Totales de LOS DOS modos, siempre (no solo el que está en pantalla) —
  // así "Cerrar semana" puede guardar todo sin importar qué pestaña tenías
  // abierta. Mismas fórmulas que abajo, un solo lugar donde calcularlas.
  // Modo B se calcula PRIMERO porque Modo A lo incorpora como un renglón más
  // (ver abajo) — Modo B no depende de Modo A, así que no hay circularidad.
  const totalBTfc = (mbTotalTfc||0) - compromisosBTfc + (cobrarBTfc||0) - movidasTfc + (incobrBTfc||0) * incobrablesFactorB;
  const totalBTf  = (mbTotalTf ||0) - compromisosBTf  + (cobrarBTf ||0) + (incobrBTf ||0) * incobrablesFactorB;
  const totalATfc = (bancosTfc||0) + bavsaTfc - emitidosTfc - cpagarTfc + carteraTfc + (cobrarATfc||0) + (incobrATfc||0) * incobrablesFactorA + totalBTfc;
  const totalATf  = (bancosTf ||0) - emitidosTf  - cpagarTf  + carteraTf  + (cobrarATf ||0) + (incobrATf ||0) * incobrablesFactorA + (getBavsaSaldoTf()||0);

  // Foto de estos números para "Cerrar semana" (ver cerrarSemana() más abajo)
  // — se recalcula cada vez que corre renderResumen(), así siempre está al
  // día con lo último cargado. incobrablesA/incobrablesB quedan con el valor
  // REAL (sin aplicar el toggle) para no ensuciar el histórico de "Apertura
  // por concepto"; posicionModoA/posicionModoB sí reflejan el toggle, porque
  // son "la posición tal cual la cerraste".
  _resumenSnapshot = {
    tfc: { bancos: bancosTfc, chequesEmitidos: emitidosTfc, cuentasAPagar: cpagarTfc, chequesEnCartera: carteraTfc,
           cobrar: cobrarATfc, movidas: movidasTfc, incobrablesA: incobrATfc, incobrablesB: incobrBTfc,
           disponibleModoB: mbTotalTfc, posicionModoA: totalATfc, posicionModoB: totalBTfc },
    tf:  { bancos: bancosTf, chequesEmitidos: emitidosTf, cuentasAPagar: cpagarTf, chequesEnCartera: carteraTf,
           cobrar: cobrarATf, movidas: null, incobrablesA: incobrATf, incobrablesB: incobrBTf,
           disponibleModoB: mbTotalTf, posicionModoA: totalATf, posicionModoB: totalBTf },
  };

  // Fila "Incobrables" clickeable (tocar el nombre activa/desactiva su efecto
  // en el total de ese modo) — reemplaza el row() genérico solo para esta fila.
  const incobrablesRow = (modo, vTfc, vTf) => {
    const on = _incobrablesOn[modo];
    return `<tr class="${on ? '' : 'rs-row-off'}">
      <td class="rs-label rs-label-toggle" onclick="toggleIncobrables('${modo}')" title="Tocar para ${on ? 'desactivar' : 'activar'} Incobrables en el total">Incobrables</td>
      <td class="rs-val tfc-col ${cls(vTfc)}">${fmt(vTfc)}</td>
      <td class="rs-val tf-col ${cls(vTf)}">${fmt(vTf)}</td>
    </tr>`;
  };

  let bodyHtml, footHtml;

  if (_resumenModo === 'a') {
    // Cobrar e Incobrables en Modo A = solo Archivo A de TFcobranzas (no se
    // suman con Archivo B). "Posición Modo B" entra acá como un renglón más
    // (suma o resta según su propio signo) — a pedido tuyo.
    bodyHtml = `
      ${row('Bancos', bancosTfc, bancosTf)}
      ${row('BAVSA', bavsaTfc || null, getBavsaSaldoTf())}
      ${row('Cheques emitidos', emitidosTfc ? -emitidosTfc : null, emitidosTf ? -emitidosTf : null)}
      ${row('Cuentas a pagar', cpagarTfc ? -cpagarTfc : null, cpagarTf ? -cpagarTf : null)}
      ${row('Cheques en cartera', carteraTfc || null, carteraTf || null)}
      ${row('Cobrar', cobrarATfc, cobrarATf)}
      ${incobrablesRow('a', incobrATfc, incobrATf)}
      <tr class="rs-ref-row">
        <td class="rs-label">Posición Modo B</td>
        <td class="rs-val tfc-col ${cls(totalBTfc)}">${fmt(totalBTfc)}</td>
        <td class="rs-val tf-col">—</td>
      </tr>
      <tr class="rs-total-row">
        <td class="rs-label rs-total">Posición Modo A</td>
        <td class="rs-val rs-total tfc-col ${cls(totalATfc)}">${fmt(totalATfc)}</td>
        <td class="rs-val rs-total tf-col ${cls(totalATf)}">${fmt(totalATf)}</td>
      </tr>`;
    footHtml = `Modo A (TF Carnes) = Bancos + BAVSA − Cheques emitidos − Cuentas a pagar + Cheques en cartera + Cobrar + Incobrables + Posición Modo B.
      Modo A (Trade Food) = Bancos + BAVSA − Cheques emitidos − Cuentas a pagar + Cheques en cartera + Cobrar + Incobrables ("Posición Modo B"
      es solo TF Carnes, acá no suma nada). La fila "BAVSA" en Trade Food es la suma de los 4 montos manuales de la sección BAVSA de Modo B
      (Títulos + Cheques en custodia + Cupo Caución + Caución tomada) — es un BAVSA distinto del banco de TF Carnes, pero igual que ese,
      a pedido tuyo, suma a la Posición Modo A. Acá "Cobrar" e "Incobrables" son solo Archivo A de TFcobranzas (en Modo B, ambos son solo
      Archivo B) — a pedido tuyo, nunca sumados entre archivos. Tocá el nombre "Incobrables" para activarlo/desactivarlo del total.
      "Posición Modo B" se suma tal cual da (puede ser negativo, en cuyo caso resta) — a pedido tuyo. "Movidas (a Financiera)" ya no está
      acá — se movió a Modo B.`;
  } else {
    // Modo B: la "posición" parte de lo disponible en Modo B (caja), no del
    // saldo bancario — el resto de los ajustes es el mismo criterio que Modo A.
    // Cobrar e Incobrables en Modo B = solo Archivo B de TFcobranzas (no
    // sumado con Archivo A). "Movidas (a Financiera)" vive acá (antes estaba
    // en Modo A) — a pedido tuyo.
    // NOTA: esta fórmula de Modo B es una inferencia mía a partir del ejemplo
    // que pasaste (no la confirmé contra un número de referencia como sí hice
    // con Modo A) — avisame si el total no coincide con lo que esperás.
    bodyHtml = `
      ${row('Disponible (Modo B)', mbTotalTfc || null, mbTotalTf || null)}
      ${row('Cuentas a pagar', compromisosBTfc ? -compromisosBTfc : null, compromisosBTf ? -compromisosBTf : null)}
      ${row('Cobrar', cobrarBTfc, cobrarBTf)}
      ${row('Movidas (a Financiera)', movidasTfc ? -movidasTfc : null, null)}
      ${incobrablesRow('b', incobrBTfc, incobrBTf)}
      <tr class="rs-total-row">
        <td class="rs-label rs-total">Posición Modo B</td>
        <td class="rs-val rs-total tfc-col ${cls(totalBTfc)}">${fmt(totalBTfc)}</td>
        <td class="rs-val rs-total tf-col ${cls(totalBTf)}">${fmt(totalBTf)}</td>
      </tr>`;
    footHtml = `Modo B = Disponible (Modo B) − Cuentas a pagar + Cobrar − Movidas (a Financiera) + Incobrables.
      Acá "Cobrar" e "Incobrables" son solo Archivo B de TFcobranzas (en Modo A, ambos son solo Archivo A) — a pedido tuyo, ninguno de los dos
      se suma entre archivos. Tocá el nombre "Incobrables" para activarlo/desactivarlo del total. "Cuentas a pagar" acá es el Total compromisos
      de Modo B (Vencido+Próx.7+Próx.15+Más15 del Excel "Subir compromisos" de Modo B) — no el mismo archivo de Cuentas a pagar que usa Modo A.
      Este total de Modo B es el que se suma/resta como "Posición Modo B" dentro de Modo A. Fórmula sin confirmar contra un número de
      referencia — revisala.`;
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
// #resumen-wrap (la card de Resumen + el botón "Cerrar semana") es una sola
// instancia que se muda de contenedor según la empresa activa, en vez de
// duplicarse — así no hay dos tablas ni ids repetidos. rs-slot-tfc/rs-slot-tf
// son los dos posibles destinos (uno al lado de cada Cash Flow).
function cobPlaceResumen(co){
  const wrap = document.getElementById('resumen-wrap');
  const slot = document.getElementById(co === 'tf' ? 'rs-slot-tf' : 'rs-slot-tfc');
  if (wrap && slot && wrap.parentElement !== slot) slot.appendChild(wrap);
}
cobPlaceResumen(typeof _coTab !== 'undefined' ? _coTab : 'tfc');

const _origSwitchCoTab = switchCoTab;
switchCoTab = function(co){
  _origSwitchCoTab(co);
  cobPlaceResumen(co);
};

// ── KPIs clickeables: modal con el detalle que compone cada número ─────────
// Mismo patrón que se agregó en TFcobranzas: cada tarjeta de la franja de
// KPIs (y de Financiera) abre un modal con la lista de ítems que suman ese
// total. Ninguna de estas funciones recalcula nada nuevo — todas leen los
// mismos arrays que ya usa app.js (st[co].bancos, carteraChqs,
// chequesFisicos, chequesEmitidos, provRaw, compromisos), así que la suma
// del detalle da exactamente igual al número de la tarjeta.
function getBancosDetalle(co, campo){
  let bancos;
  if (co === 'tfc') {
    const bs = st.tfc.bancos || [];
    bancos = bs.filter(b => TFC_OP_BANKS.some(p => p.test(b.nombre)));
  } else {
    bancos = st.tf.bancos || [];
  }
  return bancos.map(b => ({
    cliente: b.nombre,
    razon: campo === 'saldo' ? `Acuerdo: ${fN(b.acuerdo || 0)}` : `Saldo: ${fN(b.saldo || 0)}`,
    filas: 1,
    importe: b[campo] || 0,
  })).sort((a, b) => b.importe - a.importe);
}
function getDisponibleDetalle(co){
  const bancos = co === 'tfc' ? tfcOpBancos().saldo : st.tf.saldoBancos;
  const desc   = co === 'tfc' ? tfcOpBancos().desc  : st.tf.descubiertos;
  const rows = [];
  if (bancos != null) rows.push({ cliente: 'Saldo bancos', razon: '', filas: 1, importe: bancos });
  if (desc   != null) rows.push({ cliente: 'Acuerdos descubierto', razon: '', filas: 1, importe: desc });
  return rows;
}
// Total de Cartera de cheques EN VIVO, descontando los que marcaste como
// adjudicados/excluidos (excl[co].chq) — a diferencia de st[co].cartera,
// que es la suma cruda calculada una sola vez al subir el archivo y nunca
// se actualiza al adjudicar un cheque. Mismo criterio de exclusión que ya
// usa getCarteraDetalle() y la tarjeta KPI "Cartera cheques" de app.js.
function getCarteraTotal(co){
  let total = 0;
  (st[co].carteraChqs || []).forEach(r => {
    const id = chqStableId(co, 'e', r.numero, r.importe || 0);
    if (!excl[co].chq.has(id)) total += r.importe || 0;
  });
  (st[co].chequesFisicos || []).forEach(r => {
    const id = chqStableId(co, 'f', r.numero, r.importe || 0);
    if (!excl[co].chq.has(id)) total += r.importe || 0;
  });
  (_manualChqs || []).filter(m => m.co === co).forEach(m => {
    const id = `${co}_man_${m.id}`;
    if (!excl[co].chq.has(id)) total += m.importe || 0;
  });
  return total;
}
function getCarteraDetalle(co){
  const map = new Map();
  function add(cliente, importe){
    const key = cliente || '(sin nombre)';
    if (!map.has(key)) map.set(key, { cliente: key, importe: 0, filas: 0 });
    const v = map.get(key);
    v.importe += importe; v.filas += 1;
  }
  (st[co].carteraChqs || []).forEach(r => {
    const id = chqStableId(co, 'e', r.numero, r.importe || 0);
    if (!excl[co].chq.has(id)) add(r.razonSocial || r.recibidoDe, r.importe || 0);
  });
  (st[co].chequesFisicos || []).forEach(r => {
    const id = chqStableId(co, 'f', r.numero, r.importe || 0);
    if (!excl[co].chq.has(id)) add(r.razonSocial || r.recibidoDe, r.importe || 0);
  });
  (_manualChqs || []).filter(m => m.co === co).forEach(m => {
    const id = `${co}_man_${m.id}`;
    if (!excl[co].chq.has(id)) add(m.librador || m.recibidoDe, m.importe || 0);
  });
  return [...map.values()]
    .map(v => ({ ...v, razon: `${v.filas} cheque${v.filas > 1 ? 's' : ''}` }))
    .sort((a, b) => b.importe - a.importe);
}

// getCarteraRows() y renderDetail() (tabla de la pestaña Cartera de Cheques)
// arman y filtran/ordenan las filas todas dentro de la misma función en
// app.js, así que no hay forma de "engancharse" a mitad de camino para
// sumar la fuente "a mano" — se copian completas y se agrega el tercer
// loop/tag/botón nuevo, mismo criterio que ya se usó para renderModoB.
getCarteraRows = function(includeExcluded) {
  const co = document.getElementById('df-empresa').value;
  const q  = document.getElementById('df-search').value.trim().toLowerCase();
  const desde = document.getElementById('df-desde').value;
  const hasta = document.getElementById('df-hasta').value;
  const today = new Date(); today.setHours(0,0,0,0);
  const cos = co ? [co] : ['tfc','tf'];
  let rows = [];
  for (const c of cos) {
    const raw = JSON.parse(localStorage.getItem(`${c}_cheques_v2`) || '[]');
    raw.forEach(r => {
      const fecha = r.fechaPago ? new Date(r.fechaPago) : null;
      if (fecha) fecha.setHours(0,0,0,0);
      const dias = fecha ? Math.round((fecha-today)/(1000*86400)) : null;
      const _id = chqStableId(c, 'e', r.numero, r.importe||0);
      const excluido = excl[c].chq.has(_id);
      rows.push({
        _id, _co: c, _source: 'electronico', excluido,
        numero: r.numero||'', librador: r.razonSocial||'',
        recibidoDe: r.recibidoDe||'',
        cuit: r.cuitLibrador||r.cuitRecibido||'',
        fecha, fechaStr: fecha?fDateShort(fecha):'—', dias,
        importe: r.importe||0
      });
    });
    (st[c].chequesFisicos||[]).forEach(r => {
      const fecha = r.fechaPago ? new Date(r.fechaPago) : null;
      if (fecha) fecha.setHours(0,0,0,0);
      const dias = fecha ? Math.round((fecha-today)/(1000*86400)) : null;
      const _id = chqStableId(c, 'f', r.numero, r.importe||0);
      const excluido = excl[c].chq.has(_id);
      rows.push({
        _id, _co: c, _source: 'fisico', excluido,
        numero: r.numero||'', librador: r.razonSocial||'',
        recibidoDe: r.recibidoDe||'',
        cuit: r.cuitLibrador||'',
        fecha, fechaStr: fecha?fDateShort(fecha):'—', dias,
        importe: r.importe||0
      });
    });
    (_manualChqs||[]).filter(m=>m.co===c).forEach(m => {
      const fecha = m.fecha ? new Date(m.fecha+'T00:00:00') : null;
      if (fecha) fecha.setHours(0,0,0,0);
      const dias = fecha ? Math.round((fecha-today)/(1000*86400)) : null;
      const _id = `${c}_man_${m.id}`;
      const excluido = excl[c].chq.has(_id);
      rows.push({
        _id, _co: c, _source: 'manual', _manualId: m.id, excluido,
        numero: m.numero||'', librador: m.librador||'',
        recibidoDe: m.recibidoDe||'',
        cuit: m.cuit||'',
        fecha, fechaStr: fecha?fDateShort(fecha):'—', dias,
        importe: m.importe||0
      });
    });
  }
  if (!includeExcluded) rows = rows.filter(r => !r.excluido);
  if (q) rows = rows.filter(r=>(r.librador+r.recibidoDe+r.numero+r.cuit).toLowerCase().includes(q));
  if (desde) rows = rows.filter(r=>r.fecha && r.fecha >= new Date(desde));
  if (hasta) { const h=new Date(hasta); h.setHours(23,59,59); rows=rows.filter(r=>r.fecha&&r.fecha<=h); }
  const {col,dir} = _dSort;
  if (col) rows.sort((a,b)=>{
    let va=a[col],vb=b[col];
    if(va instanceof Date&&vb instanceof Date) return dir*(va-vb);
    if(typeof va==='number'&&typeof vb==='number') return dir*(va-vb);
    return dir*String(va||'').localeCompare(String(vb||''));
  });
  else rows.sort((a,b)=>{
    if(!a.fecha) return 1; if(!b.fecha) return -1; return a.fecha-b.fecha;
  });
  return rows;
};

const _origRenderDetail = renderDetail;
renderDetail = function() {
  if (_dTab !== 'cartera') { _origRenderDetail(); return; }
  const thead = document.getElementById('detail-thead');
  const tbody = document.getElementById('detail-tbody');

  const rows = getCarteraRows(_showExclChq);
  const activeRows = rows.filter(r=>!r.excluido);
  const selRows    = activeRows.filter(r=>_dSel.has(r._id));
  const allActiveIds = activeRows.map(r=>r._id);
  const allSel = allActiveIds.length>0 && allActiveIds.every(id=>_dSel.has(id));
  const selSum = selRows.reduce((s,r)=>s+r.importe,0);
  const total  = activeRows.reduce((s,r)=>s+r.importe,0);
  const tfc = activeRows.filter(r=>r._co==='tfc').reduce((s,r)=>s+r.importe,0);
  const tf  = activeRows.filter(r=>r._co==='tf').reduce((s,r)=>s+r.importe,0);
  const allExclCount = (()=>{
    let n=0;
    for(const c of['tfc','tf']){n+=excl[c].chq.size;}
    return n;
  })();

  document.getElementById('df-count').textContent = `${activeRows.length} cheques · $${fN(total)}${allExclCount?` · ${allExclCount} adjudicados`:''}`;

  thead.innerHTML = `<tr>
    <th class="d-chk"><input type="checkbox" ${allSel?'checked':''} onchange="toggleDSelAll(this.checked,${JSON.stringify(allActiveIds)})"></th>
    ${thSort('_co','Empresa')}
    ${thSort('numero','N° Cheque')}
    ${thSort('recibidoDe','Recibido de')}
    ${thSort('librador','Librador')}
    ${thSort('cuit','CUIT')}
    ${thSort('fecha','Fecha cobro')}
    ${thSort('dias','Días','r')}
    ${thSort('importe','Importe','r')}
    <th></th>
  </tr>`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="detail-empty">Sin cheques en cartera. Subí el archivo del banco o cargá uno a mano.</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r=>{
      const isExcl = r.excluido;
      const rc = isExcl ? '' : r.dias!==null&&r.dias<0?'overdue-row':r.dias!==null&&r.dias<=7?'soon-row':'';
      const sel = !isExcl && _dSel.has(r._id);
      const fisicoTag = r._source==='fisico'?' <span style="font-family:sans-serif;font-size:9px;background:#f3ede0;color:#8a6800;padding:1px 4px;border-radius:3px;font-weight:600;border:1px solid #e0cfa0">físico</span>':'';
      const manualTag = r._source==='manual'?' <span style="font-family:sans-serif;font-size:9px;background:#eef4ff;color:#2a4d8f;padding:1px 4px;border-radius:3px;font-weight:600;border:1px solid #c2d4f5">a mano</span>':'';
      const adjTag = isExcl ? ' <span style="font-size:9px;background:#e8f0ff;color:#3355cc;padding:1px 4px;border-radius:3px;font-weight:600;border:1px solid #b3c4f0">adjudicado</span>' : '';
      const rowStyle = isExcl ? 'style="opacity:.45"' : '';
      const actionBtn = isExcl
        ? `<button onclick="restoreChq('${r._id}','${r._co}')" title="Restaurar" style="border:none;background:none;color:#3355cc;cursor:pointer;font-size:12px;padding:0 4px">↩</button>`
        : (r._source==='manual' ? `<button onclick="deleteManualChq(${r._manualId})" title="Eliminar cheque cargado a mano" style="border:none;background:none;color:#aaa;cursor:pointer;font-size:12px;padding:0 4px">🗑</button>` : '');
      return `<tr class="${rc}${sel?' dsel-row':''}" ${rowStyle}>
        <td class="d-chk">${isExcl?'':'<input type="checkbox" '+(sel?'checked':'')+' onchange="toggleDSel(\''+r._id+'\',this.checked)">'}
        </td>
        <td>${coBadge(r._co)}</td>
        <td style="font-family:monospace;font-size:11px">${r.numero||'—'}${fisicoTag}${manualTag}${adjTag}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.recibidoDe}">${r.recibidoDe||'—'}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.librador}">${r.librador||'—'}</td>
        <td style="font-size:10px;color:#aaa">${r.cuit||'—'}</td>
        <td>${r.fechaStr}</td>
        <td class="r">${daysBadge(r.dias)}</td>
        <td class="r" style="font-weight:500">${fN(r.importe)}</td>
        <td style="text-align:center">${actionBtn}</td>
      </tr>`;
    }).join('');
  }

  const exclToggleBtn = allExclCount
    ? `<button onclick="toggleShowExcl()" style="margin-left:8px;font-size:10px;padding:2px 8px;border:1px solid #b3c4f0;border-radius:4px;background:${_showExclChq?'#e8f0ff':'#fff'};color:#3355cc;cursor:pointer;font-family:inherit">${_showExclChq?'▲ Ocultar adjudicados':'▼ Ver '+allExclCount+' adjudicados'}</button>`
    : '';
  let foot = `<div class="detail-foot">
    <span>Total: <strong>$${fN(total)}</strong> (${activeRows.length} chq)${exclToggleBtn}</span>`;
  if (tfc&&tf) foot+=`<span><span class="badge-co-tfc">TFC</span> $${fN(tfc)}</span><span><span class="badge-co-tf">TF</span> $${fN(tf)}</span>`;
  if (_dSel.size) foot+=`<span style="margin-left:auto;color:#506E3E;font-weight:700">${_dSel.size} seleccionados · $${fN(selSum)}</span>`;
  foot += '</div>';
  updateDetailFoot(foot);

  updateDSelBar(selRows.length, selSum, true);
};

// "+ Agregar cheque" solo tiene sentido en la pestaña Cartera de Cheques.
const _origSwitchDTab = switchDTab;
switchDTab = function(tab) {
  _origSwitchDTab(tab);
  const btn = document.getElementById('btn-add-chq-manual');
  if (btn) btn.style.display = (tab === 'cartera') ? '' : 'none';
};

// La tarjeta "Cartera cheques" de la franja de KPIs recalcula electrónico +
// físico adentro de renderKPIs() (app.js original) sin contemplar los
// cargados a mano — se ajusta acá con getCarteraTotal() (ya manual-aware)
// solo cuando hay alguno activo, para no tocar el comportamiento de
// siempre si nadie usó "+ Agregar cheque".
const _origRenderKPIs = renderKPIs;
renderKPIs = function(co) {
  _origRenderKPIs(co);
  const nManualAct = (_manualChqs||[]).filter(m => m.co===co && !excl[co].chq.has(`${co}_man_${m.id}`)).length;
  if (!nManualAct) return;
  const total = getCarteraTotal(co);
  const elCartera = document.getElementById(`kpi-${co}-cartera`);
  if (elCartera) elCartera.textContent = total>0 ? fN(total) : '—';
  const elNchq = document.getElementById(`kpi-${co}-nchq`);
  if (elNchq) elNchq.textContent += ` + ${nManualAct} man.`;
  if (co === 'tfc') {
    const eTotal = document.getElementById('kpi-tfc-cartera-total');
    if (eTotal) {
      const bv = tfcOpBancos().bavsa;
      const bavsaSaldo = bv != null ? bv.saldo : 0;
      eTotal.textContent = fN(total + bavsaSaldo);
    }
  }
};
function getBavsaDetalle(co){
  // TF Carnes: BAVSA es un banco más del Sheet "Reporte Tesorería".
  if (co === 'tfc') {
    const bv = tfcOpBancos().bavsa;
    if (!bv) return [];
    return [{ cliente: bv.nombre, razon: `Acuerdo: ${fN(bv.acuerdo || 0)}`, filas: 1, importe: bv.saldo || 0 }];
  }
  // Trade Food: BAVSA son los 4 montos de carga manual (sección BAVSA de Modo B).
  const campos = [
    { cliente: 'Títulos', importe: _bavsaTf.titulos },
    { cliente: 'Cheques en custodia', importe: _bavsaTf.custodia },
    { cliente: 'Cupo Caución', importe: _bavsaTf.cupo },
    { cliente: 'Caución tomada', importe: _bavsaTf.caucion },
  ];
  return campos.filter(c => c.importe != null).map(c => ({ ...c, razon: 'Carga manual', filas: 1 }));
}
function getFondosDetalle(co){
  if (co !== 'tfc') return [];
  const cartera = getCarteraTotal('tfc');
  const bv = tfcOpBancos().bavsa;
  const rows = [{ cliente: 'Cartera de cheques', razon: '', filas: 1, importe: cartera }];
  if (bv) rows.push({ cliente: 'Saldo BAVSA', razon: '', filas: 1, importe: bv.saldo || 0 });
  return rows;
}
function getEmitidosDetalle(co){
  const map = new Map();
  (st[co].chequesEmitidos || []).forEach(c => {
    const key = c.tercero || '(sin beneficiario)';
    if (!map.has(key)) map.set(key, { cliente: key, importe: 0, filas: 0 });
    const v = map.get(key);
    v.importe += c.importe || 0; v.filas += 1;
  });
  return [...map.values()]
    .map(v => ({ ...v, razon: `${v.filas} cheque${v.filas > 1 ? 's' : ''}` }))
    .sort((a, b) => b.importe - a.importe);
}
function getCPagarDetalle(co){
  const map = new Map();
  getProv(co).forEach(r => {
    const key = r.label || '(sin proveedor)';
    if (!map.has(key)) map.set(key, { cliente: key, importe: 0, filas: 0 });
    const v = map.get(key);
    v.importe += r.monto || 0; v.filas += 1;
  });
  return [...map.values()]
    .map(v => ({ ...v, razon: `${v.filas} comprobante${v.filas > 1 ? 's' : ''}` }))
    .sort((a, b) => b.importe - a.importe);
}
function getCompromisosActivos(co){
  if (co !== 'tfc') return [];
  return (st.tfc.compromisos || []).filter(c => !_finPagados.has(c.id));
}
function getCompromisosDetalle(co){
  return getCompromisosActivos(co)
    .map(c => ({ cliente: c.cliente, razon: `Entrega ${fDateShort(c.fechaEntrega)}`, filas: 1, importe: c.importeEfectivo }))
    .sort((a, b) => b.importe - a.importe);
}
function getCostoDetalle(co){
  return getCompromisosActivos(co)
    .map(c => ({ cliente: c.cliente, razon: `3% de ${fN(c.importeEfectivo)}`, filas: 1, importe: c.importeEfectivo * FIN_RATE }))
    .sort((a, b) => b.importe - a.importe);
}
function getEfectivoCostoDetalle(co){
  return getCompromisosActivos(co)
    .map(c => ({ cliente: c.cliente, razon: `Efectivo ${fN(c.importeEfectivo)} + 3% ${fN(c.importeEfectivo * FIN_RATE)}`, filas: 1, importe: c.importeEfectivo * (1 + FIN_RATE) }))
    .sort((a, b) => b.importe - a.importe);
}

const KPI_DETALLE = {
  bancos:   { titulo: 'Saldo bancos',            col2: 'Acuerdo',   vacio: 'Sin datos de bancos',        get: co => getBancosDetalle(co, 'saldo') },
  desc:     { titulo: 'Acuerdos descubierto',    col2: 'Saldo',     vacio: 'Sin datos de bancos',        get: co => getBancosDetalle(co, 'acuerdo') },
  disp:     { titulo: 'Disponible para operar',  col2: 'Detalle',   vacio: 'Sin datos',                  get: getDisponibleDetalle },
  cartera:  { titulo: 'Cartera cheques',         col2: 'Cantidad',  vacio: 'Sin cheques en cartera',     get: getCarteraDetalle },
  bavsa:    { titulo: 'Saldo BAVSA',             col2: 'Acuerdo',   vacio: 'Sin datos de BAVSA',         get: getBavsaDetalle },
  fondos:   { titulo: 'Fondos disponibles',      col2: 'Detalle',   vacio: 'Sin datos',                  get: getFondosDetalle },
  emitidos: { titulo: 'Chq emitidos (total)',    col2: 'Cantidad',  vacio: 'Sin cheques emitidos',       get: getEmitidosDetalle },
  cpagar:   { titulo: 'Cuentas a pagar',         col2: 'Cantidad',  vacio: 'Sin cuentas a pagar',        get: getCPagarDetalle },
  finn:     { titulo: 'Compromisos',             col2: 'Entrega',   vacio: 'Sin compromisos cargados',   get: getCompromisosDetalle },
  finefec:  { titulo: 'Efectivo a entregar',     col2: 'Entrega',   vacio: 'Sin compromisos cargados',   get: getCompromisosDetalle },
  fincosto: { titulo: 'Costo financiero (3%)',   col2: 'Cálculo',   vacio: 'Sin compromisos cargados',   get: getCostoDetalle },
  fintotal: { titulo: 'Efectivo + costo (3%)',   col2: 'Cálculo',   vacio: 'Sin compromisos cargados',   get: getEfectivoCostoDetalle },
};
function verKpi(co, tipo){
  const info = KPI_DETALLE[tipo];
  if (!info) return;
  const nombreCo = co === 'tfc' ? 'TF Carnes' : 'Trade Food';
  abrirKpiModal(`${info.titulo} · ${nombreCo}`, info.get(co), info.vacio, info.col2);
}
function abrirKpiModal(titulo, lista, vacioMsg, col2Label){
  const totalImporte = lista.reduce((s, r) => s + (r.importe || 0), 0);
  const totalFilas = lista.reduce((s, r) => s + (r.filas || 0), 0);
  document.getElementById('kpi-modal-title').textContent = titulo;
  document.getElementById('kpi-modal-sub').textContent =
    `${lista.length} ítems · ${totalFilas} filas · ${fN(totalImporte)} en total`;
  const elCol2 = document.getElementById('kpi-modal-col2');
  if (elCol2) elCol2.textContent = col2Label || 'Detalle';
  const tbody = document.getElementById('kpi-modal-tbody');
  tbody.innerHTML = lista.length
    ? lista.map(r => `<tr>
        <td>${r.cliente}</td>
        <td class="kd-razon">${r.razon || '—'}</td>
        <td class="r">${r.filas || 1}</td>
        <td class="r">${fN(r.importe)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="padding:22px;text-align:center;color:var(--ink-faint);font-size:12px">${vacioMsg}</td></tr>`;
  document.getElementById('kpi-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function cerrarKpiModal(){
  document.getElementById('kpi-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

// Proyección de cash flow al momento del cierre — mismos números que la
// tabla "Cash Flow Proyectado" (buildCF) y la tarjeta "Disponible para
// operar" (Saldo bancos + Acuerdos descubierto), pero calculados con un
// horizonte fijo de 30 días sin importar qué horizonte esté eligiendo el
// usuario en pantalla en ese momento.
function getCashflowProyeccion(co){
  const desc = co === 'tfc' ? (tfcOpBancos().desc || 0) : (st.tf.descubiertos || 0);
  const rows = buildCF(co, 30);
  const disponibles = rows.map(r => r.saldoFin + desc);
  return {
    disponibleOperar: disponibles[0] ?? null,
    saldo15d: disponibles[14] ?? null,
    saldo30d: disponibles[29] ?? null,
    minimo30d: disponibles.length ? Math.min(...disponibles) : null,
  };
}

// ── Cerrar semana: guarda una foto del Resumen de Posición (los dos modos,
// las dos empresas) en la tabla `cierres_semanales` de Supabase — la misma
// base que ya usa esta página para los Excel subidos — para poder leerla
// después desde otra página (ver seguimiento.html). A diferencia de
// supaReplaceRows() (que borra e inserta), acá cada cierre se AGREGA: la
// tabla tiene que ir acumulando una fila por cierre a lo largo del tiempo,
// no reemplazar la anterior. ─────────────────────────────────────────────
function cerrarSemana(){
  const btn = document.getElementById('btn-cerrar-semana');
  const status = document.getElementById('cerrar-semana-status');
  const notaInput = document.getElementById('cerrar-semana-nota');
  const setStatus = (msg, cls) => { if (status) { status.textContent = msg; status.className = 'cerrar-semana-status' + (cls ? ' ' + cls : ''); } };

  if (!_resumenSnapshot) {
    setStatus('Todavía no terminó de cargar el Resumen de Posición — probá de nuevo en un momento', 'err');
    return;
  }

  const nota = (notaInput && notaInput.value.trim()) || null;
  const ahora = new Date();
  const filas = ['tfc', 'tf'].map(co => {
    const s = _resumenSnapshot[co];
    const cf = getCashflowProyeccion(co);
    return {
      company: co,
      fecha: ahora.toISOString(),
      bancos: s.bancos,
      cheques_emitidos: s.chequesEmitidos,
      cuentas_a_pagar: s.cuentasAPagar,
      cheques_en_cartera: s.chequesEnCartera,
      cobrar: s.cobrar,
      movidas: s.movidas,
      incobrables_archivo_a: s.incobrablesA,
      incobrables_archivo_b: s.incobrablesB,
      disponible_modo_b: s.disponibleModoB,
      posicion_modo_a: s.posicionModoA,
      posicion_modo_b: s.posicionModoB,
      disponible_operar: cf.disponibleOperar,
      saldo_15d: cf.saldo15d,
      saldo_30d: cf.saldo30d,
      minimo_30d: cf.minimo30d,
      nota,
    };
  });

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Guardando…'; }
  setStatus('', '');

  sb.from('cierres_semanales').insert(filas)
    .then(({ error }) => {
      if (error) throw error;
      setStatus('✓ Semana cerrada · ' + ahora.toLocaleDateString('es-AR') + ' ' + ahora.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'}), 'ok');
      if (notaInput) notaInput.value = '';
    })
    .catch(err => {
      console.error('[Cerrar semana]', err);
      setStatus('✗ No se pudo guardar en Supabase: ' + err.message, 'err');
    })
    .finally(() => {
      if (btn) { btn.disabled = false; btn.textContent = '🔒 Cerrar semana'; }
    });
}
