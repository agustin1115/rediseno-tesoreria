// ─────────────────────────────────────────────────────────────────────
// Seguimiento de Cierres — lee el historial que guarda "🔒 Cerrar semana"
// (tabla cierres_semanales en Supabase, ver README.md) y arma el tablero
// histórico: evolución semanal, apertura por concepto, y el registro
// completo de cierres. No escribe nada salvo la nota de cada cierre
// (editable en el registro) — todo lo demás es de solo lectura.
// ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://ngamctjxejtprfpieehs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nYW1jdGp4ZWp0cHJmcGllZWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3OTE2OTIsImV4cCI6MjEwNDM2NzY5Mn0.3s4jEHuH4yz1LoQNdwxEpi8M7po6uhUnis-rA47WeE4';
// (typeof window check: este mismo archivo se importa desde Node en los
// smoke tests, donde no hay `window`/Supabase real disponible.)
const sb = typeof window !== 'undefined' ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const CO_LABEL = { tfc: 'TF Carnes', tf: 'Trade Food' };
const fN = n => (n == null ? '—' : Math.round(n).toLocaleString('es-AR'));
const fNSigned = n => (n == null ? '—' : (n > 0 ? '+' : '') + Math.round(n).toLocaleString('es-AR'));
const fPct = n => (n == null ? '' : (n > 0 ? '+' : '') + n.toFixed(1).replace('.', ',') + '%');

