'use strict';

/* ==========================================================================
   Kairo – privater Krypto-Portfolio-Tracker
   Kurse: CoinGecko Public API · Daten: nur lokal (localStorage)
   ========================================================================== */

const API = 'https://api.coingecko.com/api/v3';
const STORE_KEY = 'kairo.holdings.v1';
const PREFS_KEY = 'kairo.prefs.v1';
const CACHE_KEY = 'kairo.cache.v1';
const PRICE_REFRESH_MS = 60_000;
const PALETTE = ['#c8f550', '#60a5fa', '#f472b6', '#fbbf24', '#34d399', '#a78bfa', '#fb923c', '#22d3ee', '#e879f9', '#94a3b8'];

const $ = (sel, root = document) => root.querySelector(sel);

/* ---------- Formatierung ---------- */

const fmtEur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

function money(v) {
  if (!Number.isFinite(v)) return '–';
  if (Math.abs(v) > 0 && Math.abs(v) < 1) {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumSignificantDigits: 4 }).format(v);
  }
  return fmtEur.format(v);
}

function signedMoney(v) {
  if (!Number.isFinite(v)) return '–';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v));
}

function pct(v) {
  if (!Number.isFinite(v)) return '–';
  const s = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(v));
  return (v > 0 ? '+' : v < 0 ? '−' : '') + s + ' %';
}

function amount(v) {
  const digits = v >= 1000 ? 2 : v >= 1 ? 4 : 8;
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits }).format(v);
}

function tone(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'muted'; }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Akzeptiert "0,5", "1.234,56", "1234.56", "1 234,5".
 * Mit thousands=true wird "52.000" als 52000 gelesen (deutsche Preisangabe).
 */
function parseNum(str, { thousands = false } = {}) {
  if (str == null) return NaN;
  let s = String(str).trim().replace(/[\s€]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (thousands && /^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s)) return NaN;
  return parseFloat(s);
}

function fmtDate(t, days) {
  const d = new Date(t);
  if (days <= 1) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (days <= 30) return d.toLocaleString('de-DE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ---------- Persistenz ---------- */

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* voll oder blockiert */ }
}

const state = {
  holdings: readJSON(STORE_KEY, []),
  prefs: Object.assign({ range: '7', hidden: false }, readJSON(PREFS_KEY, {})),
  markets: {},              // id -> { current_price, price_change_percentage_24h, image, ... }
  cache: readJSON(CACHE_KEY, {}), // "id:days" -> { t: fetchedAt, prices: [[t, p], ...] }
  lastUpdate: null,
  loadingChart: false,
};

function saveHoldings() { writeJSON(STORE_KEY, state.holdings); }
function savePrefs() { writeJSON(PREFS_KEY, state.prefs); }
function saveCache() {
  // Nur Charts der gehaltenen Coins behalten, damit der Speicher klein bleibt.
  const keep = new Set(state.holdings.map(h => h.id));
  for (const k of Object.keys(state.cache)) if (!keep.has(k.split(':')[0])) delete state.cache[k];
  writeJSON(CACHE_KEY, state.cache);
}

/* ---------- API ---------- */

// Die kostenlose CoinGecko-API drosselt schnell. Alle Anfragen laufen daher
// nacheinander durch eine Warteschlange mit Mindestabstand.
const MIN_GAP_MS = 1300;
let queue = Promise.resolve();
let lastRequestAt = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function api(path, { retries = 2 } = {}) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      let res;
      try {
        res = await fetch(API + path, { headers: { accept: 'application/json' } });
      } catch {
        // Gedrosselte Antworten kommen ohne CORS-Header an und landen hier.
        if (attempt < retries) { await sleep(4000 * (attempt + 1)); continue; }
        throw new Error(navigator.onLine === false ? 'Keine Internetverbindung' : 'CoinGecko gerade nicht erreichbar – gleich nochmal versuchen.');
      }
      if (res.ok) return res.json();
      if (res.status === 429 && attempt < retries) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      throw new Error(res.status === 429 ? 'Zu viele Anfragen – bitte kurz warten.' : `API-Fehler ${res.status}`);
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/** Top-250-Coins (mit Logo und Kurs) für die lokale Suche, 6 Std. gecacht. */
const TOP_KEY = 'kairo.top.v1';
let topCoins = readJSON(TOP_KEY, null);
let topPromise = null;

