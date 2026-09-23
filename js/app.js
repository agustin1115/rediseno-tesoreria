// ─────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────
// Supabase: guarda los archivos Excel subidos manualmente (cuentas a pagar,
// cheques cartera, Modo B, compromisos de efectivo) para que persistan entre
// navegadores/dispositivos en vez de vivir solo en localStorage.
const SUPABASE_URL = 'https://ngamctjxejtprfpieehs.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nYW1jdGp4ZWp0cHJmcGllZWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3OTE2OTIsImV4cCI6MjEwNDM2NzY5Mn0.3s4jEHuH4yz1LoQNdwxEpi8M7po6uhUnis-rA47WeE4';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const MODOB_SHEET_ID = '12NkwVbsP89Mi_VYQB4qa0xTJVmfZ-Q3X4p3duxOCRHw';
const MODOB_SHEET_IDS = { tfc: MODOB_SHEET_ID, tf: MODOB_SHEET_ID };
const MODOB_TAB = 'resumen'; // pestaña con saldos de ambas empresas

const TESORERIA_SHEET_IDS = {
  tfc: '1C6e3hUwZMSUoNSurdF29RDJfmKT2l1VpyvzAxMX7JZc',
  tf:  '1_H-qiDSGAdBRDnUX6nJ-07InkaQMjpDo2SwQr9tiJ-k'
};
const FERIADOS = new Set([
  '2026-01-01','2026-02-16','2026-02-17','2026-03-23','2026-03-24',
  '2026-04-02','2026-04-03','2026-05-01','2026-05-25','2026-06-15',
  '2026-06-20','2026-07-09','2026-07-10','2026-08-17','2026-10-12',
  '2026-11-23','2026-12-07','2026-12-08','2026-12-25'
]);

// ─────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────
const st = {
  tfc: { saldoBancos:null, descubiertos:null, xlsmDate:null, bancos:[], chequesEmitidos:[], cartera:0, nChq:0, carteraChqs:[], provRaw:[], chequesFisicos:[], compromisos:[],
         modoB: { pesos:null, dolares:null, cheques:null, provRaw:[] } },
  tf:  { saldoBancos:null, descubiertos:null, xlsmDate:null, bancos:[], chequesEmitidos:[], cartera:0, nChq:0, carteraChqs:[], provRaw:[], chequesFisicos:[], compromisos:[],
         modoB: { pesos:null, dolares:null, cheques:null, provRaw:[] } }
};
// Pestaña de cheques físicos por empresa (solo TFC por ahora)
const FISICOS_TAB = { tfc: 'Cheques fisicos' };
let horizon = 15;

// Override state
const excl = {
  tfc: { prov: new Set(), chq: new Set() },
  tf:  { prov: new Set(), chq: new Set() }
};
let _showExclChq = false; // toggle mostrar adjudicados
const srcOn = {
  tfc: { prov: true },
  tf:  { prov: true }
};
// Manual entries: {id, co, type:'cob'|'prov', date:Date, importe:number, label:string}
let manuals = [];
let _manId = 0;
// Panel selection (items currently checked in the panel)
let _panelSel = new Set();

// ─────────────────────────────────────────────────────
// SUPABASE SYNC — persiste los excel subidos en la nube
// ─────────────────────────────────────────────────────
// Cada subida reemplaza por completo los datos previos de esa
// empresa/tabla (mismo comportamiento que ya tenía localStorage).
async function supaReplaceRows(table, company, rows) {
  let del = sb.from(table).delete();
  del = company ? del.eq('company', company) : del.gt('id', -1);
  const { error: delErr } = await del;
  if (delErr) throw delErr;
  if (rows.length) {
    const { error: insErr } = await sb.from(table).insert(rows);
    if (insErr) throw insErr;
  }
}
function markCloudSync(elId, ok) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent += ok ? ' · ☁' : ' · ⚠ sin nube';
}

async function hydrateFromSupabase() {
  // Formatea la fecha/hora REAL en que se subió el archivo (columna uploaded_at,
  // completada sola por Supabase al insertar), no el momento en que se abre la página.
  const fmtUploadedAt = (rows) => {
    if (!rows.length) return '';
    const latest = rows.reduce((max, r) => (!max || new Date(r.uploaded_at) > new Date(max)) ? r.uploaded_at : max, null);
    if (!latest) return '';
    const d = new Date(latest);
    return d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})
      + ' ' + d.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
  };
  try {
    for (const co of ['tfc','tf']) {
      const { data: chq, error: eChq } = await sb.from('cheques_cartera').select('*').eq('company', co);
      if (eChq) throw eChq;
      const mappedChq = chq.map(r => ({
        numero: r.numero, recibidoDe: r.recibido_de, cuitRecibido: r.cuit_recibido,
        fechaPago: r.fecha_pago ? new Date(r.fecha_pago).toISOString() : null,
        importe: r.importe, idCheque: r.id_cheque, razonSocial: r.razon_social, cuitLibrador: r.cuit_librador
      }));
      localStorage.setItem(`${co}_cheques_v2`, JSON.stringify(mappedChq));
      if (mappedChq.length) localStorage.setItem(`${co}_cheques_date_v2`, fmtUploadedAt(chq));

      const { data: prov, error: eProv } = await sb.from('cuentas_a_pagar').select('*').eq('company', co);
      if (eProv) throw eProv;
      const mappedProv = prov.map(r => ({ id: r.client_id, fecha: new Date(r.fecha).toISOString(), monto: r.monto, label: r.label }));
      localStorage.setItem(`${co}_prov_v1`, JSON.stringify(mappedProv));
      if (mappedProv.length) localStorage.setItem(`${co}_prov_date_v1`, fmtUploadedAt(prov));

      const { data: mb, error: eMb } = await sb.from('modo_b_compromisos').select('*').eq('company', co);
      if (eMb) throw eMb;
      const mappedMb = mb.map(r => ({ id: r.client_id, fecha: new Date(r.fecha).toISOString(), monto: r.monto, label: r.label }));
      localStorage.setItem(`${co}_modob_prov_v1`, JSON.stringify(mappedMb));
      if (mappedMb.length) localStorage.setItem(`${co}_modob_prov_date_v1`, fmtUploadedAt(mb));
    }
    const { data: comp, error: eComp } = await sb.from('compromisos_efectivo').select('*');
    if (eComp) throw eComp;
    const mappedComp = comp.map(r => ({
      id: r.client_id, cliente: r.cliente,
      fechaVto: new Date(r.fecha_vto).toISOString(), fechaEntrega: new Date(r.fecha_entrega).toISOString(),
      importeEfectivo: r.importe_efectivo
    }));
    localStorage.setItem('tfc_compromisos_v1', JSON.stringify(mappedComp));
    if (mappedComp.length) localStorage.setItem('tfc_compromisos_date_v1', fmtUploadedAt(comp));
  } catch(e) {
    console.warn('[Supabase] No se pudo sincronizar datos remotos, se usa el caché local:', e.message);
  }
}

// ─────────────────────────────────────────────────────
// PERSISTENCE
// ─────────────────────────────────────────────────────
function saveOverrides() {
  try {
    localStorage.setItem('cf_overrides_v3', JSON.stringify({
      excl: {
        tfc: { prov:[...excl.tfc.prov], chq:[...excl.tfc.chq] },
        tf:  { prov:[...excl.tf.prov],  chq:[...excl.tf.chq]  }
      },
      srcOn,
      manuals: manuals.map(m => ({...m, date:m.date.toISOString()}))
    }));
  } catch(e){}
}
function loadOverrides() {
  try {
    const raw = localStorage.getItem('cf_overrides_v3');
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.excl) {
      for (const co of ['tfc','tf']) {
        excl[co].prov = new Set((d.excl[co]||{}).prov||[]);
        excl[co].chq  = new Set((d.excl[co]||{}).chq||[]);
      }
    }
    if (d.srcOn) {
      for (const co of ['tfc','tf'])
        srcOn[co].prov = d.srcOn[co]?.prov ?? true;
    }
    if (d.manuals)
      manuals = d.manuals.map(m => ({...m, date:new Date(m.date), id:++_manId}));
  } catch(e){}
}

// ─────────────────────────────────────────────────────
// ACCESSORS
// ─────────────────────────────────────────────────────
function getProv(co) {
  if (!srcOn[co].prov) return [];
  return st[co].provRaw.filter(r => !excl[co].prov.has(r.id));
}
function getManuales(co, type) { return manuals.filter(m => m.co===co && m.type===type); }

// ─────────────────────────────────────────────────────
// BUSINESS DAY HELPERS
// ─────────────────────────────────────────────────────
function dKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isBizDay(d) { return d.getDay()!==0 && d.getDay()!==6 && !FERIADOS.has(dKey(d)); }
function nextBizDay(d) {
  const r=new Date(d); r.setDate(r.getDate()+1);
  while(!isBizDay(r)) r.setDate(r.getDate()+1);
  return r;
}
function calcDebitDate(pmt) {
  const d=new Date(pmt); d.setHours(0,0,0,0);
  while(!isBizDay(d)) d.setDate(d.getDate()+1);
  return nextBizDay(d);
}

