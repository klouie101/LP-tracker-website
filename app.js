/* ===========================================================
 * LP Tracker — Uniswap · Aerodrome · Orca
 * Single-file vanilla JS app.
 * Persists to localStorage. Live prices from CoinGecko (no key).
 * =========================================================== */

const STORAGE_KEY = 'lp-tracker.positions.v1';
const PRICE_CACHE_KEY = 'lp-tracker.priceCache.v1';

// ---------- Token symbol → CoinGecko id map ----------
const TOKEN_IDS = {
  'BTC': 'bitcoin', 'WBTC': 'wrapped-bitcoin', 'CBBTC': 'coinbase-wrapped-btc',
  'ETH': 'ethereum', 'WETH': 'weth', 'CBETH': 'coinbase-wrapped-staked-eth',
  'SOL': 'solana', 'WSOL': 'wrapped-solana',
  'ARB': 'arbitrum', 'OP': 'optimism', 'MATIC': 'matic-network', 'POL': 'polygon-ecosystem-token',
  'BASE': 'base-protocol',
  'AERO': 'aerodrome-finance',
  'UNI': 'uniswap', 'ORCA': 'orca',
  'LINK': 'chainlink', 'AAVE': 'aave', 'CRV': 'curve-dao-token',
  'JUP': 'jupiter-exchange-solana', 'JTO': 'jito-governance-token',
  'BONK': 'bonk', 'WIF': 'dogwifcoin', 'PYTH': 'pyth-network',
};
const STABLES = new Set(['USDC','USDT','DAI','USDE','PYUSD','FRAX','USDBC','USDS','USDC.E']);

// ---------- State ----------
let positions = loadPositions();
let priceCache = loadPriceCache();
let openIds = new Set();   // which positions have details expanded
let editingId = null;

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', () => {
  bindUI();
  if (positions.length === 0) seedExample();
  render();
  // background refresh on load (silent)
  refreshAllPrices(true).catch(()=>{});
});

// ---------- UI binding ----------
function bindUI() {
  $('#btn-add').addEventListener('click', () => openModal());
  $('#btn-refresh').addEventListener('click', () => refreshAllPrices(false));
  $('#btn-csv').addEventListener('click', exportCSV);
  $('#btn-excel').addEventListener('click', exportExcel);
  $('#btn-pdf').addEventListener('click', () => window.print());
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', handleImportFile);

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal-back').addEventListener('click', e => { if (e.target.id === 'modal-back') closeModal(); });
  $('#position-form').addEventListener('submit', savePositionFromForm);

  $('#sort-active').addEventListener('change', render);
  $('#sort-closed').addEventListener('change', render);

  // Theme switcher
  const sel = $('#theme-select');
  if (sel) {
    sel.value = localStorage.getItem('lp-tracker.theme') || 'default';
    sel.addEventListener('change', () => {
      const t = sel.value;
      localStorage.setItem('lp-tracker.theme', t);
      const link = document.getElementById('theme-link');
      if (t === 'purple') link.href = 'themes/purple-gold.css';
      else if (t === 'synthwave') link.href = 'themes/synthwave.css';
      else link.href = '';
    });
  }
}

// ---------- Storage ----------
function loadPositions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function savePositions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}
function loadPriceCache() {
  try { return JSON.parse(localStorage.getItem(PRICE_CACHE_KEY)) || {}; }
  catch { return {}; }
}
function savePriceCache() {
  localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(priceCache));
}

// ---------- Seed (only first run, gives the user a sample so the UI isn't empty) ----------
function seedExample() {
  const now = Date.now();
  positions = [{
    id: uid(),
    pair: 'USDC/cbBTC CL100',
    protocol: 'Aerodrome',
    chain: 'Base',
    entry: new Date(now - 7.9 * 86400000).toISOString().slice(0,16),
    exit:  '',
    deposited: 399.42,
    bottom: 72030,
    top: 84527,
    balance: 402.59,
    tok1: { sym: 'USDC', count: 217.26, price: 1 },
    tok2: { sym: 'cbBTC', count: 0.00236, price: 78484 },
    feesNew: 2.95,
    feesClaim: 0,
    feesSwap: 0,
    scalp: 0,
    notes: '',
  }];
  savePositions();
}