// ── Semana ISO 8601 (lunes a domingo, semana 1 = la que contiene el
// primer jueves del año) — solo para el rótulo "S39 · 2026", no se usa
// para agrupar (cada cierre ya viene identificado por su `fecha` real).
function isoWeekLabel(dateInput) {
  const d = new Date(Date.UTC(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // lunes=0 ... domingo=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // jueves de esa semana
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `S${week} · ${d.getUTCFullYear()}`;
}

// ── Agrupa las filas crudas de Supabase en "cierres": un cierre = todas
// las filas que comparten exactamente la misma `fecha` (cerrarSemana()
// siempre inserta TF Carnes + Trade Food juntos con el mismo timestamp).
// Devuelve la lista ordenada de más antiguo a más nuevo.
function agruparCierres(rows) {
  const byFecha = new Map();
  for (const r of rows) {
    if (!byFecha.has(r.fecha)) byFecha.set(r.fecha, { fecha: r.fecha, fechaObj: new Date(r.fecha) });
    byFecha.get(r.fecha)[r.company] = r;
  }
  return [...byFecha.values()].sort((a, b) => a.fechaObj - b.fechaObj);
}

// ── Delta (absoluto + %) entre el valor actual y uno anterior. null si
// falta cualquiera de los dos (cierre inexistente, o ese campo sin dato).
function delta(actual, previo) {
  if (actual == null || previo == null) return { abs: null, pct: null };
  const abs = actual - previo;
  const pct = previo !== 0 ? (abs / Math.abs(previo)) * 100 : null;
  return { abs, pct };
}

// ── Serie de un campo para una empresa a lo largo de los cierres
// (para los charts). Devuelve [{fecha, fechaObj, label, valor}].
function serieCampo(cierres, co, campo) {
  return cierres.map(c => ({
    fecha: c.fecha,
    fechaObj: c.fechaObj,
    label: isoWeekLabel(c.fechaObj),
    valor: c[co] ? c[co][campo] : null,
  }));
}

// ── Tabla "Apertura por concepto": últimos N cierres de una empresa,
// una fila por concepto, + columna Δ (vs el cierre inmediatamente
// anterior de esa misma lista, no necesariamente el primero mostrado).
const CONCEPTOS_BASE = [
  { key: 'bancos', label: 'Bancos' },
  { key: 'cheques_emitidos', label: 'Cheques emitidos', neg: true },
  { key: 'cuentas_a_pagar', label: 'Cuentas a pagar', neg: true },
  { key: 'cheques_en_cartera', label: 'Cheques en cartera' },
  { key: 'cobrar', label: 'Cobrar' },
  { key: 'movidas', label: 'Movidas (a Financiera)', neg: true, soloTfc: true },
];
const CONCEPTOS_CASHFLOW = [
  { key: 'disponible_operar', label: 'Disponible para operar' },
  { key: 'saldo_15d', label: 'Saldo proyectado a 15 días' },
  { key: 'saldo_30d', label: 'Saldo proyectado a 30 días' },
  { key: 'minimo_30d', label: 'Mínimo 30 días' },
];

function tablaConcepto(cierres, co, modo, n) {
  const ultimos = cierres.slice(-n);
  // el cierre anterior al primero mostrado, para poder calcular el Δ
  // de esa primera columna también (si existe).
  const idxPrimero = cierres.length - ultimos.length;
  const conAnterior = idxPrimero > 0 ? [cierres[idxPrimero - 1], ...ultimos] : ultimos;

  const incobrablesKey = modo === 'b' ? 'incobrables_archivo_b' : 'incobrables_archivo_a';
  const incobrablesLabel = modo === 'b' ? 'Incobrables (Archivo B)' : 'Incobrables (Archivo A)';
  const posicionKey = modo === 'b' ? 'posicion_modo_b' : 'posicion_modo_a';
  const posicionLabel = modo === 'b' ? 'Posición Modo B' : 'Posición Modo A';

  const conceptos = [
    ...CONCEPTOS_BASE.filter(c => !c.soloTfc || co === 'tfc'),
    { key: incobrablesKey, label: incobrablesLabel, neg: true },
  ];
  if (modo === 'b') conceptos.push({ key: 'disponible_modo_b', label: 'Disponible (Modo B)' });
  const conceptosCF = [...CONCEPTOS_CASHFLOW];

  function filaDe(def) {
    const valores = conAnterior.map(c => (c[co] ? c[co][def.key] : null));
    return {
      label: def.label,
      valores: valores.slice(idxPrimero > 0 ? 1 : 0),
      delta: delta(valores[valores.length - 1], valores[valores.length - 2]),
    };
  }

  return {
    columnas: ultimos.map(c => ({ fecha: c.fecha, label: isoWeekLabel(c.fechaObj) })),
    filas: conceptos.map(filaDe),
    filaPosicion: { ...filaDe({ key: posicionKey }), label: posicionLabel, bold: true },
    filasCashflow: conceptosCF.map(filaDe),
  };
}

// ── KPI de una tarjeta (TF Carnes / Trade Food / Consolidado): valor
// actual, Δ vs cierre anterior, Δ vs 4 cierres atrás.
function kpiTarjeta(cierres, co, modo) {
  const key = modo === 'b' ? 'posicion_modo_b' : 'posicion_modo_a';
  const get = (idx) => {
    const c = cierres[idx];
    if (!c) return null;
    if (co === 'consolidado') {
      const a = c.tfc ? c.tfc[key] : null, b = c.tf ? c.tf[key] : null;
      return (a == null && b == null) ? null : (a || 0) + (b || 0);
    }
    return c[co] ? c[co][key] : null;
  };
  const n = cierres.length;
  const actual = get(n - 1);
  const dispOperar = co === 'consolidado'
    ? (cierres[n - 1]?.tfc?.disponible_operar || 0) + (cierres[n - 1]?.tf?.disponible_operar || 0)
    : cierres[n - 1]?.[co]?.disponible_operar ?? null;
  const minimo30 = co === 'consolidado'
    ? (cierres[n - 1]?.tfc?.minimo_30d || 0) + (cierres[n - 1]?.tf?.minimo_30d || 0)
    : cierres[n - 1]?.[co]?.minimo_30d ?? null;
  return {
    actual,
    dispOperar,
    minimo30,
    vsAnterior: delta(actual, get(n - 2)),
    vs4Atras: delta(actual, get(n - 5)),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isoWeekLabel, agruparCierres, delta, serieCampo, tablaConcepto, kpiTarjeta, fN, fNSigned, fPct, CO_LABEL };
}

// ─────────────────────────────────────────────────────────────────────
// RENDER — todo lo de acá abajo asume navegador (DOM, Chart.js, sb real).
// Las funciones puras de arriba no dependen de nada de esto.
// ─────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {

const COLOR_TFC = '#506E3E';
const COLOR_TF = '#630000';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

let _cierres = [];
let _modo = 'a';
let _periodo = 26;
let _coConcepto = 'tfc';
let _coCashflow = 'tfc';
let _charts = {};

async function cargarDatos() {
  const el = document.getElementById('load-status');
  if (el) { el.textContent = 'Cargando…'; el.className = 'st-item st-loading'; }
  const { data, error } = await sb.from('cierres_semanales').select('*').order('fecha', { ascending: true });
  if (error) {
    console.error('[Seguimiento] error cargando cierres_semanales', error);
    if (el) { el.textContent = '✗ ' + error.message; el.className = 'st-item st-err'; }
    return;
  }
  _cierres = agruparCierres(data || []);
  if (el) { el.textContent = `✓ ${_cierres.length} cierres`; el.className = 'st-item st-ok'; }
  renderAll();
}

function cierresVisibles() {
  return _periodo === Infinity ? _cierres : _cierres.slice(-_periodo);
}

function setModo(modo) {
  _modo = modo;
  document.getElementById('modo-a').classList.toggle('active', modo === 'a');
  document.getElementById('modo-b').classList.toggle('active', modo === 'b');
  renderAll();
}
function setPeriodo(v) {
  _periodo = v === 'all' ? Infinity : parseInt(v, 10);
  renderAll();
}
function setCoConcepto(co, btn) {
  _coConcepto = co;
  btn.parentElement.querySelectorAll('.h-tab').forEach(b => b.classList.toggle('active', b === btn));
  renderTablaConcepto();
}
function setCoCashflow(co, btn) {
  _coCashflow = co;
  btn.parentElement.querySelectorAll('.h-tab').forEach(b => b.classList.toggle('active', b === btn));
  renderChartCashflow();
}

function renderAll() {
  renderHeader();
  renderKpis();
  renderChartPosicion();
  renderChartVariacion();
  renderChartCashflow();
  renderTablaConcepto();
  renderRegistro();
}

function renderHeader() {
  const wrap = document.getElementById('seg-content');
  const empty = document.getElementById('seg-empty');
  const hasData = _cierres.length > 0;
  if (wrap) wrap.hidden = !hasData;
  if (empty) empty.hidden = hasData;
  const hdr = document.getElementById('hdr-ultimo-cierre');
  if (!hdr) return;
  if (!hasData) { hdr.textContent = ''; return; }
  const ultimo = _cierres[_cierres.length - 1];
  const fFecha = ultimo.fechaObj.toLocaleDateString('es-AR');
  hdr.textContent = `Último cierre: ${isoWeekLabel(ultimo.fechaObj)} (${fFecha}) · ${cierresVisibles().length} semanas en pantalla`;
}

function deltaHtml(d, { compact } = {}) {
  if (d.abs == null) return '<span class="delta-none">—</span>';
  const cls = d.abs > 0 ? 'pos' : d.abs < 0 ? 'neg' : 'zero';
  const arrow = d.abs > 0 ? '▲' : d.abs < 0 ? '▼' : '·';
  const pct = d.pct != null ? ` ${fPct(d.pct)}` : '';
  return `<span class="${cls}">${arrow} ${fNSigned(d.abs)}${compact ? '' : pct}</span>`;
}

function renderKpis() {
  const cierres = cierresVisibles();
  const modoLabel = _modo === 'b' ? 'Modo B' : 'Modo A';
  [['tfc', 'kpi-card-tfc'], ['tf', 'kpi-card-tf'], ['consolidado', 'kpi-card-consolidado']].forEach(([co, id]) => {
    const card = document.getElementById(id);
    if (!card) return;
    const k = kpiTarjeta(cierres, co, _modo);
    const ultimo = cierres[cierres.length - 1];
    card.querySelector('.kpi-card-sub').textContent = ultimo ? `Posición ${modoLabel} · ${isoWeekLabel(ultimo.fechaObj)}` : '—';
    card.querySelector('.kpi-card-value').textContent = fN(k.actual);
    card.querySelector('.kpi-card-delta1').innerHTML = k.vsAnterior.abs == null ? '—' : `${deltaHtml(k.vsAnterior)} <span class="delta-vs">vs cierre anterior</span>`;
    card.querySelector('.kpi-card-delta2').innerHTML = k.vs4Atras.abs == null ? '—' : `${deltaHtml(k.vs4Atras)} <span class="delta-vs">vs 4 cierres atrás</span>`;
    card.querySelector('.kpi-mini-disp').textContent = fN(k.dispOperar);
    card.querySelector('.kpi-mini-min').textContent = fN(k.minimo30);
    const minEl = card.querySelector('.kpi-mini-min');
    minEl.classList.toggle('neg', k.minimo30 != null && k.minimo30 < 0);
    minEl.classList.toggle('pos', k.minimo30 != null && k.minimo30 >= 0);
  });
}

function destroyChart(id) { if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; } }

function renderChartPosicion() {
  const cierres = cierresVisibles();
  const key = _modo === 'b' ? 'posicion_modo_b' : 'posicion_modo_a';
  const labels = cierres.map(c => isoWeekLabel(c.fechaObj));
  const dTfc = cierres.map(c => c.tfc ? c.tfc[key] / 1e6 : null);
  const dTf = cierres.map(c => c.tf ? c.tf[key] / 1e6 : null);
  destroyChart('posicion');
  const ctx = document.getElementById('chart-posicion');
  if (!ctx) return;
  _charts.posicion = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [
      { label: 'TF Carnes', data: dTfc, borderColor: COLOR_TFC, backgroundColor: COLOR_TFC, pointRadius: 3, tension: .25 },
      { label: 'Trade Food', data: dTf, borderColor: COLOR_TF, backgroundColor: COLOR_TF, pointRadius: 3, tension: .25 },
    ]},
    options: chartOptions('Millones de pesos'),
  });
}