// ─────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────
function fN(n) { if(n==null) return '—'; return Math.round(n).toLocaleString('es-AR'); }
function fDateLabel(d) {
  const names=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  return `${names[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}
function fDateShort(d) {
  if(!d) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}
function fDateInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─────────────────────────────────────────────────────
// JSONP — raw rows
// ─────────────────────────────────────────────────────
function loadSheetRaw(sheetId, tabName) {
  return new Promise((resolve, reject) => {
    const cb='_gr_'+Math.random().toString(36).slice(2);
    let done=false;
    const t=setTimeout(()=>{if(!done){done=true;cleanup();reject(new Error('Timeout'));}},20000);
    function cleanup(){clearTimeout(t);delete window[cb];if(s.parentNode)s.parentNode.removeChild(s);}
    window[cb]=data=>{if(done)return;done=true;cleanup();
      if(!data||data.status==='error'){reject(new Error(data?.errors?.[0]?.detailed_message||'JSONP error'));return;}
      resolve(data);};
    const s=document.createElement('script');
    s.onerror=()=>{if(!done){done=true;cleanup();reject(new Error('Script load error'));}};
    s.src=`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;responseHandler:${cb}&sheet=${encodeURIComponent(tabName)}&headers=0`;
    document.head.appendChild(s);
  });
}
// ─────────────────────────────────────────────────────
// CHEQUES FÍSICOS — Google Sheet "Cheques fisicos"
// Cols: A=número, B=recibidoDe, C=librador, D=CUIT, E=fechaCobro, F=importe
// ─────────────────────────────────────────────────────
function parseGvizDate(cell) {
  if (!cell || cell.v == null) return null;
  const v = cell.v;
  // gviz devuelve fechas como "Date(año,mes0,día)"
  const m = String(v).match(/Date\((\d+),(\d+),(\d+)\)/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
async function loadChequesFisicos(co) {
  const tab = FISICOS_TAB[co];
  if (!tab) { st[co].chequesFisicos = []; return; }
  const sid = TESORERIA_SHEET_IDS[co];
  setSt(co, 'xlsm', 'loading', `⏳ Chq físicos ${co.toUpperCase()}...`);
  try {
    // headers=1 para saltar la fila de encabezado
    const data = await loadSheetRaw(sid, tab);
    const rows = data.table?.rows || [];
    // slice(1) porque loadSheetRaw usa headers=0, así que la primera fila es el encabezado
    st[co].chequesFisicos = rows.slice(1).map((r,i) => ({
      _id: `fisico_${co}_${i}`,
      numero:       String(r.c[0]?.v ?? '').trim(),
      recibidoDe:   String(r.c[1]?.v ?? '').trim(),
      razonSocial:  String(r.c[2]?.v ?? '').trim(),
      cuitLibrador: String(r.c[3]?.v ?? '').trim(),
      fechaPago:    parseGvizDate(r.c[4])?.toISOString() ?? null,
      importe:      typeof r.c[5]?.v === 'number' ? r.c[5].v : parseFloat(String(r.c[5]?.v||'0').replace(/[^0-9.-]/g,'')) || 0,
      _source:      'fisico'
    })).filter(c => c.importe > 0 && c.numero !== '');
    console.log(`[FISICOS] ${co}: ${st[co].chequesFisicos.length} cheques físicos cargados`);
  } catch(e) {
    console.warn('[FISICOS] Error:', e.message);
    st[co].chequesFisicos = [];
  }
}

function gvizRawRows(data) {
  if(!data.table||!data.table.rows) return [];
  return data.table.rows.map(row=>(row.c||[]).map(cell=>cell||{v:null,f:null}));
}
function gvizDate(val) {
  if(val instanceof Date) return val;
  if(typeof val==='string'){const m=val.match(/Date\((\d+),(\d+),(\d+)\)/);if(m)return new Date(+m[1],+m[2],+m[3]);}
  return null;
}
function parseFechaAR(str) {
  if(!str) return null;
  let m=String(str).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m) return new Date(+m[3],+m[2]-1,+m[1]);
  m=String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return new Date(+m[1],+m[2]-1,+m[3]);
  return null;
}

// ─────────────────────────────────────────────────────
// TESORERÍA VÍA GOOGLE SHEETS
// ─────────────────────────────────────────────────────
function parseReporte(data, co) {
  const rows=gvizRawRows(data);
  if(!rows.length) throw new Error('Sin filas en Reporte Tesoreria');
  const cellA0=rows[0][0]||{};
  let xlsmDate=gvizDate(cellA0.v);
  if(!xlsmDate&&cellA0.f){const p=String(cellA0.f).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);if(p)xlsmDate=new Date(+p[3],+p[2]-1,+p[1]);}
  let saldoBancos=null, descubiertos=null;
  const bancos=[];
  for(const row of rows){
    const cA=row[0]||{},cB=row[1]||{},cC=row[2]||{};
    const nombre=String(cA.v??cA.f??'').trim();
    const isTotal=nombre.toUpperCase()==='TOTAL';
    if(isTotal && typeof cB.v==='number'){
      saldoBancos=cB.v;
      if(typeof cC.v==='number') descubiertos=cC.v;
      break;
    }
    // Fila de banco individual: nombre no vacío + saldo numérico
    if(nombre && typeof cB.v==='number'){
      bancos.push({nombre, saldo:cB.v, acuerdo: typeof cC.v==='number'?cC.v:0});
    }
  }
  if(saldoBancos==null) console.warn(`[Tesoreria ${co}] No se encontró TOTAL. Filas:`,rows.slice(0,8).map(r=>r.map(c=>`${c.v}|${c.f}`)));
  st[co].bancos=bancos;
  st[co].saldoBancos=saldoBancos; st[co].descubiertos=descubiertos; st[co].xlsmDate=xlsmDate;
}
function parseChEmitidos(data, co) {
  const rows=gvizRawRows(data);
  const cheques=[];
  for(let i=1;i<rows.length;i++){
    const r=rows[i]; if(!r||r.length<8) continue;
    const cF=r[6]||{},cI=r[7]||{};
    const paymentDate=gvizDate(cF.v)||parseFechaAR(cF.f);
    const importe=typeof cI.v==='number'?cI.v:parseFloat(String(cI.f||'').replace(/[^0-9.,-]/g,'').replace(',','.'))||0;
    if(!paymentDate||importe<=0) continue;
    cheques.push({paymentDate,debitDate:calcDebitDate(paymentDate),importe,numero:(r[4]||{}).v??null,tercero:String((r[3]||{}).v||(r[3]||{}).f||'').trim()});
  }
  st[co].chequesEmitidos=cheques;
}
async function loadTesoreria(co) {
  setSt(co,'xlsm','loading',`⏳ Tesorería ${co.toUpperCase()}...`);
  const sid=TESORERIA_SHEET_IDS[co];
  try {
    const gRep=await loadSheetRaw(sid,'Reporte Tesoreria');
    parseReporte(gRep,co);
    try{const gChq=await loadSheetRaw(sid,'Ch. Emitidos');parseChEmitidos(gChq,co);}
    catch(e){console.warn(`[Tesoreria ${co}] Ch. Emitidos: ${e.message}`);st[co].chequesEmitidos=[];}
    const ds=st[co].xlsmDate?st[co].xlsmDate.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}):'';
    setSt(co,'xlsm','ok',`✓ Tesorería ${co.toUpperCase()}${ds?' · '+ds:''}`);
    document.getElementById(`xlsm-fb-${co}`).style.display='none';
    renderAll();
  } catch(e) {
    console.error(`[Tesoreria ${co}]:`,e);
    setSt(co,'xlsm','err',`✗ Tesorería ${co.toUpperCase()}: ${e.message}`);
    document.getElementById(`xlsm-fb-${co}`).style.display='';
  }
}
function onXLSMUpload(event,co){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
      const ws1=wb.Sheets['Reporte Tesoreria'];if(!ws1)throw new Error('"Reporte Tesoreria" no encontrada');
      const rows1=XLSX.utils.sheet_to_json(ws1,{header:1,raw:true,cellDates:true});
      let xlsmDate=null,saldoBancos=null;
      if(rows1[0]&&rows1[0][0] instanceof Date)xlsmDate=rows1[0][0];
      let desc1=null;const bancos1=[];
      for(const row of rows1){
        if(!row)continue;
        const nombre=String(row[0]??'').trim();
        if(nombre.toUpperCase()==='TOTAL'&&typeof row[1]==='number'){saldoBancos=row[1];if(typeof row[2]==='number')desc1=row[2];break;}
        if(nombre&&typeof row[1]==='number')bancos1.push({nombre,saldo:row[1],acuerdo:typeof row[2]==='number'?row[2]:0});
      }
      st[co].bancos=bancos1;st[co].descubiertos=desc1;
      st[co].saldoBancos=saldoBancos;st[co].xlsmDate=xlsmDate;
      const ws2=wb.Sheets['Ch. Emitidos'];
      if(ws2){const rows2=XLSX.utils.sheet_to_json(ws2,{header:1,raw:true,cellDates:true});const ch=[];
        for(let i=1;i<rows2.length;i++){const r=rows2[i];if(!r||!(r[0] instanceof Date))continue;const p=r[6] instanceof Date?r[6]:null;const im=typeof r[7]==='number'?r[7]:0;if(!p||im<=0)continue;ch.push({paymentDate:p,debitDate:calcDebitDate(p),importe:im,numero:r[4],tercero:String(r[3]||'').trim()});}
        st[co].chequesEmitidos=ch;}
      setSt(co,'xlsm','ok',`✓ Tesorería ${co.toUpperCase()} (manual)`);
      document.getElementById(`xlsm-fb-${co}`).style.display='none';renderAll();
    }catch(err){setSt(co,'xlsm','err',`✗ ${err.message}`);}
  };
  reader.readAsArrayBuffer(file);event.target.value='';
}

// ─────────────────────────────────────────────────────
// CHEQUES EN CARTERA
// ─────────────────────────────────────────────────────
function loadCarteraFromStorage(){
  for(const co of ['tfc','tf']){
    try{
      const raw=localStorage.getItem(`${co}_cheques_v2`);
      const ds=localStorage.getItem(`${co}_cheques_date_v2`)||'';
      if(raw){
        const d=JSON.parse(raw);
        st[co].carteraChqs=d;
        st[co].cartera=d.reduce((s,c)=>s+(c.importe||0),0);
        st[co].nChq=d.length;
        setUploadSt(`ust-chq-${co}`,`uz-chq-${co}`,'ok',`✓ ${d.length} chq · ${ds}`);
      }else{
        st[co].carteraChqs=[];st[co].cartera=0;st[co].nChq=0;
        setUploadSt(`ust-chq-${co}`,`uz-chq-${co}`,'','Sin datos');
      }
    }catch(e){st[co].carteraChqs=[];st[co].cartera=0;st[co].nChq=0;}
  }
}
function onChqUpload(event,co){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,cellDates:true});
      // DEBUG: mostrar en consola las primeras filas para diagnóstico
      console.log('[CHQ] Total filas en el Excel:', rows.length);
      console.log('[CHQ] Primeras 5 filas:', rows.slice(0,5));
      const allData=rows.slice(2);
      const withImporte=allData.filter(r=>r&&r[6]!=null&&r[6]!=='');
      console.log('[CHQ] Filas con importe (r[6]):', withImporte.length);
      const parsed=withImporte.map(r=>({
        numero:String(r[0]||'').trim(),recibidoDe:String(r[2]||'').trim(),cuitRecibido:String(r[3]||'').trim(),
        fechaPago:r[4] instanceof Date?r[4].toISOString():null,
        importe:typeof r[6]==='number'?r[6]:parseFloat(String(r[6]).replace(/[^0-9.-]/g,'')),
        idCheque:String(r[9]||'').trim(),razonSocial:String(r[16]||'').trim(),cuitLibrador:String(r[17]||'').trim()
      }))
      // Filtrar: importe positivo + debe tener número de cheque (las filas de totales/subtotales no lo tienen)
      .filter(c=>c.importe>0&&!isNaN(c.importe)&&c.numero!=='');
      console.log('[CHQ] Cheques válidos (con número):', parsed.length, parsed.slice(0,3));
      st[co].carteraChqs=parsed;st[co].cartera=parsed.reduce((s,c)=>s+c.importe,0);st[co].nChq=parsed.length;
      const ds=new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})+' '+new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
      localStorage.setItem(`${co}_cheques_v2`,JSON.stringify(parsed));localStorage.setItem(`${co}_cheques_date_v2`,ds);
      setUploadSt(`ust-chq-${co}`,`uz-chq-${co}`,'ok',`✓ ${parsed.length} chq · ${ds}`);renderAll();
      supaReplaceRows('cheques_cartera', co, parsed.map(p => ({
        company: co, numero: p.numero, recibido_de: p.recibidoDe, cuit_recibido: p.cuitRecibido,
        fecha_pago: p.fechaPago ? p.fechaPago.slice(0,10) : null, importe: p.importe,
        id_cheque: p.idCheque, razon_social: p.razonSocial, cuit_librador: p.cuitLibrador
      }))).then(()=>markCloudSync(`ust-chq-${co}`,true)).catch(e=>{console.warn('[Supabase]',e.message);markCloudSync(`ust-chq-${co}`,false);});
    }catch(err){setUploadSt(`ust-chq-${co}`,`uz-chq-${co}`,'err','✗ '+err.message);}
  };
  reader.readAsArrayBuffer(file);event.target.value='';
}

// ─────────────────────────────────────────────────────
// PROVEEDORES — UPLOAD XLS (mismo archivo que gestión de pagos)
// Columnas conocidas: "Fecha Operacion", "Haber", "Razón social"
// ─────────────────────────────────────────────────────

// Busca el índice de una columna por nombre (case-insensitive, trim)
function findCol(headers, ...candidates) {
  for (const c of candidates) {
    const idx = headers.findIndex(h => String(h||'').trim().toLowerCase() === c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseProvXLS(wb) {
  // Intentar con la primera hoja
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, cellDates:true});
  if (rows.length < 2) throw new Error('El archivo no tiene datos suficientes');

  // Detectar fila de headers (buscar en las primeras 5 filas)
  let hdrRow = 0;
  let iF = -1, iM = -1, iD = -1, iE = -1;
  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const hdrs = (rows[r] || []).map(h => String(h||'').trim());
    iF = findCol(hdrs, 'Fecha Operacion', 'Fecha Vencimiento', 'Fecha', 'fecha_vto', 'Vencimiento');
    iM = findCol(hdrs, 'Haber', 'Monto', 'Importe', 'Total', 'Valor');
    iD = findCol(hdrs, 'Razón social', 'Razon social', 'Proveedor', 'Nombre', 'Descripcion', 'Concepto');
    iE = findCol(hdrs, 'Estado', 'Estado pago', 'Status');
    if (iF >= 0 && iM >= 0) { hdrRow = r; break; }
  }
  if (iF < 0 || iM < 0) throw new Error('No se encontraron columnas de Fecha y Monto. Verificá que el archivo sea el de cuentas a pagar.');

  const counters = {}; const raw = [];
  for (let r = hdrRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    // Saltar pagados/cancelados
    if (iE >= 0) {
      const est = String(row[iE]||'').trim().toLowerCase();
      if (/pagado|cancelado|anulado|paid/.test(est)) continue;
    }
    // Fecha
    let fecha = row[iF];
    if (fecha instanceof Date) { fecha.setHours(0,0,0,0); }
    else { fecha = parseFechaAR(String(fecha||'')); }
    if (!fecha || isNaN(fecha.getTime())) continue;
    // Monto
    let monto = typeof row[iM] === 'number' ? row[iM]
      : parseFloat(String(row[iM]||'').replace(/[^0-9.,-]/g,'').replace(',','.')) || 0;
    if (monto <= 0) continue;
    // Label
    const label = iD >= 0 ? String(row[iD]||'').trim() : '';
    const k = dKey(fecha) + '_' + Math.round(monto);
    counters[k] = (counters[k] || 0);
    const id = k + '_' + counters[k]++;
    raw.push({id, fecha, monto, label});
  }
  return raw;
}

function loadProvFromStorage() {
  for (const co of ['tfc','tf']) {
    try {
      const raw = localStorage.getItem(`${co}_prov_v1`);
      const ds  = localStorage.getItem(`${co}_prov_date_v1`) || '';
      const btnEl = document.getElementById(`btn-rev-prov-${co}`);
      if (raw) {
        const parsed = JSON.parse(raw).map(r => ({...r, fecha: new Date(r.fecha)}));
        st[co].provRaw = parsed;
        setUploadSt(`ust-prov-${co}`, `uz-prov-${co}`, 'ok', `✓ ${parsed.length} compromisos · ${ds}`);
        if (btnEl) btnEl.style.display = '';
        updateProvBtn(co);
        setSt(co, 'prov', 'ok', `✓ Pagos ${co.toUpperCase()} (${parsed.length})`);
      } else {
        st[co].provRaw = [];
        setUploadSt(`ust-prov-${co}`, `uz-prov-${co}`, '', 'Sin datos');
        setSt(co, 'prov', '', `Pagos ${co.toUpperCase()}: sin datos`);
      }
    } catch(e) { st[co].provRaw = []; }
  }
}

function onProvUpload(event, co) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
      const raw = parseProvXLS(wb);
      st[co].provRaw = raw;
      const ds = new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})
               + ' ' + new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
      // Guardar en localStorage (fechas como ISO string)
      localStorage.setItem(`${co}_prov_v1`, JSON.stringify(raw.map(r=>({...r, fecha:r.fecha.toISOString()}))));
      localStorage.setItem(`${co}_prov_date_v1`, ds);
      setUploadSt(`ust-prov-${co}`, `uz-prov-${co}`, 'ok', `✓ ${raw.length} compromisos · ${ds}`);
      const btnEl = document.getElementById(`btn-rev-prov-${co}`);
      if (btnEl) btnEl.style.display = '';
      updateProvBtn(co);
      setSt(co, 'prov', 'ok', `✓ Pagos ${co.toUpperCase()} (${raw.length})`);
      renderAll();
      supaReplaceRows('cuentas_a_pagar', co, raw.map(r => ({
        company: co, client_id: r.id, fecha: dKey(r.fecha), monto: r.monto, label: r.label
      }))).then(()=>markCloudSync(`ust-prov-${co}`,true)).catch(e=>{console.warn('[Supabase]',e.message);markCloudSync(`ust-prov-${co}`,false);});
    } catch(err) {
      setUploadSt(`ust-prov-${co}`, `uz-prov-${co}`, 'err', `✗ ${err.message}`);
      setSt(co, 'prov', 'err', `✗ Pagos ${co.toUpperCase()}`);
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

// ─────────────────────────────────────────────────────
// MODO B — Saldos (Google Sheet "resumen") + Compromisos (Excel)
// La pestaña "resumen" tiene secciones para cada empresa.
// Se identifica la sección por el nombre de la empresa en col A,
// luego se leen pesos / dólares / cheques dentro de esa sección.
// ─────────────────────────────────────────────────────
const MODOB_CO_LABELS = {
  tfc: /tf.?carnes/i,
  tf:  /trade.?food/i,
};
async function loadModoB(co) {
  const sid = MODOB_SHEET_IDS[co];
  if (!sid) {
    setSt(co, 'modob', '', `Modo B ${co.toUpperCase()}: sin planilla configurada`);
    return;
  }
  setSt(co, 'modob', 'loading', `⏳ Modo B ${co.toUpperCase()}...`);
  try {
    const data = await loadSheetRaw(sid, MODOB_TAB);
    const rows = data.table?.rows || [];
    // Estructura flat: "TF Carnes Pesos", "Trade Food Dolares", "Cheques B TF Carnes", etc.
    let pesos = null, dolares = null, cheques = null;
    const coPattern = MODOB_CO_LABELS[co];
    for (const row of rows) {
      const label = String(row.c?.[0]?.v ?? row.c?.[0]?.f ?? '').trim();
      if (!coPattern.test(label)) continue;
      const val = typeof row.c?.[1]?.v === 'number' ? row.c[1].v : null;
      if (/peso/i.test(label))        pesos   = val ?? pesos;
      if (/dolar|dólar/i.test(label)) dolares = val ?? dolares;
      if (/cheque/i.test(label))      cheques = val ?? cheques;
    }
    st[co].modoB.pesos   = pesos;
    st[co].modoB.dolares = dolares;
    st[co].modoB.cheques = cheques;
    setSt(co, 'modob', 'ok', `✓ Modo B ${co.toUpperCase()}`);
    renderModoB(co);
  } catch(e) {
    console.warn(`[ModoB ${co}]`, e.message);
    setSt(co, 'modob', 'err', `✗ Modo B ${co.toUpperCase()}: ${e.message}`);
  }
}

function loadModoBProvFromStorage() {
  for (const co of ['tfc','tf']) {
    try {
      const raw = localStorage.getItem(`${co}_modob_prov_v1`);
      const ds  = localStorage.getItem(`${co}_modob_prov_date_v1`) || '';
      if (raw) {
        st[co].modoB.provRaw = JSON.parse(raw).map(r => ({...r, fecha: new Date(r.fecha)}));
        const el = document.getElementById(`mb-upload-st-${co}`);
        if (el) { el.textContent = `✓ ${st[co].modoB.provRaw.length} compromisos · ${ds}`; el.className = 'mb-upload-st ok'; }
      }
    } catch(e) { st[co].modoB.provRaw = []; }
  }
}

function onModoBUpload(event, co) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
      const raw = parseProvXLS(wb); // reutiliza el mismo parser de cuentas a pagar
      st[co].modoB.provRaw = raw;
      const ds = new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})
               + ' ' + new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
      localStorage.setItem(`${co}_modob_prov_v1`, JSON.stringify(raw.map(r=>({...r, fecha:r.fecha.toISOString()}))));
      localStorage.setItem(`${co}_modob_prov_date_v1`, ds);
      const el = document.getElementById(`mb-upload-st-${co}`);
      if (el) { el.textContent = `✓ ${raw.length} compromisos · ${ds}`; el.className = 'mb-upload-st ok'; }
      const el2 = document.getElementById(`ust-mb-${co}`);
      if (el2) { el2.textContent = `✓ ${raw.length} compromisos · ${ds}`; el2.className = 'upload-st ok'; }
      renderModoB(co);
      supaReplaceRows('modo_b_compromisos', co, raw.map(r => ({
        company: co, client_id: r.id, fecha: dKey(r.fecha), monto: r.monto, label: r.label
      }))).then(()=>markCloudSync(`mb-upload-st-${co}`,true)).catch(e=>{console.warn('[Supabase]',e.message);markCloudSync(`mb-upload-st-${co}`,false);});
    } catch(err) {
      const el = document.getElementById(`mb-upload-st-${co}`);
      if (el) { el.textContent = `✗ ${err.message}`; el.className = 'mb-upload-st err'; }
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

function renderModoB(co) {
  const mb = st[co].modoB;
  const tbody = document.getElementById(`mb-tbody-${co}`);
  if (!tbody) return;
  const today = new Date(); today.setHours(0,0,0,0);

  // KPIs
  const setMbKpi = (id, val, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val != null ? fN(val) : '—';
    if (cls) el.className = `mb-kpi-value ${cls}`;
  };
  setMbKpi(`mb-kpi-${co}-pesos`,   mb.pesos,   mb.pesos  != null ? 'pos' : '');
  setMbKpi(`mb-kpi-${co}-dolares`, mb.dolares, mb.dolares!= null ? 'pos' : '');
  setMbKpi(`mb-kpi-${co}-cheques`, mb.cheques, mb.cheques!= null ? 'pos' : '');
  const totalDisp = (mb.pesos||0) + (mb.cheques||0);
  setMbKpi(`mb-kpi-${co}-total`,   totalDisp > 0 ? totalDisp : null, totalDisp > 0 ? 'pos' : '');

  // Tabla de compromisos
  const prov = mb.provRaw || [];

  // Buckets por vencimiento (aunque no haya prov, resetear)
  const setMbBucket = (id, val) => {
    const el = document.getElementById(id); if(!el) return;
    if(val > 0){ el.textContent = fN(val); el.className = 'mb-kpi-value neg'; }
    else { el.textContent = '—'; el.className = 'mb-kpi-value'; }
  };
  let vencido=0, d7=0, d15=0, d15plus=0;
  for(const r of prov){
    const dias = r.fecha ? Math.round((r.fecha - today) / (1000*86400)) : null;
    if(dias === null) continue;
    if(dias < 0)       vencido  += r.monto;
    else if(dias <= 7) d7       += r.monto;
    else if(dias <= 15) d15     += r.monto;
    else               d15plus  += r.monto;
  }
  setMbBucket(`mb-kpi-${co}-vencido`,  vencido);
  setMbBucket(`mb-kpi-${co}-d7`,       d7);
  setMbBucket(`mb-kpi-${co}-d15`,      d15);
  setMbBucket(`mb-kpi-${co}-d15plus`,  d15plus);

  if (!prov.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="mb-empty">Subí el Excel de compromisos Modo B (Proveedor | Fecha | Importe)</td></tr>`;
    return;
  }

  const sorted = [...prov].sort((a,b) => a.fecha - b.fecha);
  const total  = sorted.reduce((s,r) => s + r.monto, 0);

  tbody.innerHTML = sorted.map(r => {
    const dias = r.fecha ? Math.round((r.fecha - today) / (1000*86400)) : null;
    const rc   = dias !== null && dias < 0 ? 'overdue-row' : dias !== null && dias <= 7 ? 'soon-row' : '';
    return `<tr class="${rc}">
      <td style="font-weight:500">${r.label || '—'}</td>
      <td>${r.fecha ? r.fecha.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'}</td>
      <td class="r">${daysBadge(dias)}</td>
      <td class="r" style="font-weight:600">${fN(r.monto)}</td>
    </tr>`;
  }).join('')
  + `<tr style="border-top:2px solid #dde3ea;background:#f5f7f9">
      <td colspan="2" style="font-weight:700;padding:7px 10px">TOTAL (${sorted.length} compromisos)</td>
      <td></td>
      <td class="r" style="font-weight:700;color:#f47c7c">${fN(total)}</td>
    </tr>`;
}