// ---------- Computations ----------
function tokenPrice(t) {
  if (!t) return 0;
  if (typeof t.price === 'number' && !isNaN(t.price) && t.price > 0) return t.price;
  if (t.sym && STABLES.has(t.sym.toUpperCase())) return 1;
  const id = TOKEN_IDS[(t.sym || '').toUpperCase()];
  if (id && priceCache[id]) return priceCache[id];
  return 0;
}
function computeCurrentValue(p) {
  // Prefer manual balance if user set it; else compute from token amounts × prices
  if (typeof p.balance === 'number' && p.balance > 0) {
    // refresh balance from tokens if we have non-stable token prices live
    const live = (p.tok1.count||0) * tokenPrice(p.tok1) + (p.tok2.count||0) * tokenPrice(p.tok2);
    return live > 0 ? live : p.balance;
  }
  return (p.tok1.count||0) * tokenPrice(p.tok1) + (p.tok2.count||0) * tokenPrice(p.tok2);
}
function computeFees(p) {
  return (Number(p.feesNew)||0) + (Number(p.feesClaim)||0) - (Number(p.feesSwap)||0);
}
function computeDays(p) {
  if (!p.entry) return 0;
  const start = new Date(p.entry).getTime();
  const end = p.exit ? new Date(p.exit).getTime() : Date.now();
  return Math.max((end - start) / 86400000, 0.0001);
}
function computeProfit(p) {
  const cv = computeCurrentValue(p);
  return cv - (Number(p.deposited)||0) + computeFees(p) + (Number(p.scalp)||0);
}
function computeAPR(p) {
  const dep = Number(p.deposited)||0;
  if (!dep) return 0;
  const days = computeDays(p);
  const fees = computeFees(p);
  return (fees / dep) * (365 / days) * 100;
}
function isOutOfRange(p) {
  if (!p.bottom || !p.top || !p.tok2 || !tokenPrice(p.tok2)) return false;
  const px = tokenPrice(p.tok2);
  return px < Number(p.bottom) || px > Number(p.top);
}

// ---------- Rendering ----------
function render() {
  renderTotals();
  renderList('active');
  renderList('closed');
}

function renderTotals() {
  const active = positions.filter(p => !p.exit);
  const closed = positions.filter(p => !!p.exit);

  // ACTIVE
  const aDep = sum(active, p => p.deposited);
  const aCur = sum(active, p => computeCurrentValue(p));
  const aFees = sum(active, p => computeFees(p));
  const aProf = sum(active, p => computeProfit(p));
  const aApr = active.length
    ? active.reduce((acc,p)=>acc + computeAPR(p)*(p.deposited||0), 0) / Math.max(aDep, 1e-9)
    : 0;

  $('#a-positions').textContent = active.length;
  $('#a-deposited').textContent = money(aDep);
  $('#a-current').textContent   = money(aCur);
  setColored('#a-fees', aFees, money);
  setColored('#a-profit', aProf, money);
  setColored('#a-apr', aApr, v => v.toFixed(2) + '%');

  // CLOSED
  const cDep = sum(closed, p => p.deposited);
  const cFees = sum(closed, p => computeFees(p));
  const cProf = sum(closed, p => computeProfit(p));
  $('#c-positions').textContent = closed.length;
  $('#c-deployed').textContent  = money(cDep);
  setColored('#c-fees', cFees, money);
  setColored('#c-profit', cProf, money);

  // MONTHLY EST.
  const adfPerPos = active.map(p => {
    const days = computeDays(p);
    return computeFees(p) / Math.max(days, 1e-9);
  });
  const adf = adfPerPos.reduce((a,b)=>a+b, 0);
  const monthly = adf * 30;
  setColored('#m-fees', monthly, money);
  setColored('#m-daily', adf, money);
  setColored('#m-adf', adf, v => money(v) + '/d');

  // PORTFOLIO
  const pDep = aDep + cDep;
  const pVal = aCur + cDep + cProf - cFees; // closed positions: terminal "value" ~ deployed + (profit - fees)
  const pFees = aFees + cFees;
  const pProf = aProf + cProf;
  const pScalp = sum(positions, p => p.scalp);
  const pDiff = pVal - pDep - pFees;
  $('#p-deposited').textContent = money(pDep);
  $('#p-value').textContent     = money(aCur + cDep);
  setColored('#p-diff', pDiff, money);
  setColored('#p-fees', pFees, money);
  setColored('#p-profit', pProf, money);
  setColored('#p-apr', aApr, v => v.toFixed(2) + '%');
  setColored('#p-scalps', pScalp, money);
  setColored('#p-monthly', monthly, money);
}