function loadTopCoins() {
  if (topCoins && Date.now() - topCoins.t < 6 * 3600e3) return Promise.resolve(topCoins.coins);
  if (!topPromise) {
    topPromise = api('/coins/markets?vs_currency=eur&order=market_cap_desc&per_page=250&page=1', { retries: 1 })
      .then(data => {
        topCoins = {
          t: Date.now(),
          coins: data.map(c => ({ id: c.id, name: c.name, symbol: c.symbol, image: c.image, price: c.current_price, market_cap_rank: c.market_cap_rank })),
        };
        writeJSON(TOP_KEY, topCoins);
        return topCoins.coins;
      })
      .catch(err => { if (topCoins) return topCoins.coins; throw err; })
      .finally(() => { topPromise = null; });
  }
  return topPromise;
}

function searchLocal(coins, q) {
  const s = q.toLowerCase();
  const score = c => {
    const sym = c.symbol.toLowerCase(), name = c.name.toLowerCase();
    if (sym === s || name === s) return 0;
    if (sym.startsWith(s)) return 1;
    if (name.startsWith(s)) return 2;
    if (name.includes(s) || c.id.includes(s)) return 3;
    return -1;
  };
  return coins
    .map(c => [score(c), c])
    .filter(([sc]) => sc >= 0)
    .sort((a, b) => a[0] - b[0] || (a[1].market_cap_rank || 1e9) - (b[1].market_cap_rank || 1e9))
    .slice(0, 20)
    .map(([, c]) => c);
}

async function fetchMarkets() {
  const ids = [...new Set(state.holdings.map(h => h.id))];
  if (!ids.length) { state.markets = {}; return; }
  const data = await api(`/coins/markets?vs_currency=eur&ids=${encodeURIComponent(ids.join(','))}&price_change_percentage=24h&per_page=250`);
  const next = {};
  for (const m of data) next[m.id] = m;
  state.markets = next;
  state.lastUpdate = new Date();
  // Bilder an den Holdings auffrischen
  let changed = false;
  for (const h of state.holdings) {
    const m = next[h.id];
    if (m && m.image && h.image !== m.image) { h.image = m.image; changed = true; }
  }
  if (changed) saveHoldings();
}

function cacheTtl(days) { return days <= 1 ? 5 * 60e3 : days <= 30 ? 30 * 60e3 : 3 * 3600e3; }