// ─────────────────────────────────────────────────────
// COMPROMISOS DE EFECTIVO — FINANCIERA (solo TF Carnes)
// Excel: A=Cliente, B=Fecha entrega efectivo, C=Importe efectivo
// Lógica: cheque bruto = neto / 0.97 (financiera descuenta 3%)
//         cap $70M neto/día → se escalonan hacia días hábiles previos
// ─────────────────────────────────────────────────────
const _finExpanded = new Set(); // fechas expandidas en la vista CFO
const _finPagados  = new Set(); // IDs de compromisos marcados como pagados
let _showFinPagados = false;    // toggle para mostrar pagados

function saveFinPagados(){ try{ localStorage.setItem('tfc_fin_pagados_v1', JSON.stringify([..._finPagados])); }catch(e){} }
function loadFinPagados(){ try{ const r=localStorage.getItem('tfc_fin_pagados_v1'); if(r) JSON.parse(r).forEach(id=>_finPagados.add(id)); }catch(e){} }
function toggleFinPagado(id){ if(_finPagados.has(id)) _finPagados.delete(id); else _finPagados.add(id); saveFinPagados(); renderFinanciera(); }
function marcarDiaPagado(k){
  const comp = (st.tfc.compromisos||[]).filter(c => dKey(c.fechaEntrega)===k);
  const allPagados = comp.every(c => _finPagados.has(c.id));
  comp.forEach(c => allPagados ? _finPagados.delete(c.id) : _finPagados.add(c.id));
  saveFinPagados(); renderFinanciera();
}
function toggleShowFinPagados(){ _showFinPagados = !_showFinPagados; renderFinanciera(); }