function setColored(sel, val, fmt) {
  const el = $(sel);
  el.textContent = fmt(val);
  el.classList.remove('val-green','val-red');
  if (val > 0.0001) el.classList.add('val-green');
  else if (val < -0.0001) el.classList.add('val-red');
}

function renderList(kind) {
  const listEl = $('#' + kind + '-list');
  const countEl = $('#' + kind + '-count');
  const sortEl = $('#sort-' + kind);
  const items = positions.filter(p => kind === 'active' ? !p.exit : !!p.exit);
  countEl.textContent = items.length;

  const sortKey = sortEl.value;
  items.sort((a,b) => {
    if (sortKey === 'oldest') return new Date(a.entry) - new Date(b.entry);
    if (sortKey === 'newest') return new Date(b.entry) - new Date(a.entry);
    if (sortKey === 'profit') return computeProfit(b) - computeProfit(a);
    if (sortKey === 'apr')    return computeAPR(b) - computeAPR(a);
    return 0;
  });

  listEl.innerHTML = items.map(p => positionCard(p, kind)).join('');

  // wire up handlers
  listEl.querySelectorAll('.position').forEach(node => {
    const id = node.dataset.id;
    node.querySelector('.pos-toggle').addEventListener('click', () => {
      if (openIds.has(id)) openIds.delete(id); else openIds.add(id);
      render();
    });
    const editBtn = node.querySelector('[data-act=edit]');
    if (editBtn) editBtn.addEventListener('click', () => openModal(id));
    const closeBtn = node.querySelector('[data-act=close]');
    if (closeBtn) closeBtn.addEventListener('click', () => closePositionPrompt(id));
    const reopenBtn = node.querySelector('[data-act=reopen]');
    if (reopenBtn) reopenBtn.addEventListener('click', () => reopenPosition(id));
    const delBtn = node.querySelector('[data-act=delete]');
    if (delBtn) delBtn.addEventListener('click', () => deletePosition(id));
    const fetchBtn = node.querySelector('[data-act=fetch]');
    if (fetchBtn) fetchBtn.addEventListener('click', () => refreshOne(id));
  });
}