async function getChart(id, days, { force = false } = {}) {
  const key = `${id}:${days}`;
  const hit = state.cache[key];
  if (hit && !force && Date.now() - hit.t < cacheTtl(days)) return hit.prices;
  try {
    const data = await api(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=eur&days=${days}`, { retries: 3 });
    const prices = (data.prices || []).filter(p => Number.isFinite(p[1]));
    state.cache[key] = { t: Date.now(), prices };
    saveCache();
    return prices;
  } catch (err) {
    if (hit) return hit.prices; // veraltete Daten sind besser als keine
    throw err;
  }
}

async function searchCoins(q) {
  const data = await api(`/search?query=${encodeURIComponent(q)}`, { retries: 0 });
  return (data.coins || []).slice(0, 20);
}

/* ---------- Berechnungen ---------- */

function priceOf(id) { return state.markets[id]?.current_price; }

function computePortfolio() {
  let total = 0, prevTotal = 0, invested = 0, valueWithCost = 0, priced = 0;
  const rows = state.holdings.map(h => {
    const m = state.markets[h.id];
    const price = m?.current_price;
    const value = Number.isFinite(price) ? price * h.amount : NaN;
    const ch = m?.price_change_percentage_24h;
    const prev = Number.isFinite(value) && Number.isFinite(ch) ? value / (1 + ch / 100) : value;
    const cost = Number.isFinite(h.buyPrice) ? h.buyPrice * h.amount : NaN;
    if (Number.isFinite(value)) { total += value; prevTotal += prev; priced++; }
    if (Number.isFinite(cost) && Number.isFinite(value)) { invested += cost; valueWithCost += value; }
    return {
      ...h, price, value, change24h: ch,
      cost, pnl: value - cost, pnlPct: cost > 0 ? (value - cost) / cost * 100 : NaN,
    };
  });
  rows.sort((a, b) => (b.value || 0) - (a.value || 0));
  return {
    rows, total, priced,
    change24h: total - prevTotal,
    change24hPct: prevTotal > 0 ? (total - prevTotal) / prevTotal * 100 : NaN,
    invested,
    pnl: invested > 0 ? valueWithCost - invested : NaN,
    pnlPct: invested > 0 ? (valueWithCost - invested) / invested * 100 : NaN,
  };
}

/** Index des Punkts mit Zeitstempel <= t (binäre Suche). */
function nearestIndex(series, t) {
  let lo = 0, hi = series.length - 1;
  if (t <= series[0][0]) return 0;
  if (t >= series[hi][0]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Portfolio-Verlauf mit den aktuellen Mengen über die gewählte Zeitspanne. */
function buildPortfolioSeries(chartsById) {
  const entries = state.holdings
    .map(h => ({ h, s: chartsById[h.id] }))
    .filter(e => e.s && e.s.length > 1);
  if (!entries.length) return [];
  // Basis-Zeitachse: die Reihe mit den meisten Punkten
  const base = entries.reduce((a, b) => (b.s.length > a.s.length ? b : a)).s;
  const start = Math.max(...entries.map(e => e.s[0][0]));
  return base
    .filter(p => p[0] >= start)
    .map(([t]) => [t, entries.reduce((sum, { h, s }) => sum + h.amount * s[nearestIndex(s, t)][1], 0)]);
}

/* ---------- Chart (SVG) ---------- */

let chartSeq = 0;

function renderLineChart(el, series, { onHover, height = 180, days = 7 } = {}) {
  el.innerHTML = '';
  if (!series || series.length < 2) {
    el.innerHTML = '<div class="chart-empty">Noch keine Chartdaten verfügbar</div>';
    return;
  }
  const W = Math.max(el.clientWidth, 200), H = height, padY = 10;
  const t0 = series[0][0], t1 = series[series.length - 1][0];
  let vMin = Infinity, vMax = -Infinity;
  for (const [, v] of series) { if (v < vMin) vMin = v; if (v > vMax) vMax = v; }
  if (vMin === vMax) { vMin *= 0.995; vMax *= 1.005; }
  const x = t => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = v => padY + (1 - (v - vMin) / (vMax - vMin)) * (H - padY * 2);
  const up = series[series.length - 1][1] >= series[0][1];
  const color = up ? 'var(--up)' : 'var(--down)';
  const gid = `g${++chartSeq}`;

  let d = '';
  series.forEach(([t, v], i) => { d += `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; });
  const area = `${d}L${W},${H}L0,${H}Z`;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${up ? '#34d399' : '#f87171'}" stop-opacity=".22"/>
        <stop offset="100%" stop-color="${up ? '#34d399' : '#f87171'}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <line class="cursor" y1="0" y2="${H}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>
    <circle class="dot" r="4.5" fill="${color}" stroke="var(--card)" stroke-width="2" visibility="hidden"/>
  `;
  el.appendChild(svg);

  const cursor = svg.querySelector('.cursor');
  const dot = svg.querySelector('.dot');

  const move = e => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = t0 + (px / W) * (t1 - t0);
    let i = nearestIndex(series, t);
    if (i < series.length - 1 && Math.abs(series[i + 1][0] - t) < Math.abs(series[i][0] - t)) i++;
    const [pt, pv] = series[i];
    const cx = x(pt), cy = y(pv);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx);
    cursor.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
    dot.setAttribute('visibility', 'visible');
    onHover?.({ t: pt, v: pv, first: series[0][1], days });
  };
  const leave = () => {
    cursor.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    onHover?.(null);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
  svg.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') leave(); });
  svg.addEventListener('pointercancel', leave);
}

function rangeLabel(days) {
  return { 1: '24 Std.', 7: '7 Tage', 30: '1 Monat', 90: '3 Monate', 365: '1 Jahr' }[days] || `${days} Tage`;
}

function chartHeadHtml(series, hover, days) {
  if (!series || series.length < 2) return '&nbsp;';
  if (hover) {
    const diff = hover.v - hover.first;
    return `<strong class="money">${money(hover.v)}</strong> · <span class="${tone(diff)}">${pct(diff / hover.first * 100)}</span> · ${esc(fmtDate(hover.t, days))}`;
  }
  const first = series[0][1], last = series[series.length - 1][1];
  const diff = last - first;
  return `<span class="${tone(diff)} money">${signedMoney(diff)}</span> <span class="${tone(diff)}">(${pct(diff / first * 100)})</span> · ${rangeLabel(days)}`;
}

/* ---------- Rendering ---------- */

let currentSeries = [];

function coinIcon(h, cls = 'coin-icon') {
  const img = h.image || state.markets[h.id]?.image || h.thumb;
  if (img) return `<img class="${cls}" src="${esc(img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls} coin-fallback',textContent:'${esc((h.symbol || '?').slice(0, 3).toUpperCase())}'}))">`;
  return `<div class="${cls} coin-fallback">${esc((h.symbol || '?').slice(0, 3).toUpperCase())}</div>`;
}

function render() {
  const p = computePortfolio();
  const has = state.holdings.length > 0;

  document.body.classList.toggle('hide-money', state.prefs.hidden);
  $('#empty').hidden = has;
  $('#chartCard').hidden = !has;
  $('#stats').hidden = !has;
  $('#allocCard').hidden = !has;

  // Hero
  $('#total').textContent = has ? (p.priced ? money(p.total) : '…') : money(0);
  $('#heroSub').innerHTML = has && p.priced
    ? `<span class="${tone(p.change24h)} money">${signedMoney(p.change24h)}</span><span class="pill ${p.change24h >= 0 ? 'up' : 'down'}">${pct(p.change24hPct)}</span><span class="muted">24 Std.</span>`
    : '';

  // Stats
  $('#statInvested').textContent = p.invested > 0 ? money(p.invested) : '–';
  const pnlEl = $('#statPnl');
  pnlEl.textContent = Number.isFinite(p.pnl) ? signedMoney(p.pnl) : '–';
  pnlEl.className = `stat-value money ${Number.isFinite(p.pnl) ? tone(p.pnl) : ''}`;
  const pnlPctEl = $('#statPnlPct');
  pnlPctEl.textContent = Number.isFinite(p.pnlPct) ? pct(p.pnlPct) : 'Kaufpreis eintragen';
  pnlPctEl.className = `stat-sub ${Number.isFinite(p.pnlPct) ? tone(p.pnlPct) : 'muted'}`;

  // Allocation
  const colored = p.rows.filter(r => r.value > 0);
  const top = colored.slice(0, 7);
  const rest = colored.slice(7).reduce((s, r) => s + r.value, 0);
  const parts = top.map((r, i) => ({ name: r.symbol.toUpperCase(), value: r.value, color: PALETTE[i] }));
  if (rest > 0) parts.push({ name: 'Andere', value: rest, color: PALETTE[PALETTE.length - 1] });
  $('#allocBar').innerHTML = parts.map(s => `<span style="width:${(s.value / p.total * 100).toFixed(2)}%;background:${s.color}"></span>`).join('');
  $('#allocLegend').innerHTML = parts.map(s => `
    <li><span class="dot" style="background:${s.color}"></span><span class="name">${esc(s.name)}</span><span class="pct">${pct(s.value / p.total * 100).replace('+', '')}</span></li>
  `).join('');

  // Asset-Liste
  $('#assetList').innerHTML = p.rows.map(r => `
    <li class="asset" data-id="${esc(r.id)}" tabindex="0">
      ${coinIcon(r)}
      <div class="asset-main">
        <div class="asset-name">${esc(r.name)}</div>
        <div class="asset-sub"><span class="money">${amount(r.amount)}</span> ${esc(r.symbol.toUpperCase())} · ${Number.isFinite(r.price) ? money(r.price) : '…'}</div>
      </div>
      <div class="asset-right">
        <div class="asset-value money">${Number.isFinite(r.value) ? money(r.value) : '…'}</div>
        <div class="asset-change ${tone(r.change24h)}">${pct(r.change24h)}</div>
      </div>
    </li>
  `).join('');

  // Footer
  $('#foot').innerHTML = state.lastUpdate
    ? `Aktualisiert ${state.lastUpdate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · Kurse von <a href="https://www.coingecko.com" target="_blank" rel="noopener">CoinGecko</a>`
    : 'Kurse von <a href="https://www.coingecko.com" target="_blank" rel="noopener">CoinGecko</a>';

  // Range-Buttons
  document.querySelectorAll('#ranges button').forEach(b => b.classList.toggle('active', b.dataset.r === state.prefs.range));
}

function drawPortfolioChart() {
  const el = $('#portfolioChart');
  const days = Number(state.prefs.range);
  renderLineChart(el, currentSeries, {
    days,
    onHover: hv => { $('#chartHead').innerHTML = chartHeadHtml(currentSeries, hv, days); },
  });
  $('#chartHead').innerHTML = chartHeadHtml(currentSeries, null, days);
}

let chartToken = 0;

async function loadPortfolioChart({ force = false } = {}) {
  if (!state.holdings.length) return;
  const token = ++chartToken;
  const days = Number(state.prefs.range);
  const el = $('#portfolioChart');
  if (!currentSeries.length) {
    el.innerHTML = '<div class="chart-loading"></div>';
    $('#chartHead').innerHTML = '&nbsp;';
  }

  const ids = [...new Set(state.holdings.map(h => h.id))];
  const charts = {};
  let failed = 0;
  // Nacheinander laden, um das Rate-Limit der kostenlosen API zu schonen.
  for (const id of ids) {
    try { charts[id] = await getChart(id, days, { force }); } catch { failed++; }
    if (token !== chartToken) return; // Zeitraum wurde inzwischen gewechselt
  }
  if (failed) {
    // Teil-Daten würden einen falschen Verlauf zeigen – lieber den alten behalten.
    if (!currentSeries.length) el.innerHTML = '<div class="chart-empty">Chart gerade nicht verfügbar – tippe oben auf Aktualisieren.</div>';
    toast('Chartdaten gerade nicht verfügbar');
    return;
  }
  currentSeries = buildPortfolioSeries(charts);
  // Letzten Punkt an den Live-Kurs angleichen
  const p = computePortfolio();
  if (currentSeries.length && p.priced === state.holdings.length) {
    currentSeries.push([Date.now(), p.total]);
  }
  drawPortfolioChart();
}

async function refresh({ force = false, silent = false } = {}) {
  const btn = $('#btnRefresh');
  btn.classList.add('spinning');
  try {
    await fetchMarkets();
    render();
    await loadPortfolioChart({ force });
  } catch (err) {
    if (!silent) toast(err.message || 'Kurse konnten nicht geladen werden');
    render();
  } finally {
    btn.classList.remove('spinning');
  }
}

/* ---------- Toast ---------- */

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

/* ---------- Sheet ---------- */

function openSheet(html, onMount) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="grabber"></div>${html}`;
  $('#backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  onMount?.(sheet);
}

function closeSheet() {
  $('#backdrop').hidden = true;
  $('#sheet').innerHTML = '';
  document.body.style.overflow = '';
}

const closeBtn = `<button class="icon-btn" data-close aria-label="Schließen"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;

/* ---------- Asset hinzufügen ---------- */

function openAdd() {
  openSheet(`
    <div class="sheet-head"><h3>Asset hinzufügen</h3>${closeBtn}</div>
    <div class="field">
      <div class="input-wrap">
        <input id="q" type="search" placeholder="Coin suchen, z. B. Bitcoin, ETH, SOL" autocomplete="off" autofocus />
      </div>
    </div>
    <ul class="search-results" id="results"></ul>
  `, sheet => {
    const input = $('#q', sheet);
    const list = $('#results', sheet);
    let timer, seq = 0;

    const show = coins => {
      if (!coins.length) { list.innerHTML = '<li class="muted" style="cursor:default">Keine Treffer</li>'; return; }
      list.innerHTML = coins.map((c, i) => `
        <li data-i="${i}">
          ${coinIcon({ image: c.image || c.large || c.thumb, symbol: c.symbol })}
          <div><div class="asset-name">${esc(c.name)}</div><div class="asset-sub">${esc(c.symbol.toUpperCase())}</div></div>
          ${c.market_cap_rank ? `<span class="rank">#${c.market_cap_rank}</span>` : ''}
        </li>`).join('');
      list.querySelectorAll('li[data-i]').forEach(li => li.addEventListener('click', () => {
        const c = coins[Number(li.dataset.i)];
        openAmountForm({ id: c.id, name: c.name, symbol: c.symbol, image: c.image || c.large || c.thumb, price: c.price });
      }));
    };

    let top = topCoins?.coins || null;
    const fallback = [
      { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc', market_cap_rank: 1 },
      { id: 'ethereum', name: 'Ethereum', symbol: 'eth', market_cap_rank: 2 },
      { id: 'solana', name: 'Solana', symbol: 'sol' },
      { id: 'ripple', name: 'XRP', symbol: 'xrp' },
      { id: 'cardano', name: 'Cardano', symbol: 'ada' },
      { id: 'dogecoin', name: 'Dogecoin', symbol: 'doge' },
    ];
    const popular = () => (top ? top.slice(0, 20) : fallback);

    const runSearch = () => {
      clearTimeout(timer);
      const q = input.value.trim();
      const my = ++seq;
      if (!q) { show(popular()); return; }
      const local = top ? searchLocal(top, q) : [];
      if (local.length) show(local);
      // Nur bei wenigen lokalen Treffern zusätzlich die volle Suche fragen
      if (local.length >= 3 || q.length < 2) { if (!local.length) show([]); return; }
      timer = setTimeout(async () => {
        try {
          const remote = await searchCoins(q);
          if (my !== seq) return;
          const seen = new Set(local.map(c => c.id));
          show([...local, ...remote.filter(c => !seen.has(c.id))].slice(0, 20));
        } catch (err) {
          if (my === seq && !local.length) list.innerHTML = `<li class="muted" style="cursor:default">${esc(err.message)}</li>`;
        }
      }, 500);
    };

    show(popular());
    if (!top) loadTopCoins().then(c => { top = c; if (list.isConnected) runSearch(); }).catch(() => {});
    input.addEventListener('input', runSearch);
    setTimeout(() => input.focus(), 50);
  });
}

function openAmountForm(coin, existing = null) {
  const editing = !!existing;
  openSheet(`
    <div class="sheet-head"><h3>${editing ? 'Bestand bearbeiten' : 'Bestand eintragen'}</h3>${closeBtn}</div>
    <div class="picked">
      ${coinIcon(coin)}
      <div><div class="asset-name">${esc(coin.name)}</div><div class="asset-sub">${esc(coin.symbol.toUpperCase())}</div></div>
      ${editing ? '' : '<button class="text-btn change-coin" id="changeCoin">Ändern</button>'}
    </div>
    <form id="form" novalidate>
      <div class="field">
        <label for="amt">Menge</label>
        <div class="input-wrap">
          <input id="amt" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${editing ? esc(String(existing.amount).replace('.', ',')) : ''}" />
          <span class="suffix">${esc(coin.symbol.toUpperCase())}</span>
        </div>
      </div>
      <div class="field">
        <label for="buy">Ø Kaufpreis pro ${esc(coin.symbol.toUpperCase())} <span class="muted">(optional)</span></label>
        <div class="input-wrap">
          <input id="buy" inputmode="decimal" placeholder="z. B. 42.500,00" autocomplete="off" value="${editing && Number.isFinite(existing.buyPrice) ? esc(String(existing.buyPrice).replace('.', ',')) : ''}" />
          <button type="button" class="inline-btn" id="useCurrent">Akt. Kurs</button>
          <span class="suffix">€</span>
        </div>
        <div class="hint" id="buyHint">Für Gewinn/Verlust. ${editing ? '' : 'Hast du den Coin schon, wird ein gewichteter Durchschnittspreis gebildet.'}</div>
      </div>
      <div class="hint" id="preview" style="margin-bottom:14px"></div>
      <button class="primary-btn" type="submit" id="save" disabled>${editing ? 'Speichern' : 'Hinzufügen'}</button>
    </form>
  `, sheet => {
    const amt = $('#amt', sheet), buy = $('#buy', sheet), save = $('#save', sheet), preview = $('#preview', sheet);
    let livePrice = priceOf(coin.id) ?? coin.price ?? topCoins?.coins.find(c => c.id === coin.id)?.price;

    const update = () => {
      const a = parseNum(amt.value);
      const b = buy.value.trim() ? parseNum(buy.value, { thousands: true }) : null;
      const okA = Number.isFinite(a) && a > 0;
      const okB = b === null || (Number.isFinite(b) && b >= 0);
      save.disabled = !(okA && okB);
      preview.innerHTML = okA && Number.isFinite(livePrice)
        ? `Aktueller Wert: <strong style="color:var(--text)">${money(a * livePrice)}</strong> (Kurs ${money(livePrice)})`
        : '';
    };

    if (!Number.isFinite(livePrice)) {
      api(`/simple/price?ids=${encodeURIComponent(coin.id)}&vs_currencies=eur`, { retries: 0 })
        .then(d => { livePrice = d[coin.id]?.eur; update(); })
        .catch(() => {});
    }

    amt.addEventListener('input', update);
    buy.addEventListener('input', update);
    $('#useCurrent', sheet).addEventListener('click', () => {
      if (Number.isFinite(livePrice)) {
        buy.value = new Intl.NumberFormat('de-DE', { maximumFractionDigits: livePrice < 1 ? 6 : 2, useGrouping: false }).format(livePrice);
        update();
      } else toast('Kurs wird noch geladen …');
    });
    $('#changeCoin', sheet)?.addEventListener('click', openAdd);

    $('#form', sheet).addEventListener('submit', e => {
      e.preventDefault();
      if (save.disabled) return;
      const a = parseNum(amt.value);
      const b = buy.value.trim() ? parseNum(buy.value, { thousands: true }) : null;
      upsertHolding(coin, a, b, editing);
      closeSheet();
      toast(editing ? 'Gespeichert' : `${coin.name} hinzugefügt`);
      currentSeries = [];
      refresh();
    });

    update();
    setTimeout(() => amt.focus(), 50);
  });
}

function upsertHolding(coin, amountVal, buyPrice, replace) {
  const idx = state.holdings.findIndex(h => h.id === coin.id);
  const base = { id: coin.id, name: coin.name, symbol: coin.symbol, image: coin.image };
  if (idx === -1) {
    state.holdings.push({ ...base, amount: amountVal, buyPrice: buyPrice ?? null, addedAt: Date.now() });
  } else if (replace) {
    Object.assign(state.holdings[idx], { amount: amountVal, buyPrice: buyPrice ?? null });
  } else {
    // Nachkauf: Menge addieren, Durchschnittspreis gewichten
    const h = state.holdings[idx];
    const total = h.amount + amountVal;
    let avg = null;
    if (Number.isFinite(h.buyPrice) && Number.isFinite(buyPrice)) avg = (h.amount * h.buyPrice + amountVal * buyPrice) / total;
    else if (Number.isFinite(h.buyPrice)) avg = h.buyPrice;
    else if (Number.isFinite(buyPrice)) avg = buyPrice;
    Object.assign(h, { amount: total, buyPrice: avg });
  }
  saveHoldings();
}

/* ---------- Detailansicht ---------- */

function openDetail(id) {
  const p = computePortfolio();
  const r = p.rows.find(x => x.id === id);
  if (!r) return;
  let days = Number(state.prefs.range);

  openSheet(`
    <div class="sheet-head">
      <div class="detail-head">
        ${coinIcon(r)}
        <div><div class="asset-name" style="font-size:17px">${esc(r.name)}</div><div class="asset-sub">${esc(r.symbol.toUpperCase())}</div></div>
      </div>
      ${closeBtn}
    </div>
    <div class="detail-price">${money(r.price)}</div>
    <div class="chart-head" id="dHead" style="padding:0">&nbsp;</div>
    <div class="detail-chart"><div class="chart" id="dChart"><div class="chart-loading"></div></div></div>
    <div class="ranges" id="dRanges">
      ${[['1', '24H'], ['7', '7T'], ['30', '1M'], ['90', '3M'], ['365', '1J']].map(([v, l]) => `<button data-r="${v}" class="${Number(v) === days ? 'active' : ''}">${l}</button>`).join('')}
    </div>
    <div class="detail-grid">
      <div class="stat"><div class="stat-label">Bestand</div><div class="stat-value money">${amount(r.amount)} ${esc(r.symbol.toUpperCase())}</div></div>
      <div class="stat"><div class="stat-label">Wert</div><div class="stat-value money">${money(r.value)}</div></div>
      <div class="stat"><div class="stat-label">Ø Kaufpreis</div><div class="stat-value">${Number.isFinite(r.buyPrice) ? money(r.buyPrice) : '–'}</div></div>
      <div class="stat"><div class="stat-label">Gewinn / Verlust</div>
        <div class="stat-value money ${Number.isFinite(r.pnl) ? tone(r.pnl) : ''}">${Number.isFinite(r.pnl) ? signedMoney(r.pnl) : '–'}</div>
        <div class="stat-sub ${Number.isFinite(r.pnlPct) ? tone(r.pnlPct) : 'muted'}">${Number.isFinite(r.pnlPct) ? pct(r.pnlPct) : ''}</div>
      </div>
      <div class="stat"><div class="stat-label">24 Std.</div><div class="stat-value ${tone(r.change24h)}">${pct(r.change24h)}</div></div>
      <div class="stat"><div class="stat-label">Anteil</div><div class="stat-value">${p.total > 0 ? pct(r.value / p.total * 100).replace('+', '') : '–'}</div></div>
    </div>
    <div class="btn-row">
      <button class="secondary-btn" id="dEdit">Bearbeiten</button>
      <button class="danger-btn" id="dDel">Entfernen</button>
    </div>
  `, sheet => {
    let token = 0;
    const load = async () => {
      const my = ++token;
      const el = $('#dChart', sheet);
      try {
        const series = (await getChart(id, days)).slice();
        if (my !== token || !el.isConnected) return;
        if (Number.isFinite(r.price) && series.length) series.push([Date.now(), r.price]);
        renderLineChart(el, series, {
          days,
          onHover: hv => { $('#dHead', sheet).innerHTML = chartHeadHtml(series, hv, days); },
        });
        $('#dHead', sheet).innerHTML = chartHeadHtml(series, null, days);
      } catch (err) {
        if (my === token && el.isConnected) el.innerHTML = `<div class="chart-empty">${esc(err.message)}</div>`;
      }
    };
    $('#dRanges', sheet).addEventListener('click', e => {
      const b = e.target.closest('button[data-r]');
      if (!b) return;
      days = Number(b.dataset.r);
      sheet.querySelectorAll('#dRanges button').forEach(x => x.classList.toggle('active', x === b));
      $('#dChart', sheet).innerHTML = '<div class="chart-loading"></div>';
      load();
    });
    $('#dEdit', sheet).addEventListener('click', () => {
      const h = state.holdings.find(x => x.id === id);
      openAmountForm(h, h);
    });
    $('#dDel', sheet).addEventListener('click', () => {
      if (!confirm(`${r.name} aus dem Portfolio entfernen?`)) return;
      state.holdings = state.holdings.filter(x => x.id !== id);
      saveHoldings();
      closeSheet();
      currentSeries = [];
      render();
      loadPortfolioChart();
      toast(`${r.name} entfernt`);
    });
    // Erst nach dem Layout zeichnen, damit die Breite stimmt
    requestAnimationFrame(load);
  });
}

/* ---------- Einstellungen ---------- */

function openSettings() {
  openSheet(`
    <div class="sheet-head"><h3>Einstellungen</h3>${closeBtn}</div>
    <p class="settings-note">Deine Bestände werden ausschließlich lokal in diesem Browser gespeichert. Kurse kommen live von CoinGecko und werden jede Minute aktualisiert. Mit Export/Import kannst du deine Daten sichern oder auf ein anderes Gerät übertragen.</p>
    <div class="settings-list">
      <button class="secondary-btn" id="sExport">Daten exportieren (JSON)</button>
      <button class="secondary-btn" id="sImport">Daten importieren</button>
      <input type="file" id="sFile" accept="application/json,.json" hidden />
      <button class="danger-btn" id="sReset">Alle Daten löschen</button>
    </div>
  `, sheet => {
    $('#sExport', sheet).addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ app: 'kairo', version: 1, exportedAt: new Date().toISOString(), holdings: state.holdings }, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `kairo-portfolio-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('#sImport', sheet).addEventListener('click', () => $('#sFile', sheet).click());
    $('#sFile', sheet).addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const list = Array.isArray(data) ? data : data.holdings;
        if (!Array.isArray(list)) throw new Error();
        const clean = list
          .filter(h => h && typeof h.id === 'string' && Number.isFinite(Number(h.amount)) && Number(h.amount) > 0)
          .map(h => ({
            id: h.id, name: String(h.name || h.id), symbol: String(h.symbol || h.id),
            image: typeof h.image === 'string' ? h.image : undefined,
            amount: Number(h.amount),
            buyPrice: Number.isFinite(Number(h.buyPrice)) && h.buyPrice !== null ? Number(h.buyPrice) : null,
            addedAt: h.addedAt || Date.now(),
          }));
        if (!clean.length) throw new Error();
        if (state.holdings.length && !confirm(`${clean.length} Assets importieren und aktuelle Daten ersetzen?`)) return;
        state.holdings = clean;
        saveHoldings();
        closeSheet();
        currentSeries = [];
        toast(`${clean.length} Assets importiert`);
        refresh();
      } catch {
        toast('Datei konnte nicht gelesen werden');
      }
    });
    $('#sReset', sheet).addEventListener('click', () => {
      if (!confirm('Wirklich alle Assets löschen? Das kann nicht rückgängig gemacht werden.')) return;
      state.holdings = [];
      state.markets = {};
      state.cache = {};
      saveHoldings(); saveCache();
      currentSeries = [];
      closeSheet();
      render();
      toast('Alle Daten gelöscht');
    });
  });
}