const FIN_RATE = 0.03;
const FIN_CAP  = 70_000_000;

// Bancos operativos TFC (para KPIs y CF): Galicia, Macro, CMF
const TFC_OP_BANKS = [/galicia/i, /macro/i, /cmf/i];
const TFC_BAVSA_RE = /bavsa/i;
function tfcOpBancos(){
  const bs = st.tfc.bancos || [];
  const op = bs.filter(b => TFC_OP_BANKS.some(p => p.test(b.nombre)));
  const bavsa = bs.find(b => TFC_BAVSA_RE.test(b.nombre)) || null;
  if(!op.length) return { saldo: st.tfc.saldoBancos, desc: st.tfc.descubiertos, bavsa };
  return {
    saldo: op.reduce((s,b) => s + b.saldo, 0),
    desc:  op.reduce((s,b) => s + b.acuerdo, 0),
    bavsa
  };
}

function loadCompromisosFromStorage() {
  try {
    const raw = localStorage.getItem('tfc_compromisos_v1');
    const ds  = localStorage.getItem('tfc_compromisos_date_v1') || '';
    if (raw) {
      st.tfc.compromisos = JSON.parse(raw).map(r => {
        // fechaVto puede no existir en datos guardados con el formato viejo
        const fechaVto = r.fechaVto ? new Date(r.fechaVto) : null;
        // Siempre recalcular desde fechaVto si está disponible; garantiza +2 días hábiles correctos
        const fechaEntrega = fechaVto
          ? fechaEntregaEfectivo(fechaVto)
          : (r.fechaEntrega ? new Date(r.fechaEntrega) : null);
        return {...r, fechaVto, fechaEntrega};
      }).filter(r => r.fechaEntrega); // descartar registros sin fecha válida
      const el = document.getElementById('fin-upload-st-tfc');
      if (el) { el.textContent = `✓ ${st.tfc.compromisos.length} compromisos · ${ds}`; el.className = 'fin-upload-st ok'; }
    }
  } catch(e) { st.tfc.compromisos = []; }
}

// Calcula la fecha de entrega de efectivo: fecha vencimiento cheque + 2 días hábiles
function fechaEntregaEfectivo(fechaVto) {
  let d = new Date(fechaVto); d.setHours(0,0,0,0);
  let biz = 0;
  while (biz < 2) { d.setDate(d.getDate()+1); if (isBizDay(d)) biz++; }
  return d;
}

