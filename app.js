/* ===========================================================
 * LP Tracker — Uniswap · Aerodrome · Orca
 * Single-file vanilla JS app.
 * Persists to localStorage. Live prices from CoinGecko (no key).
 * =========================================================== */

const STORAGE_KEY = 'lp-tracker.positions.v1';
const PRICE_CACHE_KEY = 'lp-tracker.priceCache.v1';

// ---------- Token symbol → CoinGecko id map ----------
const TOKEN_IDS = {
  // Bitcoin
  'BTC': 'bitcoin', 'WBTC': 'wrapped-bitcoin', 'CBBTC': 'coinbase-wrapped-btc', 'TBTC': 'tbtc',
  // Ethereum + LSTs
  'ETH': 'ethereum', 'WETH': 'weth', 'CBETH': 'coinbase-wrapped-staked-eth',
  'STETH': 'staked-ether', 'WSTETH': 'wrapped-steth', 'RETH': 'rocket-pool-eth',
  'WEETH': 'wrapped-eeth', 'EZETH': 'renzo-restaked-eth',
  // Solana + LSTs
  'SOL': 'solana', 'WSOL': 'wrapped-solana', 'JITOSOL': 'jito-staked-sol',
  'MSOL': 'msol', 'BSOL': 'blazestake-staked-sol', 'INF': 'sanctum-infinity',
  // L2s & ecosystem
  'ARB': 'arbitrum', 'OP': 'optimism', 'MATIC': 'matic-network', 'POL': 'polygon-ecosystem-token',
  'AVAX': 'avalanche-2', 'BNB': 'binancecoin', 'BLAST': 'blast',
  // DEX tokens
  'AERO': 'aerodrome-finance', 'UNI': 'uniswap', 'ORCA': 'orca',
  'CAKE': 'pancakeswap-token', 'SUSHI': 'sushi', 'CRV': 'curve-dao-token', 'BAL': 'balancer',
  // DeFi blue chips
  'LINK': 'chainlink', 'AAVE': 'aave', 'COMP': 'compound-governance-token',
  'MKR': 'maker', 'SNX': 'havven', 'GMX': 'gmx', 'PENDLE': 'pendle',
  'LDO': 'lido-dao', 'RPL': 'rocket-pool',
  // Solana DeFi
  'JUP': 'jupiter-exchange-solana', 'JTO': 'jito-governance-token',
  'PYTH': 'pyth-network', 'KMNO': 'kamino', 'DRIFT': 'drift-protocol',
  'RAY': 'raydium', 'WHIRL': 'orca',
  // Memes
  'BONK': 'bonk', 'WIF': 'dogwifcoin', 'POPCAT': 'popcat',
  'PEPE': 'pepe', 'DOGE': 'dogecoin', 'SHIB': 'shiba-inu', 'BRETT': 'based-brett',
  'DEGEN': 'degen-base', 'TOSHI': 'toshi',
  // Other notable
  'TIA': 'celestia', 'INJ': 'injective-protocol', 'SUI': 'sui',
  'APT': 'aptos', 'ATOM': 'cosmos', 'NEAR': 'near', 'FTM': 'fantom',
  'MOG': 'mog-coin', 'VIRTUAL': 'virtual-protocol',
};
const STABLES = new Set([
  'USDC','USDT','DAI','USDE','PYUSD','FRAX','USDBC','USDS','USDC.E',
  'AUSD','SUSDS','GUSD','TUSD','LUSD','CRVUSD','USDD','BUSD',
  'FDUSD','USDX','USDP','USR','DEUSD','USYC','USDM'
]);