/* ---------- Events ---------- */

$('#btnAdd').addEventListener('click', openAdd);
$('#btnAddEmpty').addEventListener('click', openAdd);
$('#btnSettings').addEventListener('click', openSettings);
$('#btnRefresh').addEventListener('click', () => refresh({ force: true }));
$('#btnHide').addEventListener('click', () => {
  state.prefs.hidden = !state.prefs.hidden;
  savePrefs();
  render();
});

$('#ranges').addEventListener('click', e => {
  const b = e.target.closest('button[data-r]');
  if (!b || b.dataset.r === state.prefs.range) return;
  state.prefs.range = b.dataset.r;
  savePrefs();
  currentSeries = [];
  render();
  loadPortfolioChart();
});

$('#assetList').addEventListener('click', e => {
  const li = e.target.closest('.asset');
  if (li) openDetail(li.dataset.id);
});
$('#assetList').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const li = e.target.closest('.asset');
  if (li) { e.preventDefault(); openDetail(li.dataset.id); }
});

$('#backdrop').addEventListener('click', e => {
  if (e.target.id === 'backdrop' || e.target.closest('[data-close]')) closeSheet();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#backdrop').hidden) closeSheet(); });

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (currentSeries.length) drawPortfolioChart(); }, 150);
});

// Live-Kurse regelmäßig aktualisieren (nur wenn sichtbar)
setInterval(() => {
  if (document.visibilityState === 'visible' && state.holdings.length) {
    fetchMarkets().then(render).catch(() => {});
  }
}, PRICE_REFRESH_MS);
// Chart alle 5 Minuten auffrischen
setInterval(() => {
  if (document.visibilityState === 'visible' && state.holdings.length) loadPortfolioChart();
}, 5 * 60e3);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.holdings.length && state.lastUpdate && Date.now() - state.lastUpdate > PRICE_REFRESH_MS) {
    refresh({ silent: true });
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- Start ---------- */

render();
if (state.holdings.length) refresh();