function onCompromisosUpload(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, cellDates:true});
      // Detectar si la primera fila es encabezado
      let start = 0;
      const firstRow = (rows[0]||[]).map(c => String(c||'').toLowerCase());
      if (firstRow.some(c => /cliente|fecha|importe|vencimiento/.test(c))) start = 1;
      let idSeq = 0;
      const parsed = [];
      for (let i = start; i < rows.length; i++) {
        const r = rows[i] || [];
        const cliente = String(r[0]||'').trim();
        // Col B: fecha de vencimiento del cheque del cliente
        let fechaVto = r[1] instanceof Date ? new Date(r[1]) : parseFechaAR(String(r[1]||''));
        const importeEfectivo = typeof r[2]==='number' ? r[2]
          : parseFloat(String(r[2]||'').replace(/[^0-9.,-]/g,'').replace(',','.')) || 0;
        if (!cliente || !fechaVto || importeEfectivo <= 0) continue;
        fechaVto.setHours(0,0,0,0);
        // Fecha de entrega = fecha vto + 2 días hábiles
        const fechaEntrega = fechaEntregaEfectivo(fechaVto);
        parsed.push({id:'comp_'+(++idSeq), cliente, fechaVto, fechaEntrega, importeEfectivo});
      }
      if (!parsed.length) throw new Error('No se encontraron filas válidas. Formato: Cliente | Fecha vto. cheque | Importe');
      st.tfc.compromisos = parsed;
      const ds = new Date().toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})
               + ' ' + new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'});
      localStorage.setItem('tfc_compromisos_v1', JSON.stringify(parsed.map(r=>({
        ...r,
        fechaVto: r.fechaVto.toISOString(),
        fechaEntrega: r.fechaEntrega.toISOString()
      }))));
      localStorage.setItem('tfc_compromisos_date_v1', ds);
      const el = document.getElementById('fin-upload-st-tfc');
      const el2 = document.getElementById('ust-fin-tfc');
      if (el)  { el.textContent  = `✓ ${parsed.length} compromisos · ${ds}`; el.className = 'fin-upload-st ok'; }
      if (el2) { el2.textContent = `✓ ${parsed.length} compromisos · ${ds}`; el2.className = 'upload-st ok'; }
      renderFinanciera();
      supaReplaceRows('compromisos_efectivo', null, parsed.map(r => ({
        client_id: r.id, cliente: r.cliente, fecha_vto: dKey(r.fechaVto),
        fecha_entrega: dKey(r.fechaEntrega), importe_efectivo: r.importeEfectivo
      }))).then(()=>markCloudSync('fin-upload-st-tfc',true)).catch(e=>{console.warn('[Supabase]',e.message);markCloudSync('fin-upload-st-tfc',false);});
    } catch(err) {
      const el = document.getElementById('fin-upload-st-tfc');
      if (el) { el.textContent = `✗ ${err.message}`; el.className = 'fin-upload-st err'; }
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

// También sincronizar desde storage al cargar
function _syncFinUploadSt() {
  const raw = localStorage.getItem('tfc_compromisos_v1');
  const ds  = localStorage.getItem('tfc_compromisos_date_v1') || '';
  if (!raw) return;
  try {
    const n = JSON.parse(raw).length;
    const el2 = document.getElementById('ust-fin-tfc');
    if (el2) { el2.textContent = `✓ ${n} compromisos · ${ds}`; el2.className = 'upload-st ok'; }
  } catch(e) {}
}

// Genera el plan de cheques a emitir para cada compromiso,
// respetando el cap de $70M neto/día y escalonando hacia días previos.
function calcPlanFinanciera(compromisos) {
  const plan = [];
  for (const c of compromisos) {
    let remaining = c.importeEfectivo;
    let fecha = new Date(c.fechaEntrega); fecha.setHours(0,0,0,0);
    let iter = 0;
    while (remaining > 1 && iter++ < 30) {
      const neto   = Math.min(remaining, FIN_CAP);
      const bruto  = neto / (1 - FIN_RATE);
      const costo  = bruto - neto;
      plan.push({ fechaCheque: new Date(fecha), bruto, neto, costo,
                  compromisoId: c.id, cliente: c.cliente, fechaEntrega: c.fechaEntrega });
      remaining -= neto;
      if (remaining > 1) {
        // Retroceder un día hábil
        fecha = new Date(fecha); fecha.setDate(fecha.getDate()-1);
        while (!isBizDay(fecha)) fecha.setDate(fecha.getDate()-1);
      }
    }
  }
  plan.sort((a,b) => a.fechaCheque - b.fechaCheque);
  return plan;
}

function renderFinanciera() {
  const compromisos = st.tfc.compromisos || [];
  const tbodyCfo = document.getElementById('fin-tbody-cfo');
  if (!tbodyCfo) return;
  const today = new Date(); today.setHours(0,0,0,0);

  // Separar activos y pagados
  const activos  = compromisos.filter(c => !_finPagados.has(c.id));
  const pagados  = compromisos.filter(c =>  _finPagados.has(c.id));

  const totalEfec  = activos.reduce((s,c) => s + c.importeEfectivo, 0);
  // Costo financiero simple: 3% del efectivo a entregar (no el cálculo con tope de
  // $70M/día que usa calcPlanFinanciera() para el Excel — acá es directo sobre el total).
  const totalCosto = totalEfec * FIN_RATE;
  const totalConCosto = totalEfec + totalCosto;

  document.getElementById('finkpi-n').textContent     = activos.length || '—';
  document.getElementById('finkpi-efec').textContent  = totalEfec > 0  ? fN(totalEfec)  : '—';
  document.getElementById('finkpi-costo').textContent = totalCosto > 0 ? fN(totalCosto) : '—';
  document.getElementById('finkpi-total-costo').textContent = totalConCosto > 0 ? fN(totalConCosto) : '—';

  const emptyMsg5 = '<tr><td colspan="5" class="fin-empty">Subí el Excel de compromisos (Cliente | Fecha vto. cheque | Importe)</td></tr>';

  if (!compromisos.length) {
    tbodyCfo.innerHTML = emptyMsg5;
    return;
  }

  // ── Vista CFO — agrupado por fecha de entrega ──────
  const compOrdenados = [...activos].sort((a,b) => a.fechaEntrega - b.fechaEntrega);

  // Agrupar por fecha de entrega
  const porFecha = {};
  for (const c of compOrdenados) {
    const k = dKey(c.fechaEntrega);
    if (!porFecha[k]) porFecha[k] = {fecha: c.fechaEntrega, items: []};
    porFecha[k].items.push(c);
  }

  const dayNames = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  let htmlCfo = '';
  for (const k of Object.keys(porFecha).sort()) {
    const grupo = porFecha[k];
    const dias = Math.round((grupo.fecha - today) / (1000*86400));
    const totalDia = grupo.items.reduce((s,c)=>s+c.importeEfectivo, 0);
    const allPagadosEnDia = grupo.items.every(c => _finPagados.has(c.id));
    const expanded = _finExpanded.has(k);
    const estadoBadge = dias < 0
      ? `<span class="d-days overdue">Vencido ${Math.abs(dias)}d</span>`
      : dias === 0 ? `<span class="d-days soon">HOY</span>`
      : dias <= 5  ? `<span class="d-days soon">en ${dias}d</span>`
      :               `<span class="d-days ok">en ${dias}d</span>`;
    const rowCls = dias < 0 ? 'overdue-row' : dias <= 5 ? 'soon-row' : '';
    const n = grupo.items.length;
    const dayLabel = `${dayNames[grupo.fecha.getDay()]} ${grupo.fecha.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'})}`;
    const arrow = expanded ? '▼' : '▶';
    const btnPagarDia = `<button onclick="event.stopPropagation();marcarDiaPagado('${k}')" style="font-size:9px;padding:2px 7px;border-radius:4px;border:1px solid #bbb;background:#f5f5f5;color:#555;cursor:pointer;margin-left:6px">${allPagadosEnDia?'↺ Desmarcar':'✓ Pagado'}</button>`;

    // Fila resumen del día (clickable)
    htmlCfo += `<tr class="${rowCls}" style="cursor:pointer;font-weight:700" onclick="toggleFinGroup('${k}')">
      <td style="padding-left:10px"><span style="font-size:10px;color:var(--tfc-primary);margin-right:6px">${arrow}</span>${dayLabel}${btnPagarDia}</td>
      <td style="color:#aaa;font-size:10px;font-weight:400">${n} compromiso${n!==1?'s':''}</td>
      <td></td>
      <td class="r" style="font-size:14px;color:#c0392b">${fN(totalDia)}</td>
      <td>${estadoBadge}</td>
    </tr>`;

    // Filas de detalle (visibles solo si expandido)
    if (expanded) {
      for (const c of grupo.items) {
        const vtoStr = c.fechaVto ? c.fechaVto.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
        const btnPagar = `<button onclick="toggleFinPagado('${c.id}')" style="font-size:9px;padding:2px 7px;border-radius:4px;border:1px solid #bbb;background:#f5f5f5;color:#555;cursor:pointer">✓ Pagado</button>`;
        htmlCfo += `<tr style="background:#f8faf6">
          <td style="padding-left:32px;color:#555;font-size:11px">↳ ${c.cliente}</td>
          <td style="color:#aaa;font-size:10px">Vto. cheque: ${vtoStr}</td>
          <td>${btnPagar}</td>
          <td class="r" style="font-size:12px;font-weight:500">${fN(c.importeEfectivo)}</td>
          <td></td>
        </tr>`;
      }
    }
  }
  // Fila total CFO
  htmlCfo += `<tr style="border-top:2px solid #eee;background:#fafafa">
    <td colspan="3" style="font-weight:700;font-size:11px;padding:7px 10px">TOTAL (${activos.length} compromiso${activos.length!==1?'s':''})</td>
    <td class="r" style="font-weight:700;color:#c0392b;font-size:13px">${fN(totalEfec)}</td>
    <td></td></tr>`;

  // Pagados: mostrar al final si hay y toggle está activo
  if (pagados.length) {
    const btnToggle = `<button onclick="toggleShowFinPagados()" style="font-size:9px;padding:2px 8px;border-radius:4px;border:1px solid #bbb;background:#f5f5f5;color:#888;cursor:pointer">${_showFinPagados?'▲ Ocultar':'▼ Ver'} ${pagados.length} pagado${pagados.length!==1?'s':''}</button>`;
    htmlCfo += `<tr style="background:#f9f9f9"><td colspan="5" style="padding:6px 10px">${btnToggle}</td></tr>`;
    if (_showFinPagados) {
      for (const c of [...pagados].sort((a,b)=>a.fechaEntrega-b.fechaEntrega)) {
        const vtoStr = c.fechaVto ? c.fechaVto.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
        const entStr = c.fechaEntrega ? c.fechaEntrega.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
        htmlCfo += `<tr style="background:#f9f9f9;opacity:.55">
          <td style="padding-left:10px;font-size:11px;text-decoration:line-through;color:#888">${c.cliente}</td>
          <td style="color:#aaa;font-size:10px">Entrega: ${entStr} · Vto: ${vtoStr}</td>
          <td><button onclick="toggleFinPagado('${c.id}')" style="font-size:9px;padding:2px 7px;border-radius:4px;border:1px solid #bbb;background:#fff;color:#888;cursor:pointer">↺ Desmarcar</button></td>
          <td class="r" style="font-size:11px;color:#aaa;text-decoration:line-through">${fN(c.importeEfectivo)}</td>
          <td></td>
        </tr>`;
      }
    }
  }

  tbodyCfo.innerHTML = htmlCfo;
}

// ─────────────────────────────────────────────────────
// CASH FLOW
// ─────────────────────────────────────────────────────
function buildCF(co, days){
  const today=new Date();today.setHours(0,0,0,0);
  const cutoff=new Date(today);cutoff.setDate(cutoff.getDate()-30);
  const nbd=nextBizDay(today);
  const nbdKey=dKey(nbd);
  // Saldo inicial: solo saldo bancos operativos (TFC: Galicia+Macro+CMF; TF: total).
  let saldo = co==='tfc' ? (tfcOpBancos().saldo??0) : (st[co].saldoBancos??0);
  const provItems=getProv(co);
  const provMan=getManuales(co,'prov');
  const cobMan=getManuales(co,'cob');

  // Cartera activa (no adjudicada): se acredita completa en HOY (día 1)
  let cartIngHoy=0;
  for(const c of (st[co].carteraChqs||[])){
    const id=chqStableId(co,'e',c.numero,c.importe||0);
    if(!excl[co].chq.has(id))cartIngHoy+=(c.importe||0);
  }
  for(const c of (st[co].chequesFisicos||[])){
    const id=chqStableId(co,'f',c.numero,c.importe||0);
    if(!excl[co].chq.has(id))cartIngHoy+=(c.importe||0);
  }
  // TFC: el ingreso de HOY es "Fondos disponibles" (Cartera + BAVSA), no solo la cartera —
  // mismo número que la tarjeta KPI "Fondos disponibles".
  if(co==='tfc'){
    const bv=tfcOpBancos().bavsa;
    if(bv)cartIngHoy+=(bv.saldo||0);
  }

  const rows=[];
  for(let i=0;i<days;i++){
    const d=new Date(today);d.setDate(d.getDate()+i);
    const key=dKey(d);
    let egChq=0,egProv=0,ing=0;
    if(i===0){
      // Cartera: se acredita hoy
      ing+=cartIngHoy;
      // Hoy: los cheques emitidos ya fueron debitados en el sistema → no van aquí
      for(const p of provItems)if(p.fecha<=today)egProv+=p.monto;
      for(const m of provMan)if(m.date<=today)egProv+=m.importe;
      for(const m of cobMan)if(m.date<=today)ing+=m.importe;
    }else{
      for(const c of st[co].chequesEmitidos){
        if(key===nbdKey){
          if((c.debitDate<=today&&c.paymentDate>=cutoff)||dKey(c.debitDate)===key)egChq+=c.importe;
        }else{
          if(dKey(c.debitDate)===key)egChq+=c.importe;
        }
      }
      for(const p of provItems)if(p.fecha&&dKey(p.fecha)===key)egProv+=p.monto;
      for(const m of provMan)if(dKey(m.date)===key)egProv+=m.importe;
      for(const m of cobMan)if(dKey(m.date)===key)ing+=m.importe;
    }
    const saldoFin=saldo-egChq-egProv+ing;
    const isWknd=d.getDay()===0||d.getDay()===6;const isHol=FERIADOS.has(key);
    rows.push({d,key,saldoInicio:saldo,egChq,egProv,ing,saldoFin,isDay1:i===0,isWknd,isHol,hasActivity:egChq||egProv||ing});
    saldo=saldoFin;
  }
  return rows;
}

// ─────────────────────────────────────────────────────
// RENDERING
// ─────────────────────────────────────────────────────
function renderKPIs(co){
  const s=st[co];
  // Para TFC: solo bancos operativos (Galicia, Macro, CMF)
  let bancos, desc;
  if(co==='tfc'){
    const op=tfcOpBancos();
    bancos=op.saldo; desc=op.desc;
    // BAVSA + Total
    const eBavsa=document.getElementById('kpi-tfc-bavsa');
    const bv=op.bavsa;
    if(eBavsa){
      eBavsa.textContent=bv!=null?fN(bv.saldo):'—';
      eBavsa.className='kpi-value'+(bv==null?'':bv.saldo>=0?' pos':' neg');
      eBavsa.style.fontSize='14px';
    }
  } else {
    bancos=s.saldoBancos; desc=s.descubiertos;
  }
  const disp=(bancos!=null&&desc!=null)?bancos+desc:(bancos!=null?bancos:null);

  const eb=document.getElementById(`kpi-${co}-bancos`);
  eb.textContent=bancos!=null?fN(bancos):'—';
  eb.className='kpi-value'+(bancos==null?'':bancos>=0?' pos':' neg');

  document.getElementById(`kpi-${co}-fecha`).textContent=
    s.xlsmDate?s.xlsmDate.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}):'—';

  const ed=document.getElementById(`kpi-${co}-desc`);
  ed.textContent=desc!=null?fN(desc):'—';
  ed.className='kpi-value'+(desc==null?'':' pos');

  const eDisp=document.getElementById(`kpi-${co}-disp`);
  eDisp.textContent=disp!=null?fN(disp):'—';
  eDisp.className='kpi-value'+(disp==null?'':disp>=0?' pos':' neg');
  const eDSub=document.getElementById(`kpi-${co}-disp-sub`);
  if(bancos!=null&&bancos<0&&desc!=null){
    eDSub.textContent=`Desc. usado: ${fN(Math.abs(bancos))}`;
  } else { eDSub.textContent=''; }

  // Cartera: recalcular excluyendo adjudicados
  const rawElec = JSON.parse(localStorage.getItem(`${co}_cheques_v2`)||'[]');
  const fisicos = s.chequesFisicos||[];
  let cartActElec=0, nActElec=0, nExclElec=0;
  rawElec.forEach(r=>{
    const id=chqStableId(co,'e',r.numero,r.importe||0);
    if(excl[co].chq.has(id)){nExclElec++;}else{cartActElec+=r.importe||0;nActElec++;}
  });
  let cartActFis=0, nActFis=0, nExclFis=0;
  fisicos.forEach(r=>{
    const id=chqStableId(co,'f',r.numero,r.importe||0);
    if(excl[co].chq.has(id)){nExclFis++;}else{cartActFis+=r.importe||0;nActFis++;}
  });
  const totalCartera=cartActElec+cartActFis;
  const totalNChq=nActElec+nActFis;
  const totalExcl=nExclElec+nExclFis;
  document.getElementById(`kpi-${co}-cartera`).textContent=totalCartera>0?fN(totalCartera):'—';
  const chqLabel=totalNChq?`${nActElec} elect.${nActFis?` + ${nActFis} fís.`:''}${totalExcl?` (${totalExcl} adj.)`:''}` : '—';
  document.getElementById(`kpi-${co}-nchq`).textContent=chqLabel;
  // Total cartera + BAVSA como sub de BAVSA (solo TFC)
  if(co==='tfc'){
    const eTotal=document.getElementById('kpi-tfc-cartera-total');
    if(eTotal){
      const op=tfcOpBancos();
      const bavsaSaldo=op.bavsa!=null?op.bavsa.saldo:0;
      const tot=totalCartera+bavsaSaldo;
      eTotal.textContent=fN(tot);
      eTotal.className='kpi-value pos';
    }
  }

  // Chq emitidos total
  const totalEmitidos=s.chequesEmitidos.reduce((sum,c)=>sum+c.importe,0);
  const nEmitidos=s.chequesEmitidos.length;
  document.getElementById(`kpi-${co}-emitidos`).textContent=nEmitidos?fN(totalEmitidos):'—';
  document.getElementById(`kpi-${co}-nemitidos`).textContent=nEmitidos?`${nEmitidos} cheques`:'—';

  // Cuentas a pagar total (activos = no excluidos)
  const activoProv=s.provRaw.filter(r=>!excl[co].prov.has(r.id));
  const totalCPagar=activoProv.reduce((sum,r)=>sum+r.monto,0);
  document.getElementById(`kpi-${co}-cpagar`).textContent=activoProv.length?fN(totalCPagar):'—';
  document.getElementById(`kpi-${co}-ncpagar`).textContent=activoProv.length?`${activoProv.length} ítems`:'—';
}

let _coTab='tfc';
function switchCoTab(co){
  _coTab=co;
  document.getElementById('co-panel-tfc').style.display=co==='tfc'?'':'none';
  document.getElementById('co-panel-tf').style.display=co==='tf'?'':'none';
  document.getElementById('cosw-tfc').classList.toggle('active',co==='tfc');
  document.getElementById('cosw-tf').classList.toggle('active',co==='tf');
  // actualizar fondo de página según empresa activa
  document.body.style.background=co==='tfc'?'#EDEAE3':'#EDE8DC';
  // sincronizar detalle con la empresa activa
  document.getElementById('df-empresa').value=co;
  _dSel.clear();
  renderDetail();
}
function renderTable(co,days){
  const rows=buildCF(co,days);let html='';
  for(const r of rows){
    if((r.isWknd||r.isHol)&&!r.hasActivity&&!r.isDay1)continue;
    const rc=r.isDay1?'day1':r.isHol?'feriado':r.isWknd?'weekend':'';
    const prefix=r.isDay1?'HOY · ':'';const holLabel=r.isHol?'<span class="dsub">feriado</span>':'';
    html+=`<tr class="${rc}">
      <td><span class="dlabel">${prefix}${fDateLabel(r.d)}</span>${holLabel}</td>
      <td class="${r.saldoInicio>=0?'pos':'neg'}">${fN(r.saldoInicio)}</td>
      <td class="${r.egChq?'neg':'zero'}">${r.egChq?fN(-r.egChq):'—'}</td>
      <td class="${r.egProv?'neg':'zero'}">${r.egProv?fN(-r.egProv):'—'}</td>
      <td class="${r.ing?'pos':'zero'}">${r.ing?fN(r.ing):'—'}</td>
      <td class="${r.saldoFin>=0?'pos':'neg'}">${fN(r.saldoFin)}</td>
      <td style="font-weight:600;${(r.saldoFin+(co==='tfc'?tfcOpBancos().desc:st[co].descubiertos||0))>=0?'color:#1a7a40':'color:#c0392b'}">${fN(r.saldoFin+(co==='tfc'?tfcOpBancos().desc:st[co].descubiertos||0))}</td>
    </tr>`;
  }
  if(!html)html=`<tr><td colspan="7" class="no-data">Sin datos suficientes para proyectar</td></tr>`;
  document.getElementById(`tbody-${co}`).innerHTML=html;
}
function renderAll(){
  renderKPIs('tfc');renderKPIs('tf');renderTable('tfc',horizon);renderTable('tf',horizon);
  updateCobStatus('tfc');updateCobStatus('tf');
  if(_panelOpen)renderPanelBody();
  renderDetail();
  renderFinanciera();
  renderModoB('tfc');renderModoB('tf');
}
function updateCobStatus(co){
  const mans=getManuales(co,'cob');
  const el=document.getElementById(`ust-cob-${co}`);
  if(mans.length===0){el.textContent='Sin ingresos ingresados';el.className='upload-st';}
  else{const t=mans.reduce((s,m)=>s+m.importe,0);el.textContent=`✓ ${mans.length} entradas · $${fN(t)}`;el.className='upload-st ok';}
}
function updateProvBtn(co){
  const btn=document.getElementById(`btn-rev-prov-${co}`);if(!btn)return;
  const n=st[co].provRaw.length;const nexcl=excl[co].prov.size;const on=srcOn[co].prov;
  if(!on){btn.textContent='⊘ Desactivado';btn.classList.add('off-src');}
  else if(nexcl>0){btn.textContent=`✎ Revisar (${nexcl} excl.)`;btn.classList.remove('off-src');}
  else{btn.textContent=`✎ Revisar (${n})`;btn.classList.remove('off-src');}
}