function renderChartVariacion() {
  const cierres = cierresVisibles();
  const key = _modo === 'b' ? 'posicion_modo_b' : 'posicion_modo_a';
  const labels = [];
  const dTfc = [], dTf = [];
  for (let i = 0; i < cierres.length; i++) {
    const idxGlobal = _cierres.indexOf(cierres[i]);
    const prev = _cierres[idxGlobal - 1];
    labels.push(isoWeekLabel(cierres[i].fechaObj));
    const vTfc = delta(cierres[i].tfc ? cierres[i].tfc[key] : null, prev && prev.tfc ? prev.tfc[key] : null).abs;
    const vTf = delta(cierres[i].tf ? cierres[i].tf[key] : null, prev && prev.tf ? prev.tf[key] : null).abs;
    dTfc.push(vTfc != null ? vTfc / 1e6 : null);
    dTf.push(vTf != null ? vTf / 1e6 : null);
  }
  destroyChart('variacion');
  const ctx = document.getElementById('chart-variacion');
  if (!ctx) return;
  _charts.variacion = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'TF Carnes', data: dTfc, backgroundColor: COLOR_TFC },
      { label: 'Trade Food', data: dTf, backgroundColor: COLOR_TF },
    ]},
    options: chartOptions('Millones de pesos'),
  });
}