function positionCard(p, kind) {
  const isOpen = openIds.has(p.id);
  const days = computeDays(p);
  const apr = computeAPR(p);
  const profit = computeProfit(p);
  const cv = computeCurrentValue(p);
  const out = !p.exit && isOutOfRange(p);
  const t1px = tokenPrice(p.tok1);
  const t2px = tokenPrice(p.tok2);
  const t1stable = STABLES.has((p.tok1.sym||'').toUpperCase());
  const t2stable = STABLES.has((p.tok2.sym||'').toUpperCase());

  return `
  <div class="position ${kind} ${out ? 'outrange' : ''} ${isOpen ? 'open' : ''}" data-id="${p.id}">
    <div class="pos-head">
      <button class="pos-toggle" title="Expand">${isOpen ? '▾' : '▸'}</button>
      <div>
        <span class="pos-name">${escapeHtml(p.pair || 'Unnamed')}</span>
        <span class="pos-badges">
          ${p.protocol ? `<span class="badge badge-protocol">${escapeHtml(p.protocol)}</span>` : ''}
          ${p.chain ? `<span class="badge badge-chain">${escapeHtml(p.chain)}</span>` : ''}
          ${kind === 'active'
            ? `<span class="badge badge-active">● Active</span>`
            : `<span class="badge badge-closed">Closed</span>`}
          ${kind === 'active' ? (out
              ? `<span class="badge badge-outrange">⚠ Out of Range</span>`
              : (p.bottom && p.top && t2px ? `<span class="badge badge-inrange">In Range</span>` : '')
            ) : ''}
        </span>
      </div>
      <div></div>
      <div class="pos-stats">
        <div class="pos-stat"><div class="lbl">DEPOSITED</div><div class="val">${money(p.deposited)}</div></div>
        <div class="pos-stat"><div class="lbl">CURRENT</div><div class="val">${money(cv)}</div></div>
        <div class="pos-stat"><div class="lbl">PROFIT</div><div class="val ${cls(profit)}">${money(profit)}</div></div>
        <div class="pos-stat"><div class="lbl">FEE APR</div><div class="val ${cls(apr)}">${apr.toFixed(2)}%</div></div>
        <div class="pos-stat"><div class="lbl">DAYS</div><div class="val">${days.toFixed(1)}d</div></div>
      </div>
      <div class="pos-actions">
        <button class="icon-btn" data-act="edit" title="Edit">✎</button>
        ${kind === 'active'
          ? `<button class="icon-btn warn" data-act="close" title="Mark closed">▣ CLOSE</button>`
          : `<button class="icon-btn" data-act="reopen" title="Re-open">↺</button>`}
        <button class="icon-btn danger" data-act="delete" title="Delete">🗑</button>
      </div>
    </div>

    <div class="pos-body">
      <div class="pos-section-h">⌖ POSITION DETAILS</div>
      <div class="field-grid">
        <div class="field"><div class="lbl">Pair</div>            <div>${escapeHtml(p.pair)}</div></div>
        <div class="field"><div class="lbl">Protocol</div>        <div>${escapeHtml(p.protocol||'')}</div></div>
        <div class="field"><div class="lbl">Chain</div>           <div>${escapeHtml(p.chain||'')}</div></div>
        <div class="field"><div class="lbl">Entry datetime</div>  <div>${fmtDate(p.entry)}</div></div>
        <div class="field"><div class="lbl">Exit datetime</div>   <div>${p.exit ? fmtDate(p.exit) : '—'}</div></div>

        <div class="field"><div class="lbl">Deposited ($)</div>   <div>${money(p.deposited)}</div></div>
        <div class="field"><div class="lbl">Current balance ($)</div><div>${money(cv)}</div></div>
        <div class="field"><div class="lbl">Bottom range</div>    <div>${num(p.bottom)}</div></div>
        <div class="field"><div class="lbl">Top range</div>       <div>${num(p.top)}</div></div>
        <div class="field"><div class="lbl">Token 1 count</div>   <div>${num(p.tok1.count)}</div></div>

        <div class="field"><div class="lbl">Token 2 count</div>   <div>${num(p.tok2.count)}</div></div>
        <div class="field"><div class="lbl">Swap fees paid ($)</div><div>${money(p.feesSwap)}</div></div>
        <div class="field"><div class="lbl">New (unclaimed) fees ($)</div><div class="val-green">${money(p.feesNew)}</div></div>
        <div class="field"><div class="lbl">Claimed fees ($)</div><div>${money(p.feesClaim)}</div></div>
        <div class="field"><div class="lbl">Scalp ($)</div>       <div>${money(p.scalp)}</div></div>
      </div>

      ${p.notes ? `<div class="pos-section-h">NOTES</div><div style="color:var(--muted);font-size:13px;white-space:pre-wrap;">${escapeHtml(p.notes)}</div>` : ''}

      <div class="pos-section-h">LIVE PRICES</div>
      <div class="field-grid">
        <div class="field"><div class="lbl">${escapeHtml(p.tok1.sym||'Token 1')} current amt ${t1stable ? '<span class="tag tag-stable">STABLE $1</span>' : '<span class="tag tag-auto">AUTO</span>'}</div><div>${num(p.tok1.count)}</div></div>
        <div class="field"><div class="lbl">${escapeHtml(p.tok2.sym||'Token 2')} current amt ${t2stable ? '<span class="tag tag-stable">STABLE $1</span>' : '<span class="tag tag-auto">AUTO</span>'}</div><div>${num(p.tok2.count)}</div></div>
        <div class="field"><div class="lbl">${escapeHtml(p.tok1.sym||'Token 1')} price ($) ${t1stable ? '<span class="tag tag-stable">STABLE $1</span>' : '<span class="tag tag-auto">AUTO</span>'}</div><div>${num(t1px)}</div></div>
        <div class="field"><div class="lbl">${escapeHtml(p.tok2.sym||'Token 2')} price ($) ${t2stable ? '<span class="tag tag-stable">STABLE $1</span>' : '<span class="tag tag-auto">AUTO</span>'}</div><div>${num(t2px)}</div></div>
        <div class="field"><div class="lbl">USD Value of LP</div><div>${money(cv)}</div></div>
      </div>

      <div class="pos-foot">
        <div>Updated: ${new Date().toLocaleTimeString()}</div>
        <button class="btn-fetch" data-act="fetch">⟳ FETCH PRICES</button>
      </div>
    </div>
  </div>`;
}