// ─────────────────────────────────────────────────────
// PANEL
// ─────────────────────────────────────────────────────
let _panelOpen=false,_panelCo=null,_panelType=null;
const NAMES={tfc:'TF Carnes',tf:'Trade Food'};

function openPanel(co,type){
  _panelCo=co;_panelType=type;_panelOpen=true;_panelSel=new Set();
  const typeNames={cob:'Ingresos esperados',prov:'Pagos a proveedores'};
  document.getElementById('ov-title').textContent=`${typeNames[type]} · ${NAMES[co]}`;
  renderPanelBody();
  document.getElementById('ov-overlay').classList.add('open');
  document.getElementById('ov-panel').classList.add('open');
}
function closePanel(){
  _panelOpen=false;
  document.getElementById('ov-overlay').classList.remove('open');
  document.getElementById('ov-panel').classList.remove('open');
}

function renderPanelBody(){
  const co=_panelCo,type=_panelType;
  if(!co||!type)return;
  if(type==='cob'){renderCobPanel(co);}
  else{renderProvPanel(co);}
}

// ── Panel de Ingresos (solo manual) ──────────────────
function renderCobPanel(co){
  const mans=getManuales(co,'cob');
  const total=mans.reduce((s,m)=>s+m.importe,0);
  const color=co==='tfc'?'#506E3E':'#630000';
  let html=`<div class="man-section" style="flex:1;border-top:none">
    <div class="man-sec-hdr">Agregar ingreso esperado</div>
    <div class="man-form">
      <input type="date" id="man-date" placeholder="Fecha">
      <input type="text" id="man-label" placeholder="Descripción (cliente, concepto…)">
      <input type="number" id="man-importe" placeholder="Monto" step="1" min="0">
      <button class="btn-add-man" onclick="addManual()">+ Agregar</button>
    </div>
    <p class="ov-note">Ingresá el monto que esperás cobrar en esa fecha.</p>`;

  if(mans.length>0){
    html+=`<div style="margin-top:12px;border:1px solid #eee;border-radius:6px;overflow:hidden">`;
    for(const m of [...mans].sort((a,b)=>a.date-b.date)){
      html+=`<div class="man-list-item">
        <span class="man-d">${fDateShort(m.date)}</span>
        <span class="man-l">${m.label||'—'}</span>
        <span class="man-a" style="color:${color}">${fN(m.importe)}</span>
        <button class="btn-rm-man" onclick="removeManual(${m.id})" title="Eliminar">×</button>
      </div>`;
    }
    html+=`</div>`;
    html+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid #eee">
      <span style="font-size:11px;color:#888">Total ingresos ingresados</span>
      <span style="font-size:14px;font-weight:700;color:${color}">${fN(total)}</span>
    </div>`;
  } else {
    html+=`<div style="margin-top:16px;text-align:center;color:#ccc;font-size:11px;padding:20px">Sin ingresos ingresados aún.</div>`;
  }
  html+=`</div>`;
  document.getElementById('ov-body').innerHTML=html;
}

// ── Panel de Pagos (multi-select, 60d atrás + horizonte) ─
function renderProvPanel(co){
  const today=new Date();today.setHours(0,0,0,0);
  const panelStart=new Date(today);panelStart.setDate(panelStart.getDate()-60);
  const panelEnd=new Date(today);panelEnd.setDate(panelEnd.getDate()+horizon);

  const all=st[co].provRaw.filter(r=>{
    const f=new Date(r.fecha);f.setHours(0,0,0,0);
    return f>=panelStart && f<=panelEnd;
  }).sort((a,b)=>a.fecha-b.fecha);

  const exclSet=excl[co].prov;
  const isOn=srcOn[co].prov;
  const color=co==='tfc'?'#506E3E':'#630000';

  // Selected sum
  const selItems=all.filter(r=>_panelSel.has(r.id));
  const selSum=selItems.reduce((s,r)=>s+r.monto,0);
  const selHasExcl=selItems.some(r=>exclSet.has(r.id));
  const selHasActive=selItems.some(r=>!exclSet.has(r.id));

  // Active total
  const activeTotal=all.filter(r=>!exclSet.has(r.id)).reduce((s,r)=>s+r.monto,0);
  const rawTotal=all.reduce((s,r)=>s+r.monto,0);

  const mans=getManuales(co,'prov');
  const manTotal=mans.reduce((s,m)=>s+m.importe,0);

  // All-select state
  const allActive=all.filter(r=>!exclSet.has(r.id));
  const allSelectable=allActive.length>0;
  const allSelected=allActive.every(r=>_panelSel.has(r.id))&&allActive.length>0;

  let html=``;

  // Source toggle
  html+=`<div class="src-bar">
    <span class="src-bar-lbl">Datos del sistema</span>
    <div class="src-toggle">
      <button class="src-btn${isOn?' active':''}" onclick="setProvSrcOn(true)">✓ Activo</button>
      <button class="src-btn${!isOn?' active danger':''}" onclick="setProvSrcOn(false)">✗ Desactivar</button>
    </div>
  </div>`;

  // Bulk bar
  const bulkHidden=_panelSel.size===0;
  html+=`<div class="bulk-bar${bulkHidden?' hidden':''}" id="bulk-bar">
    <div class="bulk-info">
      ${_panelSel.size} seleccionado${_panelSel.size!==1?'s':''} ·
      <span>$${fN(selSum)}</span>
    </div>
    <div class="bulk-actions">
      ${selHasActive?`<button class="btn-bulk btn-excl" onclick="bulkExclude()">Excluir seleccionados</button>`:''}
      ${selHasExcl?`<button class="btn-bulk btn-restore" onclick="bulkRestore()">Restaurar seleccionados</button>`:''}
      <button class="btn-bulk btn-clear-sel" onclick="clearSel()">Limpiar</button>
    </div>
  </div>`;

  // Items table
  html+=`<div class="items-wrap"><table class="items-table">
    <thead><tr>
      <th class="td-chk"><input type="checkbox" ${allSelected?'checked':''} ${!allSelectable?'disabled':''} onchange="toggleSelAll(this.checked)" title="Seleccionar todos los activos"></th>
      <th>Fecha</th>
      <th>Descripción</th>
      <th class="r">Importe</th>
      <th></th>
    </tr></thead>
    <tbody>`;

  if(all.length===0){
    html+=`<tr><td colspan="5" class="items-empty">No hay comprobantes en el período (últimos 60 días + ${horizon} días).</td></tr>`;
  } else {
    // Section headers: overdue vs upcoming
    let inOverdue=false,inUpcoming=false;
    for(const r of all){
      const f=new Date(r.fecha);f.setHours(0,0,0,0);
      const isOverdue=f<today;
      const isExcl=exclSet.has(r.id);
      const isSel=_panelSel.has(r.id);

      if(isOverdue&&!inOverdue){
        inOverdue=true;
        html+=`<tr><td colspan="5" class="section-divider">⚠ Vencidos (van al siguiente día hábil)</td></tr>`;
      }
      if(!isOverdue&&!inUpcoming){
        inUpcoming=true;
        if(inOverdue) html+=`<tr><td colspan="5" class="section-divider">Próximos ${horizon} días</td></tr>`;
        else html+=`<tr><td colspan="5" class="section-divider">Próximos ${horizon} días</td></tr>`;
      }

      html+=`<tr class="${isExcl?'excl-row':''} ${isSel&&!isExcl?'sel-row':''}">
        <td class="td-chk"><input type="checkbox" ${isSel?'checked':''} onchange="toggleSel('${r.id}',this.checked)"></td>
        <td class="td-date${isOverdue&&!isExcl?' overdue':''}">${fDateShort(r.fecha)}${isOverdue&&!isExcl?'<span class="tag-overdue">V</span>':''}</td>
        <td class="td-desc" title="${r.label||''}">${r.label||'<span style="color:#ccc">—</span>'}</td>
        <td class="td-amt r">${fN(r.monto)}</td>
        <td class="td-rm"><button class="btn-rm" onclick="toggleExclSingle('${r.id}')" title="${isExcl?'Restaurar':'Excluir'}">${isExcl?'↩':'×'}</button></td>
      </tr>`;
    }
  }
  html+=`</tbody></table></div>`;

  // Footer: totals
  html+=`<div class="ov-footer">
    <div class="foot-line"><span>Total período (${all.length} ítems)</span><span class="foot-val">$${fN(rawTotal)}</span></div>
    <div class="foot-line"><span>Activo (${all.filter(r=>!exclSet.has(r.id)).length} ítems)</span><span class="foot-val" style="color:${color}">$${fN(activeTotal)}</span></div>
    ${mans.length>0?`<div class="foot-line"><span>Ajustes manuales (${mans.length})</span><span class="foot-val">$${fN(manTotal)}</span></div>`:''}
    <div class="foot-line" style="padding-top:6px;border-top:1px solid #eee;margin-top:2px">
      <span style="font-weight:600">Total al cash flow</span>
      <span class="foot-val primary">$${fN((isOn?activeTotal:0)+manTotal)}</span>
    </div>
  </div>`;

  // Manual entries section
  html+=`<div class="man-section">
    <div class="man-sec-hdr">Ajustes manuales de pagos</div>
    <div class="man-form">
      <input type="date" id="man-date" placeholder="Fecha">
      <input type="text" id="man-label" placeholder="Descripción (opcional)">
      <input type="number" id="man-importe" placeholder="Monto" step="1" min="0">
      <button class="btn-add-man" onclick="addManual()">+ Agregar</button>
    </div>
    <p class="ov-note">Pagos confirmados que no están en el sistema.</p>`;
  if(mans.length>0){
    html+=`<div style="margin-top:7px;border:1px solid #eee;border-radius:6px;overflow:hidden">`;
    for(const m of [...mans].sort((a,b)=>a.date-b.date)){
      html+=`<div class="man-list-item">
        <span class="man-d">${fDateShort(m.date)}</span>
        <span class="man-l">${m.label||'—'}</span>
        <span class="man-a neg-a">-${fN(m.importe)}</span>
        <button class="btn-rm-man" onclick="removeManual(${m.id})">×</button>
      </div>`;
    }
    html+=`</div>`;
  }
  html+=`</div>`;

  document.getElementById('ov-body').innerHTML=html;
}

// ─────────────────────────────────────────────────────
// PANEL ACTIONS
// ─────────────────────────────────────────────────────
function toggleSel(id,checked){if(checked)_panelSel.add(id);else _panelSel.delete(id);renderPanelBody();}
function toggleSelAll(checked){
  const co=_panelCo;const today=new Date();today.setHours(0,0,0,0);
  const panelStart=new Date(today);panelStart.setDate(panelStart.getDate()-60);
  const panelEnd=new Date(today);panelEnd.setDate(panelEnd.getDate()+horizon);
  const active=st[co].provRaw.filter(r=>{const f=new Date(r.fecha);f.setHours(0,0,0,0);return f>=panelStart&&f<=panelEnd&&!excl[co].prov.has(r.id);});
  if(checked)active.forEach(r=>_panelSel.add(r.id));else _panelSel.clear();
  renderPanelBody();
}
function clearSel(){_panelSel.clear();renderPanelBody();}
function bulkExclude(){
  const co=_panelCo;
  _panelSel.forEach(id=>{if(!excl[co].prov.has(id))excl[co].prov.add(id);});
  _panelSel.clear();saveOverrides();updateProvBtn(co);renderAll();
}
function bulkRestore(){
  const co=_panelCo;
  _panelSel.forEach(id=>excl[co].prov.delete(id));
  _panelSel.clear();saveOverrides();updateProvBtn(co);renderAll();
}
function toggleExclSingle(id){
  const co=_panelCo;
  if(excl[co].prov.has(id))excl[co].prov.delete(id);else excl[co].prov.add(id);
  _panelSel.delete(id);saveOverrides();updateProvBtn(co);renderAll();
}
function setProvSrcOn(on){srcOn[_panelCo].prov=on;saveOverrides();updateProvBtn(_panelCo);renderAll();}
function addManual(){
  const dateVal=document.getElementById('man-date').value;
  const label=document.getElementById('man-label').value.trim();
  const importeVal=parseFloat(document.getElementById('man-importe').value);
  if(!dateVal||isNaN(importeVal)||importeVal<=0){alert('Completá fecha y monto.');return;}
  const p=dateVal.split('-');
  manuals.push({id:++_manId,co:_panelCo,type:_panelType,date:new Date(+p[0],+p[1]-1,+p[2]),importe:importeVal,label});
  document.getElementById('man-date').value='';
  document.getElementById('man-label').value='';
  document.getElementById('man-importe').value='';
  saveOverrides();renderAll();
}
function removeManual(id){manuals=manuals.filter(m=>m.id!==id);saveOverrides();renderAll();}

// ─────────────────────────────────────────────────────
// STATUS / UPLOAD HELPERS
// ─────────────────────────────────────────────────────
function setSt(co,type,state,text){
  const bar=document.getElementById('status-bar');
  const id=`gst-${co}-${type}`;let el=document.getElementById(id);
  if(!el){el=document.createElement('span');el.id=id;bar.appendChild(el);}
  el.className='st-item'+(state==='ok'?' st-ok':state==='err'?' st-err':state==='loading'?' st-loading':'');
  el.textContent=text;
}
function setUploadSt(stId,zoneId,state,text){
  const el=document.getElementById(stId);const zone=document.getElementById(zoneId);
  if(el){el.textContent=text;el.className='upload-st'+(state==='ok'?' ok':state==='err'?' err':'');}
  if(zone)zone.classList.toggle('loaded',state==='ok');
}

// ─────────────────────────────────────────────────────
// HORIZON
// ─────────────────────────────────────────────────────
function setHorizon(days,btn){
  horizon=days;
  document.querySelectorAll('.h-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
}

// ─────────────────────────────────────────────────────
// EXPORTACIÓN — Excel y PDF
// ─────────────────────────────────────────────────────
function exportExcel() {
  const co = _coTab;
  const coName = co==='tfc' ? 'TF Carnes' : 'Trade Food';
  const s = st[co];
  const today = new Date();
  const todayStr = today.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'});
  const wb = XLSX.utils.book_new();

  // ── Hoja 1: Resumen KPIs ──
  const fisicos = s.chequesFisicos||[];
  const totalCartera = s.cartera + fisicos.reduce((a,c)=>a+c.importe,0);
  const totalNChq = s.nChq + fisicos.length;
  const activoProv = s.provRaw.filter(r=>!excl[co].prov.has(r.id));
  const totalCPagar = activoProv.reduce((a,r)=>a+r.monto,0);
  const totalEmitidos = s.chequesEmitidos.reduce((a,c)=>a+c.importe,0);
  const disp = (s.saldoBancos!=null&&s.descubiertos!=null) ? s.saldoBancos+s.descubiertos : (s.saldoBancos??null);
  const kpiData = [
    ['Reporte de Tesorería — '+coName],
    ['Generado el '+todayStr],
    [],
    ['Indicador','Valor'],
    ['Saldo bancos', s.saldoBancos??''],
    ['Acuerdos descubierto', s.descubiertos??''],
    ['Disponible para operar', disp??''],
    ['Cartera cheques ('+totalNChq+' chq)', totalCartera],
    ['Cheques emitidos (total)', totalEmitidos],
    ['Cuentas a pagar', totalCPagar],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(kpiData), 'Resumen');

  // ── Hoja 2: Cash Flow ──
  const cfRows = buildCF(co, horizon);
  const cfData = [['Fecha','Día','Saldo inicio','Chq emitidos','Pagos','Ingresos','Saldo fin','Disponible']];
  cfRows.forEach(r=>{
    cfData.push([
      r.d.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}),
      r.isDay1?'HOY':r.isHol?'Feriado':r.isWknd?'Fin de semana':'',
      r.saldoInicio,
      r.egChq ? -r.egChq : 0,
      r.egProv ? -r.egProv : 0,
      r.ing || 0,
      r.saldoFin,
      r.saldoFin+(s.descubiertos||0)
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cfData), 'Cash Flow');

  // ── Hoja 3: Cartera de Cheques ──
  // Combinar electrónicos + físicos
  const rawXLS = JSON.parse(localStorage.getItem(`${co}_cheques_v2`)||'[]');
  const carteraData = [['N° Cheque','Tipo','Recibido de','Librador','CUIT','Fecha cobro','Días','Importe']];
  [...rawXLS.map(r=>({...r,_source:'Electrónico'})), ...fisicos.map(r=>({...r,_source:'Físico',razonSocial:r.razonSocial}))].forEach(r=>{
    const f = r.fechaPago ? new Date(r.fechaPago) : null;
    const dias = f ? Math.round((f-today)/(1000*86400)) : '';
    carteraData.push([r.numero||'',r._source,r.recibidoDe||'',r.razonSocial||'',r.cuitLibrador||r.cuitRecibido||'',f?f.toLocaleDateString('es-AR'):'',dias,r.importe||0]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(carteraData), 'Cartera Cheques');

  // ── Hoja 4: Cuentas a Pagar ──
  const provData = [['Proveedor','Fecha vto.','Días','Importe','Estado']];
  activoProv.forEach(r=>{
    const f = r.fecha ? new Date(r.fecha) : null;
    const dias = f ? Math.round((f-today)/(1000*86400)) : '';
    const estado = typeof dias==='number' ? (dias<0?'Vencido':dias<=7?'Por vencer':'OK') : '';
    provData.push([r.label||'',f?f.toLocaleDateString('es-AR'):'',dias,r.monto||0,estado]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(provData), 'Cuentas a Pagar');

  // ── Hoja 5: Compromisos Efectivo / Plan Financiera (solo TFC) ──
  if (co === 'tfc' && (s.compromisos||[]).length > 0) {
    const plan = calcPlanFinanciera(s.compromisos);
    const finData = [['Cliente','Vto. cheque cliente','Fecha entrega efectivo','Efectivo a entregar','N° Cheque a financiera','Fecha emisión a financiera','Importe bruto','Neto recibido','Costo (3%)']];
    const byComp = {};
    for (const p of plan) { (byComp[p.compromisoId]=byComp[p.compromisoId]||[]).push(p); }
    s.compromisos.forEach(c => {
      const items = (byComp[c.id]||[]).sort((a,b)=>a.fechaCheque-b.fechaCheque);
      items.forEach((p,i) => {
        finData.push([
          c.cliente,
          c.fechaVto ? c.fechaVto.toLocaleDateString('es-AR') : '',
          c.fechaEntrega.toLocaleDateString('es-AR'),
          c.importeEfectivo,
          `${i+1}/${items.length}`,
          p.fechaCheque.toLocaleDateString('es-AR'),
          Math.round(p.bruto*100)/100,
          Math.round(p.neto*100)/100,
          Math.round(p.costo*100)/100
        ]);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(finData), 'Compromisos Efectivo');
  }

  const fname = `Tesoreria_${coName.replace(/\s/g,'_')}_${todayStr.replace(/\//g,'-')}.xlsx`;
  XLSX.writeFile(wb, fname);
}

function exportPDF() {
  window.print();
}

// ─────────────────────────────────────────────────────
// INIT / REFRESH
// ─────────────────────────────────────────────────────
async function refresh(){
  const btn=document.getElementById('btn-refresh');
  btn.disabled=true;btn.textContent='↺ Cargando...';
  loadCarteraFromStorage();
  loadProvFromStorage();
  loadModoBProvFromStorage();
  await Promise.all([loadTesoreria('tfc'), loadTesoreria('tf'), loadChequesFisicos('tfc'), loadChequesFisicos('tf'), loadModoB('tfc'), loadModoB('tf')]);
  renderAll();
  btn.disabled=false;btn.textContent='↺ Actualizar';
}

// ─────────────────────────────────────────────────────
// SECCIÓN DETALLE — Cartera & Pagos
// ─────────────────────────────────────────────────────
let _dTab = 'cartera';           // tab activa
let _dSort = {col:null, dir:1};  // columna y dirección de sort
let _dSel = new Set();           // IDs seleccionados

function switchDTab(tab) {
  _dTab = tab; _dSel.clear();
  document.getElementById('dtab-cartera').classList.toggle('active', tab==='cartera');
  document.getElementById('dtab-pagos').classList.toggle('active', tab==='pagos');
  document.getElementById('df-search').placeholder = tab==='cartera' ? 'Buscar librador…' : 'Buscar proveedor…';
  _dSort = {col:null, dir:1};
  renderDetail();
}

function clearDFilters() {
  document.getElementById('df-empresa').value = '';
  document.getElementById('df-search').value = '';
  document.getElementById('df-desde').value = '';
  document.getElementById('df-hasta').value = '';
  renderDetail();
}

function clearDSel() { _dSel.clear(); renderDetail(); }

function toggleDSel(id, chk) { if(chk) _dSel.add(id); else _dSel.delete(id); renderDetail(); }
function toggleDSelAll(chk, ids) {
  if(chk) ids.forEach(id=>_dSel.add(id)); else ids.forEach(id=>_dSel.delete(id));
  renderDetail();
}

function sortDetail(col) {
  if (_dSort.col===col) _dSort.dir *= -1;
  else { _dSort.col=col; _dSort.dir=1; }
  renderDetail();
}

// ID estable para cheque en cartera (sobrevive re-carga del Excel)
function chqStableId(co, source, numero, importe) {
  return `${co}_${source}_${String(numero).replace(/\s/g,'')}_${Math.round(importe)}`;
}

function getCarteraRows(includeExcluded) {
  const co = document.getElementById('df-empresa').value;
  const q  = document.getElementById('df-search').value.trim().toLowerCase();
  const desde = document.getElementById('df-desde').value;
  const hasta = document.getElementById('df-hasta').value;
  const today = new Date(); today.setHours(0,0,0,0);
  const cos = co ? [co] : ['tfc','tf'];
  let rows = [];
  for (const c of cos) {
    // Cheques electrónicos (XLS banco)
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
    // Cheques físicos (Google Sheet)
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
  }
  // Filtrar excluidos (salvo que se pida verlos)
  if (!includeExcluded) rows = rows.filter(r => !r.excluido);
  // Filtros de UI
  if (q) rows = rows.filter(r=>(r.librador+r.recibidoDe+r.numero+r.cuit).toLowerCase().includes(q));
  if (desde) rows = rows.filter(r=>r.fecha && r.fecha >= new Date(desde));
  if (hasta) { const h=new Date(hasta); h.setHours(23,59,59); rows=rows.filter(r=>r.fecha&&r.fecha<=h); }
  // Sort
  const {col,dir} = _dSort;
  if (col) rows.sort((a,b)=>{
    let va=a[col],vb=b[col];
    if(va instanceof Date&&vb instanceof Date) return dir*(va-vb);
    if(typeof va==='number'&&typeof vb==='number') return dir*(va-vb);
    return dir*String(va||'').localeCompare(String(vb||''));
  });
  else rows.sort((a,b)=>{ // default: fecha asc
    if(!a.fecha) return 1; if(!b.fecha) return -1; return a.fecha-b.fecha;
  });
  return rows;
}

function getProvRows() {
  const co = document.getElementById('df-empresa').value;
  const q  = document.getElementById('df-search').value.trim().toLowerCase();
  const desde = document.getElementById('df-desde').value;
  const hasta = document.getElementById('df-hasta').value;
  const today = new Date(); today.setHours(0,0,0,0);
  const cos = co ? [co] : ['tfc','tf'];
  let rows = [];
  for (const c of cos) {
    const raw = JSON.parse(localStorage.getItem(`${c}_prov_v1`) || '[]');
    raw.forEach((r,i) => {
      const fecha = r.fecha ? new Date(r.fecha) : null;
      if (fecha) fecha.setHours(0,0,0,0);
      const dias = fecha ? Math.round((fecha-today)/(1000*86400)) : null;
      const excluido = excl[c].prov.has(r.id);
      rows.push({
        _id: `${c}_${i}`, _co: c, _provId: r.id,
        proveedor: r.label||'', fecha, fechaStr: fecha?fDateShort(fecha):'—',
        dias, importe: r.monto||0, excluido
      });
    });
  }
  if (q) rows = rows.filter(r=>r.proveedor.toLowerCase().includes(q));
  if (desde) rows = rows.filter(r=>r.fecha && r.fecha >= new Date(desde));
  if (hasta) { const h=new Date(hasta); h.setHours(23,59,59); rows=rows.filter(r=>r.fecha&&r.fecha<=h); }
  const {col,dir} = _dSort;
  if (col) rows.sort((a,b)=>{
    let va=a[col],vb=b[col];
    if(va instanceof Date&&vb instanceof Date) return dir*(va-vb);
    if(typeof va==='number'&&typeof vb==='number') return dir*(va-vb);
    return dir*String(va||'').localeCompare(String(vb||''));
  });
  else rows.sort((a,b)=>{ if(!a.fecha)return 1;if(!b.fecha)return -1;return a.fecha-b.fecha; });
  return rows;
}

function daysBadge(dias) {
  if (dias===null) return '<span class="d-days" style="background:#f5f5f5;color:#bbb">—</span>';
  if (dias < 0)  return `<span class="d-days overdue">${dias}d</span>`;
  if (dias <= 7) return `<span class="d-days soon">${dias}d</span>`;
  return `<span class="d-days ok">${dias}d</span>`;
}
function coBadge(co) {
  return co==='tfc'
    ? '<span class="badge-co-tfc">TFC</span>'
    : '<span class="badge-co-tf">TF</span>';
}

function thSort(col, label, cls='') {
  const sorted = _dSort.col===col;
  const sc = sorted ? (_dSort.dir===1?'sorted-asc':'sorted-desc') : '';
  return `<th class="${sc} ${cls}" onclick="sortDetail('${col}')">${label}</th>`;
}

function renderDetail() {
  const thead = document.getElementById('detail-thead');
  const tbody = document.getElementById('detail-tbody');
  const today = new Date(); today.setHours(0,0,0,0);

  if (_dTab === 'cartera') {
    const rows = getCarteraRows(_showExclChq);
    const activeRows = rows.filter(r=>!r.excluido);
    const exclRows   = rows.filter(r=>r.excluido);
    const selRows    = activeRows.filter(r=>_dSel.has(r._id));
    const allActiveIds = activeRows.map(r=>r._id);
    const allSel = allActiveIds.length>0 && allActiveIds.every(id=>_dSel.has(id));
    const selSum = selRows.reduce((s,r)=>s+r.importe,0);
    const total  = activeRows.reduce((s,r)=>s+r.importe,0);
    const tfc = activeRows.filter(r=>r._co==='tfc').reduce((s,r)=>s+r.importe,0);
    const tf  = activeRows.filter(r=>r._co==='tf').reduce((s,r)=>s+r.importe,0);
    // Contar todos los excluidos (sin filtros de UI)
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
      tbody.innerHTML = `<tr><td colspan="10" class="detail-empty">Sin cheques en cartera. Subí el archivo del banco.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r=>{
        const isExcl = r.excluido;
        const rc = isExcl ? '' : r.dias!==null&&r.dias<0?'overdue-row':r.dias!==null&&r.dias<=7?'soon-row':'';
        const sel = !isExcl && _dSel.has(r._id);
        const fisicoTag = r._source==='fisico'?' <span style="font-family:sans-serif;font-size:9px;background:#f3ede0;color:#8a6800;padding:1px 4px;border-radius:3px;font-weight:600;border:1px solid #e0cfa0">físico</span>':'';
        const adjTag = isExcl ? ' <span style="font-size:9px;background:#e8f0ff;color:#3355cc;padding:1px 4px;border-radius:3px;font-weight:600;border:1px solid #b3c4f0">adjudicado</span>' : '';
        const rowStyle = isExcl ? 'style="opacity:.45"' : '';
        const actionBtn = isExcl
          ? `<button onclick="restoreChq('${r._id}','${r._co}')" title="Restaurar" style="border:none;background:none;color:#3355cc;cursor:pointer;font-size:12px;padding:0 4px">↩</button>`
          : '';
        return `<tr class="${rc}${sel?' dsel-row':''}" ${rowStyle}>
          <td class="d-chk">${isExcl?'':'<input type="checkbox" '+(sel?'checked':'')+' onchange="toggleDSel(\''+r._id+'\',this.checked)">'}
          </td>
          <td>${coBadge(r._co)}</td>
          <td style="font-family:monospace;font-size:11px">${r.numero||'—'}${fisicoTag}${adjTag}</td>
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

    // Footer
    const exclToggleBtn = allExclCount
      ? `<button onclick="toggleShowExcl()" style="margin-left:8px;font-size:10px;padding:2px 8px;border:1px solid #b3c4f0;border-radius:4px;background:${_showExclChq?'#e8f0ff':'#fff'};color:#3355cc;cursor:pointer;font-family:inherit">${_showExclChq?'▲ Ocultar adjudicados':'▼ Ver '+allExclCount+' adjudicados'}</button>`
      : '';
    let foot = `<div class="detail-foot">
      <span>Total: <strong>$${fN(total)}</strong> (${activeRows.length} chq)${exclToggleBtn}</span>`;
    if (tfc&&tf) foot+=`<span><span class="badge-co-tfc">TFC</span> $${fN(tfc)}</span><span><span class="badge-co-tf">TF</span> $${fN(tf)}</span>`;
    if (_dSel.size) foot+=`<span style="margin-left:auto;color:#506E3E;font-weight:700">${_dSel.size} seleccionados · $${fN(selSum)}</span>`;
    foot += '</div>';
    updateDetailFoot(foot);

    // Barra de selección — con botón excluir
    updateDSelBar(selRows.length, selSum, true);

  } else {
    // PAGOS
    const rows = getProvRows();
    const allIds = rows.map(r=>r._id);
    const allSel = allIds.length>0 && allIds.every(id=>_dSel.has(id));
    const selRows = rows.filter(r=>_dSel.has(r._id));
    const selSum = selRows.reduce((s,r)=>s+r.importe,0);
    const total = rows.reduce((s,r)=>s+r.importe,0);
    const tfc = rows.filter(r=>r._co==='tfc').reduce((s,r)=>s+r.importe,0);
    const tf  = rows.filter(r=>r._co==='tf').reduce((s,r)=>s+r.importe,0);

    document.getElementById('df-count').textContent = `${rows.length} ítems · $${fN(total)}`;

    thead.innerHTML = `<tr>
      <th class="d-chk"><input type="checkbox" ${allSel?'checked':''} onchange="toggleDSelAll(this.checked,${JSON.stringify(allIds)})"></th>
      ${thSort('_co','Empresa')}
      ${thSort('proveedor','Proveedor')}
      ${thSort('fecha','Fecha vto.')}
      ${thSort('dias','Días','r')}
      ${thSort('importe','Importe','r')}
      <th>Estado CF</th>
    </tr>`;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="detail-empty">Sin datos. Subí el XLS de cuentas a pagar.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map(r=>{
        const rc = r.dias!==null&&r.dias<0?'overdue-row':r.dias!==null&&r.dias<=7?'soon-row':'';
        const sel = _dSel.has(r._id);
        const estadoCF = r.excluido
          ? '<span style="font-size:10px;color:#aaa;background:#f5f5f5;padding:2px 6px;border-radius:3px">Excluido</span>'
          : '<span style="font-size:10px;color:#1a7a40;background:#e8f5e9;padding:2px 6px;border-radius:3px">Activo</span>';
        return `<tr class="${rc}${sel?' dsel-row':''}">
          <td class="d-chk"><input type="checkbox" ${sel?'checked':''} onchange="toggleDSel('${r._id}',this.checked)"></td>
          <td>${coBadge(r._co)}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${r.proveedor}">${r.proveedor||'<span style="color:#ccc">—</span>'}</td>
          <td>${r.fechaStr}</td>
          <td class="r">${daysBadge(r.dias)}</td>
          <td class="r" style="font-weight:500">${fN(r.importe)}</td>
          <td>${estadoCF}</td>
        </tr>`;
      }).join('');
    }

    let foot = `<div class="detail-foot">
      <span>Total: <strong>$${fN(total)}</strong> (${rows.length} ítems)</span>`;
    if (tfc&&tf) foot+=`<span><span class="badge-co-tfc">TFC</span> $${fN(tfc)}</span><span><span class="badge-co-tf">TF</span> $${fN(tf)}</span>`;
    if (_dSel.size) foot+=`<span style="margin-left:auto;color:#506E3E;font-weight:700">${_dSel.size} seleccionados · $${fN(selSum)}</span>`;
    foot += '</div>';
    updateDetailFoot(foot);
    updateDSelBar(selRows.length, selSum);
  }
}

function updateDetailFoot(html) {
  let el = document.getElementById('detail-foot');
  if (!el) {
    el = document.createElement('div');
    el.id = 'detail-foot';
    document.getElementById('detail-section').appendChild(el);
  }
  el.innerHTML = html;
}

function updateDSelBar(n, sum, isCartera) {
  const bar = document.getElementById('dsel-bar');
  const info = document.getElementById('dsel-info');
  if (n > 0) {
    bar.style.display = 'flex';
    const exclBtn = isCartera
      ? ` <button onclick="excludeCartSel()" style="margin-left:8px;padding:3px 10px;border:none;border-radius:4px;background:#e74c3c;color:#fff;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit">🚫 Adjudicar (excluir)</button>`
      : '';
    info.innerHTML = `${n} seleccionado${n!==1?'s':''} · $${fN(sum)}${exclBtn}`;
  } else {
    bar.style.display = 'none';
  }
}

// ─── Exclusión de cheques en cartera ───────────────────
function excludeCartSel() {
  _dSel.forEach(id => {
    // IDs tienen formato: tfc_e_... o tf_e_... o tfc_f_... o tf_f_...
    const co = id.startsWith('tfc_') ? 'tfc' : 'tf';
    excl[co].chq.add(id);
  });
  _dSel.clear();
  saveOverrides();
  renderAll();
}

function restoreChq(id, co) {
  excl[co].chq.delete(id);
  saveOverrides();
  renderAll();
}

function toggleShowExcl() {
  _showExclChq = !_showExclChq;
  renderDetail();
}

function toggleFinGroup(k) {
  if (_finExpanded.has(k)) _finExpanded.delete(k);
  else _finExpanded.add(k);
  renderFinanciera();
}

// ─────────────────────────────────────────────────────
// Boot
loadOverrides();
loadFinPagados();
document.getElementById('hdr-date').textContent=
  new Date().toLocaleDateString('es-AR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
// asegurar que el detalle filtre por la empresa activa desde el inicio
document.getElementById('df-empresa').value='tfc';
(async () => {
  await hydrateFromSupabase(); // trae lo subido desde otros navegadores/dispositivos
  loadCompromisosFromStorage();
  _syncFinUploadSt();
  refresh();
})();