function renderChartCashflow() {
  document.getElementById('cf-chart-sub').textContent = `Millones de pesos · ${CO_LABEL[_coCashflow]}`;
  const cierres = cierresVisibles();
  const labels = cierres.map(c => isoWeekLabel(c.fechaObj));
  const dDisp = cierres.map(c => c[_coCashflow] && c[_coCashflow].disponible_operar != null ? c[_coCashflow].disponible_operar / 1e6 : null);
  const dMin = cierres.map(c => c[_coCashflow] && c[_coCashflow].minimo_30d != null ? c[_coCashflow].minimo_30d / 1e6 : null);
  const color = _coCashflow === 'tfc' ? COLOR_TFC : COLOR_TF;
  destroyChart('cashflow');
  const ctx = document.getElementById('chart-cashflow');
  if (!ctx) return;
  _charts.cashflow = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Disponible para operar', data: dDisp, borderColor: color, backgroundColor: color, pointRadius: 3, tension: .25 },
      { label: 'Mínimo cash flow 30 días', data: dMin, borderColor: color, backgroundColor: color, borderDash: [6, 4], pointRadius: 3, tension: .25 },
    ]},
    options: chartOptions('Millones de pesos'),
  });
}

function chartOptions(yLabel) {
  return {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 14, font: { family: 'DM Sans', size: 11 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: 'DM Sans', size: 10.5 } } },
      y: { grid: { color: '#ECEAE0' }, ticks: { font: { family: 'DM Sans', size: 10.5 }, callback: v => v.toLocaleString('es-AR') } },
    },
  };
}

function renderTablaConcepto() {
  const cierres = cierresVisibles();
  const n = Math.min(8, cierres.length);
  const t = tablaConcepto(cierres, _coConcepto, _modo, n);
  const thead = document.getElementById('concepto-thead');
  const tbody = document.getElementById('concepto-tbody');
  if (!thead || !tbody) return;
  thead.innerHTML = `<tr><th>Concepto</th>${t.columnas.map(c => `<th>${esc(c.label)}</th>`).join('')}<th>Δ</th></tr>`;
  const filaHtml = (f, bold) => `<tr${bold ? ' class="fila-total"' : ''}><td>${esc(f.label)}</td>${
    f.valores.map(v => `<td class="${v == null ? 'zero' : v < 0 ? 'neg' : ''}">${v == null ? '—' : fN(v)}</td>`).join('')
  }<td>${deltaHtml(f.delta, { compact: true })}</td></tr>`;
  let html = t.filas.map(f => filaHtml(f)).join('') + filaHtml(t.filaPosicion, true);
  html += `<tr class="fila-seccion"><td colspan="${t.columnas.length + 2}">CASH FLOW</td></tr>`;
  html += t.filasCashflow.map(f => filaHtml(f)).join('');
  tbody.innerHTML = html || `<tr><td colspan="${t.columnas.length + 2}" class="no-data">Sin cierres para mostrar</td></tr>`;
}

