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

// ── Resumen de Posición: TF Carnes vs. Trade Food, lado a lado ─────────────
// Todos los valores se leen de los mismos datos que ya usan las tarjetas KPI
// de cada empresa (renderKPIs) y Modo B — no se recalcula nada distinto.
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
  const bancosTfc = opTfc.saldo, descTfc = opTfc.desc;
  const bancosTf  = st.tf.saldoBancos, descTf = st.tf.descubiertos;
  const dispTfc = (bancosTfc!=null && descTfc!=null) ? bancosTfc+descTfc : bancosTfc;
  const dispTf  = (bancosTf!=null  && descTf!=null)  ? bancosTf+descTf  : bancosTf;

  const carteraTfc = st.tfc.cartera || 0;
  const carteraTf  = st.tf.cartera  || 0;
  const bavsaTfc = opTfc.bavsa ? (opTfc.bavsa.saldo||0) : 0;
  const fondosTfc = carteraTfc + bavsaTfc; // = "Fondos disponibles" de la tarjeta KPI de TFC

  const emitidosTfc = (st.tfc.chequesEmitidos||[]).reduce((s,c)=>s+c.importe,0);
  const emitidosTf  = (st.tf.chequesEmitidos ||[]).reduce((s,c)=>s+c.importe,0);

  const cpagarTfc = getProv('tfc').reduce((s,r)=>s+r.monto,0);
  const cpagarTf  = getProv('tf').reduce((s,r)=>s+r.monto,0);

  const cotizTfc = _mbCotiz.tfc, cotizTf = _mbCotiz.tf;
  const mbTotalTfc = (st.tfc.modoB.pesos||0) + (st.tfc.modoB.cheques||0) + (cotizTfc ? (st.tfc.modoB.dolares||0)*cotizTfc : 0);
  const mbTotalTf  = (st.tf.modoB.pesos ||0) + (st.tf.modoB.cheques ||0) + (cotizTf  ? (st.tf.modoB.dolares ||0)*cotizTf  : 0);

  // Posición total = Disponible para operar + Cartera/Fondos disponibles
  //                  + Modo B (equiv. pesos) − Cuentas a pagar
  const posTotalTfc = (dispTfc||0) + fondosTfc  + mbTotalTfc - cpagarTfc;
  const posTotalTf  = (dispTf ||0) + carteraTf  + mbTotalTf  - cpagarTf;

  tableEl.innerHTML = `
    <thead><tr>
      <th class="rs-th-label"></th>
      <th class="rs-th-co tfc-col">TF Carnes</th>
      <th class="rs-th-co tf-col">Trade Food</th>
    </tr></thead>
    <tbody>
      ${secHeader('Bancos')}
      ${row('Saldo bancos', bancosTfc, bancosTf)}
      ${row('Acuerdos descubierto', descTfc, descTf)}
      ${row('Disponible para operar', dispTfc, dispTf)}
      ${secHeader('Cartera y cuentas a pagar')}
      ${row('Cartera de cheques', carteraTfc || null, carteraTf || null)}
      ${row('Fondos disponibles (cartera + BAVSA)', fondosTfc || null, null)}
      ${row('Cheques emitidos', emitidosTfc || null, emitidosTf || null)}
      ${row('Cuentas a pagar', cpagarTfc ? -cpagarTfc : null, cpagarTf ? -cpagarTf : null)}
      ${secHeader('Modo B')}
      ${row('Pesos en caja', st.tfc.modoB.pesos, st.tf.modoB.pesos)}
      ${row('Dólares en caja', st.tfc.modoB.dolares, st.tf.modoB.dolares)}
      ${row('Cheques Modo B', st.tfc.modoB.cheques, st.tf.modoB.cheques)}
      ${row('Total equiv. pesos', mbTotalTfc || null, mbTotalTf || null)}
      <tr class="rs-total-row">
        <td class="rs-label rs-total">Posición total</td>
        <td class="rs-val rs-total tfc-col ${cls(posTotalTfc)}">${fmt(posTotalTfc)}</td>
        <td class="rs-val rs-total tf-col ${cls(posTotalTf)}">${fmt(posTotalTf)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr><td colspan="3" style="font-size:10px;color:#999;padding:8px 14px">
        Posición total = Disponible para operar + Cartera/Fondos disponibles + Modo B (equiv. pesos) − Cuentas a pagar.
        Los USD de Modo B solo se suman si cargaste una cotización arriba.
      </td></tr>
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