// ---------- Modal / form ----------
function openModal(id) {
  editingId = id || null;
  $('#modal-title').textContent = id ? 'Edit Position' : 'Add Position';
  $('#modal-back').hidden = false;
  $('#position-form').reset();
  if (id) {
    const p = positions.find(x => x.id === id);
    if (!p) return;
    $('#f-id').value = p.id;
    $('#f-pair').value = p.pair || '';
    $('#f-protocol').value = p.protocol || 'Uniswap';
    $('#f-chain').value = p.chain || 'Base';
    $('#f-entry').value = (p.entry || '').slice(0,16);
    $('#f-exit').value = (p.exit || '').slice(0,16);
    $('#f-deposited').value = p.deposited ?? '';
    $('#f-bottom').value = p.bottom ?? '';
    $('#f-top').value = p.top ?? '';
    $('#f-balance').value = p.balance ?? '';
    $('#f-tok1-sym').value = p.tok1?.sym || '';
    $('#f-tok1').value = p.tok1?.count ?? '';
    $('#f-tok1-px').value = p.tok1?.price ?? '';
    $('#f-tok2-sym').value = p.tok2?.sym || '';
    $('#f-tok2').value = p.tok2?.count ?? '';
    $('#f-tok2-px').value = p.tok2?.price ?? '';
    $('#f-fees-new').value = p.feesNew ?? '';
    $('#f-fees-claim').value = p.feesClaim ?? '';
    $('#f-fees-swap').value = p.feesSwap ?? '';
    $('#f-scalp').value = p.scalp ?? '';
    $('#f-notes').value = p.notes || '';
  } else {
    $('#f-entry').value = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
}
function closeModal() { $('#modal-back').hidden = true; editingId = null; }

function savePositionFromForm(e) {
  e.preventDefault();
  const data = {
    id: editingId || uid(),
    pair:     ($('#f-pair').value || '').trim(),
    protocol: $('#f-protocol').value,
    chain:    $('#f-chain').value,
    entry:    $('#f-entry').value,
    exit:     $('#f-exit').value || '',
    deposited: numOrZero($('#f-deposited').value),
    bottom:    numOrZero($('#f-bottom').value),
    top:       numOrZero($('#f-top').value),
    balance:   numOrZero($('#f-balance').value),
    tok1: {
      sym:   ($('#f-tok1-sym').value || '').trim().toUpperCase(),
      count: numOrZero($('#f-tok1').value),
      price: numOrZero($('#f-tok1-px').value),
    },
    tok2: {
      sym:   ($('#f-tok2-sym').value || '').trim().toUpperCase(),
      count: numOrZero($('#f-tok2').value),
      price: numOrZero($('#f-tok2-px').value),
    },
    feesNew:   numOrZero($('#f-fees-new').value),
    feesClaim: numOrZero($('#f-fees-claim').value),
    feesSwap:  numOrZero($('#f-fees-swap').value),
    scalp:     numOrZero($('#f-scalp').value),
    notes:     $('#f-notes').value || '',
  };
  // auto-stable price
  if (STABLES.has(data.tok1.sym) && !data.tok1.price) data.tok1.price = 1;
  if (STABLES.has(data.tok2.sym) && !data.tok2.price) data.tok2.price = 1;

  if (editingId) {
    positions = positions.map(p => p.id === editingId ? data : p);
  } else {
    positions.push(data);
  }
  savePositions();
  closeModal();
  render();
  toast(editingId ? 'Position updated.' : 'Position added.', 'ok');
  refreshAllPrices(true).catch(()=>{});
}

function closePositionPrompt(id) {
  const p = positions.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Mark "${p.pair}" as closed?`)) return;
  p.exit = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  savePositions();
  render();
  toast('Position closed.', 'ok');
}
function reopenPosition(id) {
  const p = positions.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Re-open "${p.pair}"?`)) return;
  p.exit = '';
  savePositions();
  render();
}
function deletePosition(id) {
  const p = positions.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Permanently delete "${p.pair}"? This cannot be undone.`)) return;
  positions = positions.filter(x => x.id !== id);
  savePositions();
  render();
  toast('Position deleted.', 'ok');
}

// ---------- Prices (CoinGecko) ----------
async function refreshAllPrices(silent=false) {
  const ids = new Set();
  positions.forEach(p => {
    [p.tok1, p.tok2].forEach(t => {
      if (!t || !t.sym) return;
      if (STABLES.has(t.sym.toUpperCase())) return;
      const cgid = TOKEN_IDS[t.sym.toUpperCase()];
      if (cgid) ids.add(cgid);
    });
  });
  if (ids.size === 0) { if (!silent) toast('No tokens to fetch.'); return; }
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' +
      [...ids].join(',') + '&vs_currencies=usd';
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    Object.entries(data).forEach(([id, v]) => { if (v && typeof v.usd === 'number') priceCache[id] = v.usd; });
    savePriceCache();
    // refresh non-manual prices on each position
    positions.forEach(p => {
      [p.tok1, p.tok2].forEach(t => {
        if (!t || !t.sym) return;
        const cgid = TOKEN_IDS[t.sym.toUpperCase()];
        if (cgid && priceCache[cgid]) t.price = priceCache[cgid];
        if (STABLES.has((t.sym||'').toUpperCase())) t.price = 1;
      });
    });
    savePositions();
    render();
    if (!silent) toast('Prices refreshed.', 'ok');
  } catch (err) {
    if (!silent) toast('Price fetch failed: ' + err.message, 'err');
  }
}
async function refreshOne(id) {
  await refreshAllPrices(true);
  toast('Prices refreshed.', 'ok');
}

// ---------- Import / Export ----------
function exportCSV() {
  const headers = [
    'id','pair','protocol','chain','entry','exit','deposited','balance',
    'bottom','top','tok1_sym','tok1_count','tok1_price','tok2_sym','tok2_count','tok2_price',
    'feesNew','feesClaim','feesSwap','scalp','notes'
  ];
  const rows = positions.map(p => [
    p.id, p.pair, p.protocol, p.chain, p.entry, p.exit, p.deposited, p.balance,
    p.bottom, p.top, p.tok1?.sym, p.tok1?.count, p.tok1?.price,
    p.tok2?.sym, p.tok2?.count, p.tok2?.price,
    p.feesNew, p.feesClaim, p.feesSwap, p.scalp, (p.notes||'').replace(/\n/g,' ')
  ]);
  const csv = [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
  download('lp-positions.csv', csv, 'text/csv');
}
function exportExcel() {
  // Excel reads CSV fine; provide a UTF-8 BOM csv as .csv (Excel-compatible).
  exportCSV();
  toast('Exported as CSV (opens in Excel).', 'ok');
}
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const text = String(ev.target.result || '');
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error('JSON must be an array');
        positions = data.map(normalizeImported);
      } else {
        positions = parseCSV(text).map(normalizeImported);
      }
      savePositions();
      render();
      toast(`Imported ${positions.length} positions.`, 'ok');
    } catch (err) {
      toast('Import failed: ' + err.message, 'err');
    } finally {
      e.target.value = '';
    }
  };
  reader.readAsText(file);
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCSVRow(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCSVRow(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = cells[i]);
    return obj;
  });
}
function splitCSVRow(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function normalizeImported(r) {
  return {
    id: r.id || uid(),
    pair: r.pair || '',
    protocol: r.protocol || 'Uniswap',
    chain: r.chain || 'Base',
    entry: r.entry || '',
    exit: r.exit || '',
    deposited: numOrZero(r.deposited),
    balance: numOrZero(r.balance),
    bottom: numOrZero(r.bottom),
    top: numOrZero(r.top),
    tok1: { sym: (r.tok1_sym||r.tok1?.sym||'').toString().toUpperCase(), count: numOrZero(r.tok1_count ?? r.tok1?.count), price: numOrZero(r.tok1_price ?? r.tok1?.price) },
    tok2: { sym: (r.tok2_sym||r.tok2?.sym||'').toString().toUpperCase(), count: numOrZero(r.tok2_count ?? r.tok2?.count), price: numOrZero(r.tok2_price ?? r.tok2?.price) },
    feesNew: numOrZero(r.feesNew),
    feesClaim: numOrZero(r.feesClaim),
    feesSwap: numOrZero(r.feesSwap),
    scalp: numOrZero(r.scalp),
    notes: r.notes || '',
  };
}

// ---------- Helpers ----------
function $(s) { return document.querySelector(s); }
function uid() { return 'p_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
function sum(arr, fn) { return arr.reduce((a,p)=>a + (Number(fn(p))||0), 0); }
function numOrZero(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function num(v) { const n = Number(v); return isNaN(n) ? '0' : (Math.abs(n) < 1 ? n.toString() : n.toLocaleString(undefined, {maximumFractionDigits: 6})); }
function money(v) {
  const n = Number(v) || 0;
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}
function cls(n) { return n > 0.0001 ? 'val-green' : (n < -0.0001 ? 'val-red' : ''); }
function fmtDate(s) { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString(); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function download(name, content, type) {
  const blob = new Blob(['﻿', content], { type: type || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + (kind || '');
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2500);
}