function renderRegistro() {
  const tbody = document.getElementById('registro-tbody');
  if (!tbody) return;
  const cierres = cierresVisibles();
  const rows = [];
  for (const c of [...cierres].reverse()) {
    for (const co of ['tfc', 'tf']) {
      if (c[co]) rows.push({ cierre: c, co, r: c[co] });
    }
  }
  const countEl = document.getElementById('registro-count');
  if (countEl) countEl.textContent = `${rows.length} registrados`;
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="9" class="no-data">Todavía no se cerró ninguna semana</td></tr>`; return; }
  tbody.innerHTML = rows.map(({ cierre, co, r }) => {
    const registrado = r.created_at ? new Date(r.created_at) : cierre.fechaObj;
    return `<tr>
      <td>${esc(isoWeekLabel(cierre.fechaObj))}</td>
      <td>${cierre.fechaObj.toLocaleDateString('es-AR')}</td>
      <td class="co-cell"><span class="co-dot ${co}"></span>${CO_LABEL[co]}</td>
      <td>${fN(r.posicion_modo_a)}</td>
      <td>${fN(r.posicion_modo_b)}</td>
      <td>${fN(r.disponible_operar)}</td>
      <td class="${r.minimo_30d != null && r.minimo_30d < 0 ? 'neg' : ''}">${fN(r.minimo_30d)}</td>
      <td class="nota-cell" data-id="${r.id}" onclick="SEG.editarNota(this, ${r.id}, ${JSON.stringify(r.nota || '')})">${r.nota ? esc(r.nota) : '<span class="nota-empty">+ agregar nota</span>'}</td>
      <td class="registrado">${registrado.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })}, ${registrado.toLocaleTimeString('es-AR', { hour: 'numeric', minute: '2-digit' })}</td>
    </tr>`;
  }).join('');
}

function editarNota(td, id, actual) {
  if (td.querySelector('input')) return;
  td.innerHTML = `<input type="text" class="nota-edit-input" maxlength="300">`;
  const input = td.querySelector('input');
  input.value = actual;
  input.focus();
  input.select();
  let done = false;
  const guardar = () => { if (done) return; done = true; guardarNota(id, input.value.trim()); };
  const cancelar = () => { if (done) return; done = true; renderRegistro(); };
  input.addEventListener('blur', guardar);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); guardar(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
  });
}

async function guardarNota(id, nota) {
  const notaFinal = nota || null;
  const { error } = await sb.from('cierres_semanales').update({ nota: notaFinal }).eq('id', id);
  if (error) { console.error('[Seguimiento] error guardando nota', error); alert('No se pudo guardar la nota: ' + error.message); }
  for (const c of _cierres) {
    for (const co of ['tfc', 'tf']) if (c[co] && c[co].id === id) c[co].nota = notaFinal;
  }
  renderRegistro();
}

function exportExcelSeguimiento() {
  const cierres = cierresVisibles();
  const rows = [];
  for (const c of [...cierres].reverse()) {
    for (const co of ['tfc', 'tf']) {
      if (!c[co]) continue;
      const r = c[co];
      rows.push({
        Semana: isoWeekLabel(c.fechaObj), 'Fecha cierre': c.fechaObj.toLocaleDateString('es-AR'), Empresa: CO_LABEL[co],
        Bancos: r.bancos, 'Cheques emitidos': r.cheques_emitidos, 'Cuentas a pagar': r.cuentas_a_pagar,
        'Cheques en cartera': r.cheques_en_cartera, Cobrar: r.cobrar, Movidas: r.movidas,
        'Incobrables Archivo A': r.incobrables_archivo_a, 'Incobrables Archivo B': r.incobrables_archivo_b,
        'Disponible Modo B': r.disponible_modo_b, 'Posición Modo A': r.posicion_modo_a, 'Posición Modo B': r.posicion_modo_b,
        'Disponible para operar': r.disponible_operar, 'Saldo proyectado 15d': r.saldo_15d, 'Saldo proyectado 30d': r.saldo_30d,
        'Mínimo 30d': r.minimo_30d, Nota: r.nota || '',
      });
    }
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cierres semanales');
  XLSX.writeFile(wb, `seguimiento-cierres-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

window.SEG = { setModo, setPeriodo, setCoConcepto, setCoCashflow, editarNota, exportExcelSeguimiento, cargarDatos };
document.addEventListener('DOMContentLoaded', cargarDatos);

} // typeof window !== 'undefined'