// ---------- State ----------
let positions = loadPositions();
let priceCache = loadPriceCache();
let openIds = new Set();   // which positions have details expanded
let editingId = null;
let modalHarvestLog = [];  // working copy of the harvest log while the modal is open
let modalDepositLog = [];  // working copy of the deposit log while the modal is open

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', () => {
  // Always start with the modal closed, no matter what.
  closeModal();
  bindUI();
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
  $('#btn-patch').addEventListener('click', openPatchModal);
  $('#patch-close').addEventListener('click', closePatchModal);
  $('#patch-cancel').addEventListener('click', closePatchModal);
  $('#patch-preview-btn').addEventListener('click', previewPatch);
  $('#patch-apply-btn').addEventListener('click', applyPatch);

  // Modal close — bound via event delegation so it always works
  document.addEventListener('click', e => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'modal-close' || t.id === 'modal-cancel') { closeModal(); return; }
    if (t.id === 'modal-back') { closeModal(); return; }
    if (t.closest && t.closest('#modal-close, #modal-cancel')) { closeModal(); return; }
  });
  // Escape key always closes the modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
  $('#position-form').addEventListener('submit', savePositionFromForm);
  $('#hv-add-btn').addEventListener('click', addHarvestEntry);
  $('#dp-add-btn').addEventListener('click', addDepositEntry);
  $('#deposit-log-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-dp-del]');
    if (!btn) return;
    modalDepositLog = modalDepositLog.filter(d => d.id !== btn.dataset.dpDel);
    renderDepositLogUI();
  });
  $('#harvest-log-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-hv-del]');
    if (!btn) return;
    modalHarvestLog = modalHarvestLog.filter(h => h.id !== btn.dataset.hvDel);
    renderHarvestLogUI();
  });

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
  // 1. If user entered Current Balance ($) directly, ALWAYS trust it.
  //    Most LP dashboards (Aerodrome, Orca, Uniswap) show a USD value — copy that in.
  if (typeof p.balance === 'number' && p.balance > 0) return p.balance;
  // 2. Otherwise compute from token amounts × prices.
  return (Number(p.tok1?.count)||0) * tokenPrice(p.tok1) + (Number(p.tok2?.count)||0) * tokenPrice(p.tok2);
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
  // alias for yearly APR
  return computeYearlyAPR(p);
}
function computeFeeROI(p) {
  const dep = Number(p.deposited)||0;
  if (!dep) return 0;
  return computeFees(p) / dep * 100;
}
function computeROI(p) {
  // total return (price diff + fees + scalp) as % of deposited
  const dep = Number(p.deposited)||0;
  if (!dep) return 0;
  return computeProfit(p) / dep * 100;
}
function computeADF(p) {
  const days = computeDays(p);
  if (days <= 0) return 0;
  return computeFees(p) / days;
}
// Average capital actually at work, weighted by how long each deposit was live.
// A position built in tranches has less capital deployed than its final DEPOSITED
// total for most of its life, so charging every dollar the full holding period
// understates APR. With no deposit log we fall back to the old behaviour exactly.
function computeAvgCapital(p) {
  const dep = Number(p.deposited)||0;
  const log = Array.isArray(p.depositLog) ? p.depositLog : [];
  const days = computeDays(p);
  if (!log.length || days <= 0 || !p.entry) return dep;
  const startMs = new Date(p.entry).getTime();
  const endMs = p.exit ? new Date(p.exit).getTime() : Date.now();
  let capitalDays = 0;
  for (const d of log) {
    const amt = Number(d.amount)||0;
    const tRaw = d.date ? new Date(d.date + 'T00:00:00').getTime() : startMs;
    const t = isNaN(tRaw) ? startMs : Math.max(tRaw, startMs);
    capitalDays += amt * Math.max((endMs - t) / 86400000, 0);
  }
  const avg = capitalDays / days;
  return avg > 0 ? avg : dep;
}
function computeDailyAPR(p) {
  const base = computeAvgCapital(p);
  if (!base) return 0;
  return computeADF(p) / base * 100;
}
function computeMonthlyAPR(p) { return computeDailyAPR(p) * 30; }
function computeYearlyAPR(p) { return computeDailyAPR(p) * 365; }
// Positions younger than this can't be reliably annualized (one hour of swap-fee drag
// would otherwise extrapolate to an absurd APR and trash the portfolio averages).
const MIN_DAYS_FOR_APR = 1;
function isMature(p) { return computeDays(p) >= MIN_DAYS_FOR_APR; }
// Choose the volatile (non-stable) token for range display
function priceTokenOf(p) {
  const t1stable = STABLES.has((p.tok1?.sym || '').toUpperCase());
  const t2stable = STABLES.has((p.tok2?.sym || '').toUpperCase());
  if (!t1stable && t2stable) return p.tok1;
  if (t1stable && !t2stable) return p.tok2;
  return p.tok2 || p.tok1; // both volatile or both stable — fall back
}
// The number the range bounds (bottom/top) are measured in, plus its unit label.
// Stable/volatile pool: the volatile token's USD price (unit "$"), unchanged behavior.
// Token/token pool (both volatile): the ratio of tok1 priced in tok2, i.e. how many
//   tok2 one tok1 buys. WETH/cbBTC with WETH as tok1 gives cbBTC per WETH. Enter the
//   range bounds in that same unit. usd:false tells callers not to prefix a $ sign.
function rangePrice(p) {
  const t1stable = STABLES.has((p.tok1?.sym || '').toUpperCase());
  const t2stable = STABLES.has((p.tok2?.sym || '').toUpperCase());
  const p1 = tokenPrice(p.tok1), p2 = tokenPrice(p.tok2);
  // Token/token pool: only when BOTH legs are non-stable AND both have live prices.
  // Positions tracked by USD range alone (no token symbols or prices, e.g. the Orca
  // pools) have no ratio to compute, so they fall through to the USD branch and
  // render exactly as before.
  if (!t1stable && !t2stable && p1 && p2) {
    return { value: p1 / p2, unit: `${p.tok2?.sym || ''} per ${p.tok1?.sym || ''}`, usd: false };
  }
  const tok = priceTokenOf(p);
  const px = tok ? tokenPrice(tok) : 0;
  return { value: px, unit: tok?.sym || '', usd: true };
}
// Format a price with sensible precision
function fmtPrice(v) {
  const n = Number(v) || 0;
  if (n >= 100)  return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1)    return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (n > 0)     return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return '—';
}
// ---------- Out-of-range duration tracking ----------
// Supports a "wait N hours before rebalancing" rule (default 48h):
// yellow badge while inside the window, red badge once it expires.
const OOR_WAIT_HOURS = 48;
function outOfRangeHours(p) {
  if (!p.outOfRangeSince) return 0;
  return (Date.now() - p.outOfRangeSince) / 3600000;
}
function fmtOutOfRangeDuration(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  const days = Math.floor(hours / 24);
  const remH = Math.floor(hours - days * 24);
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}
// Stamp `outOfRangeSince` on positions that just crossed out; clear it when
// price re-enters the range. Closed positions never track OOR.
// Also maintains `oorHistory` — an array of {start, end} intervals so we can
// compute "out of range X hours of the last 24h" for bouncy positions.
const OOR_24H_MS = 24 * 3600 * 1000;
function updateOutOfRangeTracking() {
  let changed = false;
  const now = Date.now();
  const cutoff = now - OOR_24H_MS;
  positions.forEach(p => {
    if (p.exit) {
      if (p.outOfRangeSince) { p.outOfRangeSince = null; changed = true; }
      if (Array.isArray(p.oorHistory) && p.oorHistory.length) { p.oorHistory = []; changed = true; }
      return;
    }
    if (!Array.isArray(p.oorHistory)) p.oorHistory = [];
    const out = isOutOfRange(p);
    if (out && !p.outOfRangeSince) {
      // Just crossed OOR: start consecutive timer + open a new interval.
      p.outOfRangeSince = now;
      p.oorHistory.push({ start: now, end: null });
      changed = true;
    } else if (!out && p.outOfRangeSince) {
      // Just re-entered range: clear consecutive timer + close the open interval.
      p.outOfRangeSince = null;
      const last = p.oorHistory[p.oorHistory.length - 1];
      if (last && last.end === null) { last.end = now; changed = true; }
    }
    // Trim closed intervals that ended before the 24h cutoff.
    const before = p.oorHistory.length;
    p.oorHistory = p.oorHistory.filter(iv => iv.end === null || iv.end >= cutoff);
    if (p.oorHistory.length !== before) changed = true;
  });
  return changed;
}
// Cumulative hours out of range over the last 24h, summing all intervals
// (clamped to the rolling window). Bouncy positions accumulate over the day
// even when the consecutive timer keeps resetting.
function outOfRange24h(p) {
  if (!Array.isArray(p.oorHistory) || p.oorHistory.length === 0) return 0;
  const now = Date.now();
  const cutoff = now - OOR_24H_MS;
  let totalMs = 0;
  p.oorHistory.forEach(iv => {
    const start = Math.max(iv.start, cutoff);
    const end = iv.end === null ? now : iv.end;
    if (end > start) totalMs += end - start;
  });
  return totalMs / 3600000;
}

function isOutOfRange(p) {
  if (!p.bottom || !p.top) return false;
  // Compare the range bounds against rangePrice(): a USD price for stable/volatile
  // pools, or the tok1-in-tok2 ratio for token/token pools (e.g. cbBTC per WETH).
  const rp = rangePrice(p);
  if (!rp.value) return false;
  return rp.value < Number(p.bottom) || rp.value > Number(p.top);
}

// ---------- Rendering ----------
function render() {
  if (updateOutOfRangeTracking()) savePositions();
  renderTotals();
  renderList('active');
  renderList('closed');
}
// Tick the out-of-range duration roughly once a minute so the timer
// updates visibly while the tab is open.
setInterval(() => { render(); }, 60000);

function renderTotals() {
  const active = positions.filter(p => !p.exit);
  const closed = positions.filter(p => !!p.exit);

  // ACTIVE
  const aDep = sum(active, p => p.deposited);
  const aCur = sum(active, p => computeCurrentValue(p));
  const aFees = sum(active, p => computeFees(p));
  const aProf = sum(active, p => computeProfit(p));
  const matureActive = active.filter(isMature);
  const matureDep = sum(matureActive, p => p.deposited);
  const aApr = matureDep > 0
    ? matureActive.reduce((acc,p)=>acc + computeAPR(p)*(p.deposited||0), 0) / matureDep
    : NaN;

  $('#a-positions').textContent = active.length;
  $('#a-deposited').textContent = money(aDep);
  $('#a-current').textContent   = money(aCur);
  setColored('#a-fees', aFees, money);
  setColored('#a-profit', aProf, money);
  setAprCell('#a-apr', aApr);

  // CLOSED
  const cDep = sum(closed, p => p.deposited);
  const cFees = sum(closed, p => computeFees(p));
  const cProf = sum(closed, p => computeProfit(p));
  $('#c-positions').textContent = closed.length;
  $('#c-avg-size').textContent  = money(closed.length ? cDep / closed.length : 0);
  setColored('#c-fees', cFees, money);
  setColored('#c-profit', cProf, money);

  // MONTHLY EST.
  // Only include mature positions — a 1-hour-old position with -$0.40 in entry swap
  // fees would otherwise project to -$300/mo of "fees".
  const adfPerPos = matureActive.map(p => computeFees(p) / computeDays(p));
  const adf = adfPerPos.reduce((a,b)=>a+b, 0);
  const monthly = adf * 30;
  setColored('#m-fees', monthly, money);
  setColored('#m-daily', adf, money);
  setColored('#m-adf', adf, v => money(v) + '/d');

  // PORTFOLIO
  // Capital metrics treat closed positions as already-redeployed into active (no double-counting).
  // Fees + Profit are lifetime sums across active + closed.
  const pDep  = aDep;
  const pVal  = aCur;
  const pDiff = aCur - aDep;             // capital change on currently-deployed positions
  const pFees = aFees + cFees;           // lifetime fees
  const pProf = aProf + cProf;           // lifetime profit
  const pScalp = sum(positions, p => p.scalp);
  $('#p-deposited').textContent = money(pDep);
  $('#p-value').textContent     = money(pVal);
  setColored('#p-diff', pDiff, money);
  setColored('#p-fees', pFees, money);
  setColored('#p-profit', pProf, money);
  setAprCell('#p-apr', aApr);
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
// APR cell — shows "—" with a tooltip when no positions are mature enough to annualize.
function setAprCell(sel, val) {
  const el = $(sel);
  el.classList.remove('val-green','val-red');
  if (!isFinite(val) || isNaN(val)) {
    el.textContent = '—';
    el.title = 'Needs at least one position open ≥ 1 day to compute APR.';
    return;
  }
  el.title = '';
  el.textContent = val.toFixed(2) + '%';
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

  if (items.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        ${kind === 'active'
          ? `<div class="empty-title">No active positions yet</div>
             <div class="empty-sub">Click <strong>+ ADD POSITION</strong> in the top right to add your first liquidity pool.</div>`
          : `<div class="empty-title">No closed positions yet</div>
             <div class="empty-sub">When you close an active position it will show up here.</div>`
        }
      </div>`;
  } else {
    listEl.innerHTML = items.map(p => positionCard(p, kind)).join('');
  }

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
  const mature = isMature(p);
  const apr = computeYearlyAPR(p);
  const profit = computeProfit(p);
  const cv = computeCurrentValue(p);
  const fees = computeFees(p);
  const roi = computeROI(p);
  const feeROI = computeFeeROI(p);
  const adf = computeADF(p);
  const dailyAPR = computeDailyAPR(p);
  const monthlyAPR = computeMonthlyAPR(p);
  // Pretty APR — "<1d" when position is too fresh to annualize meaningfully
  const aprStr  = mature ? `${apr.toFixed(2)}%`        : '<1d';
  const dAprStr = mature ? `${dailyAPR.toFixed(2)}%`   : '<1d';
  const mAprStr = mature ? `${monthlyAPR.toFixed(2)}%` : '<1d';
  const aprCls  = mature ? cls(apr) : '';
  const out = !p.exit && isOutOfRange(p);
  // Out-of-range duration: drives the yellow→red 48h badge.
  const oorHrs = out ? outOfRangeHours(p) : 0;
  const oorPastWait = oorHrs >= OOR_WAIT_HOURS;
  const oorBadgeCls = oorPastWait ? 'badge-outrange' : 'badge-outrange-wait';
  const oorBadgeTitle = oorPastWait
    ? `Out of range ${fmtOutOfRangeDuration(oorHrs)} — past your ${OOR_WAIT_HOURS}h wait window. Time to rebalance.`
    : `Out of range ${fmtOutOfRangeDuration(oorHrs)} of ${OOR_WAIT_HOURS}h wait window. Hold for now — price may re-enter.`;
  const oorBadgeLabel = out
    ? (p.outOfRangeSince ? `⚠ Out of Range · ${fmtOutOfRangeDuration(oorHrs)}` : '⚠ Out of Range')
    : '';
  // Cumulative out-of-range stat over the last 24h — useful for bouncy
  // positions whose consecutive timer keeps resetting.
  const oor24h = !p.exit ? outOfRange24h(p) : 0;
  const oor24hPct = (oor24h / 24) * 100;
  // Hide when negligible (<6 min) so the subtitle stays clean.
  const showOor24h = oor24h >= 0.1;
  const oor24hClass = oor24hPct >= 50 ? 'pos-oor24h hot' : 'pos-oor24h';
  const oor24hStr = showOor24h
    ? `Out of range ${fmtOutOfRangeDuration(oor24h)} of last 24h (${oor24hPct.toFixed(0)}%)`
    : '';
  // Sanity flag: current value is more than 5x deposited — likely a data entry error.
  const suspicious = (Number(p.deposited) > 0) && (cv > p.deposited * 5);
  // Range subtitle text
  const pTok = priceTokenOf(p);
  const pTokPx = pTok ? tokenPrice(pTok) : 0;
  const rp = rangePrice(p);
  const rpCur = rp.value ? rp.value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '';
  const rangeStr = (Number(p.bottom) > 0 && Number(p.top) > 0)
    ? (rp.usd
        ? `Range: ${fmtPrice(p.bottom)} – ${fmtPrice(p.top)}` +
          (pTokPx ? ` (current ${fmtPrice(pTokPx)} ${escapeHtml(pTok.sym||'')})` : '')
        : `Range: ${num(p.bottom)} – ${num(p.top)} ${escapeHtml(rp.unit)}` +
          (rpCur ? ` (current ${rpCur})` : ''))
    : '';
  const splitStr = ((Number(p.tok1?.count) > 0) || (Number(p.tok2?.count) > 0))
    ? `${num(p.tok1?.count)} ${escapeHtml(p.tok1?.sym||'')} / ${num(p.tok2?.count)} ${escapeHtml(p.tok2?.sym||'')}`
    : '';
  const t1px = tokenPrice(p.tok1);
  const t2px = tokenPrice(p.tok2);
  const t1stable = STABLES.has((p.tok1.sym||'').toUpperCase());
  const t2stable = STABLES.has((p.tok2.sym||'').toUpperCase());

  return `
  <div class="position ${kind} ${out ? 'outrange' : ''} ${isOpen ? 'open' : ''}" data-id="${p.id}">
    <div class="pos-head">
      <button class="pos-toggle" title="Expand">${isOpen ? '▾' : '▸'}</button>
      <div class="pos-title-col">
        <div>
          <span class="pos-name">${escapeHtml(p.pair || 'Unnamed')}</span>
          <span class="pos-badges">
            ${p.protocol ? `<span class="badge badge-protocol">${escapeHtml(p.protocol)}</span>` : ''}
            ${p.chain ? `<span class="badge badge-chain">${escapeHtml(p.chain)}</span>` : ''}
            ${kind === 'active'
              ? `<span class="badge badge-active">● Active</span>`
              : `<span class="badge badge-closed">Closed</span>`}
            ${kind === 'active' ? (out
                ? `<span class="badge ${oorBadgeCls}" title="${escapeHtml(oorBadgeTitle)}">${oorBadgeLabel}</span>`
                : (p.bottom && p.top && rp.value ? `<span class="badge badge-inrange">In Range</span>` : '')
              ) : ''}
            ${suspicious ? `<span class="badge badge-outrange" title="Current value is more than 5× deposited — likely a typo. Click ✎ to edit.">⚠ Check Numbers</span>` : ''}
          </span>
        </div>
        ${(rangeStr || splitStr) ? `<div class="pos-subtitle">${rangeStr}${(rangeStr && splitStr) ? ' <span class="dot-sep">·</span> ' : ''}${splitStr}</div>` : ''}
        ${showOor24h ? `<div class="pos-subtitle ${oor24hClass}" title="Cumulative time out of range across the last 24h, including all bounces. Different from the consecutive timer in the badge.">${oor24hStr}</div>` : ''}
      </div>
      <div class="pos-stats">
        <div class="pos-stat"><div class="lbl">DEPOSITED</div><div class="val">${money(p.deposited)}</div></div>
        <div class="pos-stat"><div class="lbl">CURRENT</div><div class="val">${money(cv)}</div></div>
        <div class="pos-stat"><div class="lbl">FEES</div><div class="val ${cls(fees)}" title="Pending (unclaimed) + harvested fees, minus swap fees paid on entry.">${money(fees)}</div></div>
        <div class="pos-stat"><div class="lbl">P/L</div><div class="val ${cls(profit)}">${money(profit)}</div></div>
        <div class="pos-stat"><div class="lbl">ROI</div><div class="val ${cls(roi)}">${roi.toFixed(2)}%</div></div>
        <div class="pos-stat"><div class="lbl">APR</div><div class="val ${aprCls}" title="${mature ? '' : 'Position open less than 1 day — APR not annualized yet.'}">${aprStr}</div></div>
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

      <div class="pos-section-h">⚡ PERFORMANCE</div>
      <div class="field-grid">
        <div class="field"><div class="lbl">Price Diff $</div><div class="${cls(cv - (Number(p.deposited)||0))}">${money(cv - (Number(p.deposited)||0))}</div></div>
        <div class="field"><div class="lbl">Total Fees</div><div class="val-green">${money(fees)}</div></div>
        <div class="field"><div class="lbl">Profit (P/L)</div><div class="${cls(profit)}">${money(profit)}</div></div>
        <div class="field"><div class="lbl">ROI %</div><div class="${cls(roi)}">${roi.toFixed(2)}%</div></div>
        <div class="field"><div class="lbl">Fee ROI %</div><div class="val-green">${feeROI.toFixed(2)}%</div></div>
        <div class="field"><div class="lbl">ADF (avg daily fees)</div><div class="val-green">${money(adf)}/d</div></div>
        <div class="field"><div class="lbl">Daily APR</div><div class="val-green">${dailyAPR.toFixed(2)}%</div></div>
        <div class="field"><div class="lbl">Monthly APR</div><div class="val-green">${monthlyAPR.toFixed(2)}%</div></div>
        <div class="field"><div class="lbl">Yearly APR</div><div class="val-green">${apr.toFixed(2)}%</div></div>
        <div class="field"><div class="lbl">Days in position</div><div>${days.toFixed(2)}d</div></div>
        <div class="field"><div class="lbl" title="Deposits weighted by how long each was live. APR is computed against this, not the DEPOSITED total.">Avg capital at work</div><div>${money(computeAvgCapital(p))}${computeAvgCapital(p) < (Number(p.deposited)||0) - 0.005 ? ` <span class="val-green">(tranched)</span>` : ''}</div></div>
      </div>

      ${Array.isArray(p.harvestLog) && p.harvestLog.length ? `
        <div class="pos-section-h">🌾 HARVEST HISTORY</div>
        <div class="harvest-log-list">
          ${[...p.harvestLog].sort((a,b)=>(a.date||'').localeCompare(b.date||'')).map(h => `
            <div class="harvest-entry">
              <div class="hv-date">${escapeHtml(h.date || '—')}</div>
              <div class="hv-amount">${money(h.amount)}</div>
              <div class="hv-notes" title="${escapeHtml(h.notes||'')}">${escapeHtml(h.notes||'')}</div>
              <div></div>
            </div>`).join('')}
        </div>` : ''}

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
  const back = $('#modal-back');
  back.classList.add('is-open');
  back.removeAttribute('hidden');
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
    $('#f-fees-swap').value = p.feesSwap ?? '';
    $('#f-scalp').value = p.scalp ?? '';
    $('#f-notes').value = p.notes || '';
    // Seed the working harvest log. If this position predates the harvest log
    // feature and already has a claimed-fees total, backfill it as one
    // undated legacy entry so the running total isn't lost.
    if (Array.isArray(p.harvestLog) && p.harvestLog.length) {
      modalHarvestLog = p.harvestLog.map(h => ({ ...h }));
    } else if (Number(p.feesClaim) > 0) {
      modalHarvestLog = [{
        id: uid(),
        date: (p.entry || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
        amount: Number(p.feesClaim),
        notes: 'Legacy total — exact date unknown',
      }];
    } else {
      modalHarvestLog = [];
    }
    // Same treatment for deposits. A position that predates the deposit log gets
    // its total backfilled as one entry dated at entry, which reproduces the old
    // APR exactly until she splits it into the real tranches.
    if (Array.isArray(p.depositLog) && p.depositLog.length) {
      modalDepositLog = p.depositLog.map(d => ({ ...d }));
    } else if (Number(p.deposited) > 0) {
      modalDepositLog = [{
        id: uid(),
        date: (p.entry || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
        amount: Number(p.deposited),
        notes: 'Legacy total — split into real tranches if known',
      }];
    } else {
      modalDepositLog = [];
    }
  } else {
    $('#f-entry').value = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
    modalHarvestLog = [];
    modalDepositLog = [];
  }
  const today = new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  $('#hv-date').value = today;
  $('#dp-date').value = today;
  renderHarvestLogUI();
  renderDepositLogUI();
}
function closeModal() {
  const back = $('#modal-back');
  if (back) {
    back.classList.remove('is-open');
    back.setAttribute('hidden', '');
  }
  editingId = null;
  modalHarvestLog = [];
  modalDepositLog = [];
}

// ---------- Harvest log (dated fee-collection entries within the modal) ----------
function sumHarvestLog(log) {
  return (log || []).reduce((a, h) => a + (Number(h.amount) || 0), 0);
}
function renderHarvestLogUI() {
  const listEl = $('#harvest-log-list');
  const sorted = [...modalHarvestLog].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  listEl.innerHTML = sorted.length
    ? sorted.map(h => `
      <div class="harvest-entry">
        <div class="hv-date">${escapeHtml(h.date || '—')}</div>
        <div class="hv-amount">${money(h.amount)}</div>
        <div class="hv-notes" title="${escapeHtml(h.notes || '')}">${escapeHtml(h.notes || '')}</div>
        <button type="button" class="hv-del" data-hv-del="${h.id}" title="Remove">🗑</button>
      </div>`).join('')
    : `<div class="harvest-log-empty">No harvests logged yet — add one below.</div>`;
  $('#f-fees-claim').value = sumHarvestLog(modalHarvestLog).toFixed(2);
}
function addHarvestEntry() {
  const date = $('#hv-date').value;
  const amount = numOrZero($('#hv-amount').value);
  const notes = ($('#hv-notes').value || '').trim();
  if (!date) { toast('Pick a date for the harvest.', 'err'); $('#hv-date').focus(); return; }
  if (amount <= 0) { toast('Enter a harvest amount greater than 0.', 'err'); $('#hv-amount').focus(); return; }
  modalHarvestLog.push({ id: uid(), date, amount, notes });
  // Workflow step 3: move the collected amount from "New (unclaimed)" to claimed.
  const newFeesEl = $('#f-fees-new');
  newFeesEl.value = Math.max(0, numOrZero(newFeesEl.value) - amount).toFixed(2);
  $('#hv-date').value = '';
  $('#hv-amount').value = '';
  $('#hv-notes').value = '';
  renderHarvestLogUI();
  toast('Harvest added.', 'ok');
}

// ---------- Deposit log (dated deposit entries within the modal) ----------
function sumDepositLog(log) {
  return (log || []).reduce((a, d) => a + (Number(d.amount) || 0), 0);
}
function renderDepositLogUI() {
  const listEl = $('#deposit-log-list');
  if (!listEl) return;
  const sorted = [...modalDepositLog].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  listEl.innerHTML = sorted.length
    ? sorted.map(d => `
      <div class="harvest-entry">
        <div class="hv-date">${escapeHtml(d.date || '—')}</div>
        <div class="hv-amount">${money(d.amount)}</div>
        <div class="hv-notes" title="${escapeHtml(d.notes || '')}">${escapeHtml(d.notes || '')}</div>
        <button type="button" class="hv-del" data-dp-del="${d.id}" title="Remove">🗑</button>
      </div>`).join('')
    : `<div class="harvest-log-empty">No deposits logged yet — add one below.</div>`;
  const depEl = $('#f-deposited');
  if (modalDepositLog.length) {
    depEl.value = sumDepositLog(modalDepositLog).toFixed(2);
    depEl.readOnly = true;
  } else {
    depEl.readOnly = false;
  }
}
function addDepositEntry() {
  const date = $('#dp-date').value;
  const amount = numOrZero($('#dp-amount').value);
  const notes = ($('#dp-notes').value || '').trim();
  if (!date) { toast('Pick a date for the deposit.', 'err'); $('#dp-date').focus(); return; }
  if (amount <= 0) { toast('Enter a deposit amount greater than 0.', 'err'); $('#dp-amount').focus(); return; }
  modalDepositLog.push({ id: uid(), date, amount, notes });
  $('#dp-date').value = '';
  $('#dp-amount').value = '';
  $('#dp-notes').value = '';
  renderDepositLogUI();
  toast('Deposit added.', 'ok');
}

function savePositionFromForm(e) {
  e.preventDefault();
  const pairVal = ($('#f-pair').value || '').trim();
  if (!pairVal) {
    toast('Please enter a Pair name (e.g. USDC/cbBTC).', 'err');
    $('#f-pair').focus();
    return;
  }
  const data = {
    id: editingId || uid(),
    pair:     pairVal,
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
    feesClaim: sumHarvestLog(modalHarvestLog),
    feesSwap:  numOrZero($('#f-fees-swap').value),
    scalp:     numOrZero($('#f-scalp').value),
    notes:     $('#f-notes').value || '',
    harvestLog: modalHarvestLog.map(h => ({ ...h })),
    depositLog: modalDepositLog.map(d => ({ ...d })),
  };
  if (modalDepositLog.length) data.deposited = sumDepositLog(modalDepositLog);
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

// ---------- Patch (paste JSON to update positions in place) ----------
// Deliberately NOT the same as IMPORT. Import replaces every position; this only
// touches positions a patch entry actually matches, and previews before writing.
let pendingPatch = null;

function openPatchModal() {
  pendingPatch = null;
  $('#patch-input').value = '';
  $('#patch-preview').innerHTML = '';
  $('#patch-apply-btn').disabled = true;
  const back = $('#patch-back');
  back.removeAttribute('hidden');
  back.classList.add('is-open');
  $('#patch-input').focus();
}
function closePatchModal() {
  const back = $('#patch-back');
  back.classList.remove('is-open');
  back.setAttribute('hidden', '');
  pendingPatch = null;
}

// Match on id, or pair + entry. Entry may be a full datetime or just YYYY-MM-DD.
function matchPosition(m) {
  if (!m) return null;
  if (m.id) return positions.find(p => p.id === m.id) || null;
  const pair = (m.pair || '').trim().toLowerCase();
  const entry = (m.entry || '').trim();
  const hits = positions.filter(p => {
    if (pair && (p.pair || '').trim().toLowerCase() !== pair) return false;
    if (entry) {
      const pe = String(p.entry || '');
      if (!(pe === entry || pe.slice(0, entry.length) === entry)) return false;
    }
    return true;
  });
  return hits.length === 1 ? hits[0] : (hits.length ? { __ambiguous: hits.length } : null);
}

const PATCH_FIELDS = new Set([
  'pair','protocol','chain','entry','exit','deposited','balance','bottom','top',
  'feesNew','feesClaim','feesSwap','scalp','notes'
]);

function previewPatch() {
  let parsed;
  try {
    parsed = JSON.parse($('#patch-input').value);
  } catch (err) {
    toast('Not valid JSON: ' + err.message, 'err');
    return;
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  let ok = 0;
  list.forEach((entry, i) => {
    const target = matchPosition(entry.match);
    if (!target) {
      rows.push(`<div class="harvest-entry"><div class="hv-date">#${i + 1}</div><div class="hv-amount">no match</div><div class="hv-notes">${escapeHtml(JSON.stringify(entry.match || {}))}</div></div>`);
      return;
    }
    if (target.__ambiguous) {
      rows.push(`<div class="harvest-entry"><div class="hv-date">#${i + 1}</div><div class="hv-amount">${target.__ambiguous} matches</div><div class="hv-notes">too ambiguous — add entry date or id</div></div>`);
      return;
    }
    ok++;
    const changes = [];
    Object.keys(entry.set || {}).forEach(k => {
      if (k === 'tok1' || k === 'tok2') { changes.push(`${k}=${JSON.stringify(entry.set[k])}`); return; }
      if (!PATCH_FIELDS.has(k)) { changes.push(`${k} (ignored)`); return; }
      changes.push(`${k}: ${JSON.stringify(target[k] ?? '')} → ${JSON.stringify(entry.set[k])}`);
    });
    (entry.addHarvest || []).forEach(hv => changes.push(`+harvest ${hv.date} ${money(hv.amount)}`));
    (entry.addDeposit || []).forEach(dp => changes.push(`+deposit ${dp.date} ${money(dp.amount)}`));
    rows.push(`<div class="harvest-entry"><div class="hv-date">${escapeHtml(target.pair || '')}</div><div class="hv-amount">${changes.length} change${changes.length === 1 ? '' : 's'}</div><div class="hv-notes">${escapeHtml(changes.join(' · '))}</div></div>`);
  });
  $('#patch-preview').innerHTML = rows.join('') || '<div class="harvest-log-empty">Nothing to apply.</div>';
  pendingPatch = ok ? list : null;
  $('#patch-apply-btn').disabled = !ok;
  toast(ok ? `${ok} position${ok === 1 ? '' : 's'} will change.` : 'No positions matched.', ok ? 'ok' : 'err');
}

function backfillLegacyLog(target, logKey, totalKey, note) {
  if ((target[logKey] || []).length) return;
  const total = Number(target[totalKey]) || 0;
  if (total <= 0) return;
  target[logKey] = [{
    id: uid(),
    date: (target.entry || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
    amount: total,
    notes: note,
  }];
}

function applyPatch() {
  if (!pendingPatch) return;
  let changed = 0;
  pendingPatch.forEach(entry => {
    const target = matchPosition(entry.match);
    if (!target || target.__ambiguous) return;
    Object.keys(entry.set || {}).forEach(k => {
      const v = entry.set[k];
      if (k === 'tok1' || k === 'tok2') {
        target[k] = {
          sym: (v.sym ?? target[k]?.sym ?? '').toString().toUpperCase(),
          count: v.count !== undefined ? numOrZero(v.count) : numOrZero(target[k]?.count),
          price: v.price !== undefined ? numOrZero(v.price) : numOrZero(target[k]?.price),
        };
      } else if (PATCH_FIELDS.has(k)) {
        target[k] = (typeof v === 'number' || k === 'notes' || typeof v === 'string') ? v : numOrZero(v);
      }
    });
    // Positions that predate the logs carry a total but no entries, and the
    // backfill normally happens when the modal opens. Patching without opening
    // would otherwise append to nothing and wipe the existing total.
    if (entry.addHarvest?.length) {
      backfillLegacyLog(target, 'harvestLog', 'feesClaim', 'Legacy total — exact date unknown');
      target.harvestLog = [...(target.harvestLog || []),
        ...entry.addHarvest.map(hv => ({ id: uid(), date: hv.date, amount: numOrZero(hv.amount), notes: hv.notes || '' }))];
      target.feesClaim = sumHarvestLog(target.harvestLog);
    }
    if (entry.addDeposit?.length) {
      backfillLegacyLog(target, 'depositLog', 'deposited', 'Legacy total — split into real tranches if known');
      target.depositLog = [...(target.depositLog || []),
        ...entry.addDeposit.map(dp => ({ id: uid(), date: dp.date, amount: numOrZero(dp.amount), notes: dp.notes || '' }))];
      target.deposited = sumDepositLog(target.depositLog);
    }
    changed++;
  });
  savePositions();
  render();
  closePatchModal();
  toast(`Patched ${changed} position${changed === 1 ? '' : 's'}.`, 'ok');
}

// ---------- Import / Export ----------
function exportCSV() {
  const headers = [
    'id','pair','protocol','chain','entry','exit','deposited','balance',
    'bottom','top','tok1_sym','tok1_count','tok1_price','tok2_sym','tok2_count','tok2_price',
    'feesNew','feesClaim','feesSwap','scalp','notes','harvestLog','depositLog'
  ];
  const rows = positions.map(p => [
    p.id, p.pair, p.protocol, p.chain, p.entry, p.exit, p.deposited, p.balance,
    p.bottom, p.top, p.tok1?.sym, p.tok1?.count, p.tok1?.price,
    p.tok2?.sym, p.tok2?.count, p.tok2?.price,
    p.feesNew, p.feesClaim, p.feesSwap, p.scalp, (p.notes||'').replace(/\n/g,' '),
    JSON.stringify(p.harvestLog || []),
    JSON.stringify(p.depositLog || [])
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
    harvestLog: parseHarvestLogField(r.harvestLog),
    depositLog: parseHarvestLogField(r.depositLog),
  };
}
function parseHarvestLogField(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const arr = JSON.parse(v); return Array.isArray(arr) ? arr : []; }
    catch { return []; }
  }
  return [];
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
