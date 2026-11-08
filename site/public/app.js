import { createCostModel, GLOBAL_VENDOR_PRICES } from './cost-model.js';

const $ = id => document.getElementById(id);
const VAIZEL_SERVER = { server_id: 11303, region: 'EU', name: 'Vaizel', faction: 'Elyos' };
const state = { graph: null, servers: [VAIZEL_SERVER], prices: new Map(), quickPriceHistory: new Map(), region: 'EU', server: VAIZEL_SERVER.server_id, mode: 'crafting', profession: 'blacksmithing', category: 'all', selected: null, materialMode: 'optimize', fetchedAt: null };
let modalHistory = null;
const format = value => value == null || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString('it-IT');
const formatAttempts = value => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const formatPercent = value => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const MAX_CRAFT_SUCCESS = 0.9464;
const MAX_COMBO_SUCCESS = 0.23 / (MAX_CRAFT_SUCCESS * 0.25);
const MARKET_TAX_RATE = 0.10;
const AUTO_REFRESH_INTERVAL_MS = 60_000;
const netSale = value => value == null ? null : Number(value) * (1 - MARKET_TAX_RATE);
const QUICK_PRICE_ITEMS = [
  '610511013', '610511015', '610511014',
  '610610013', '610610014', '610610015', '610610016',
  '610530001', '610530005', '610530008', '610530010',
  '610620013', '610710001',
  '610530011',
];
const SEQUENCE_PROFESSIONS = ['blacksmithing', 'tailoring', 'jewelcrafting', 'alchemy'];
const SEQUENCE_CATEGORIES = new Set(['greatsword', 'sword', 'dagger', 'mace', 'guarder', 'helmet', 'shoulder', 'torso', 'pants', 'gloves', 'boots', 'cape', 'bow', 'staff', 'necklace', 'earring', 'ring', 'bracelet', 'magicbook', 'orb']);
const professionLabels = { blacksmithing: 'Blacksmithing', tailoring: 'Armorsmithing', jewelcrafting: 'Handicrafting', alchemy: 'Alchemy', cooking: 'Cooking' };
const professionHints = { blacksmithing: 'Armi e guard', tailoring: 'Armature', jewelcrafting: 'Gioielli, archi e bastoni', alchemy: 'Orbi e grimori', cooking: 'Cibo' };
const categoryLabels = { greatsword: 'Greatsword', sword: 'Longsword', dagger: 'Dagger', mace: 'Mace', guarder: 'Guard', helmet: 'Helm', shoulder: 'Pauldrons', torso: 'Top', pants: 'Legs', gloves: 'Gloves', boots: 'Shoes', cape: 'Cloak', bow: 'Bow', staff: 'Staff', necklace: 'Necklace', earring: 'Earrings', ring: 'Ring', bracelet: 'Bracelet', magicbook: 'Spellbook', orb: 'Orb', potion: 'Potion', scroll: 'Scroll', magicstone: 'Manastone', food: 'Food', drink: 'Drink', craftresource: 'Materials', elevate: 'Upgrade' };
const categoryOrder = Object.keys(categoryLabels);
const masteryLabel = level => level == null ? 'Nessuna maestria indicata' : level > 50 ? 'Professional ' + (level - 50) : 'Novice ' + level;

async function getJSON(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Errore di caricamento');
  return data;
}

function status(message, kind = '') {
  $('status').textContent = message;
  $('status').className = 'status ' + kind;
}

function nameOf(key) {
  const item = state.graph?.items?.[String(key)];
  return item?.n || state.prices.get(String(key))?.name || String(key);
}

function gradeClass(key) {
  const grade = state.graph?.items?.[String(key)]?.g;
  return grade ? ' grade-' + grade : '';
}

function iconOf(key, extraClass = '') {
  const item = state.graph?.items?.[String(key)];
  const url = item?.icon;
  if (!url) return document.createElement('span');
  const image = document.createElement('img');
  image.className = 'itemIcon' + gradeClass(key) + (extraClass ? ' ' + extraClass : '');
  image.src = url;
  image.alt = '';
  image.loading = 'lazy';
  image.onerror = () => image.remove();
  return image;
}

function renderQuickPrices() {
  const list = $('quickPriceList');
  if (!list || !state.graph) return;
  list.replaceChildren(...QUICK_PRICE_ITEMS.map(key => {
    const market = state.prices.get(key);
    const points = state.quickPriceHistory.get(key) || getPriceHistory(key);
    const average = points.length ? points.reduce((sum, point) => sum + Number(point.p), 0) / points.length : null;
    const currentPrice = market?.price == null ? null : Number(market.price);
    const signal = average == null || currentPrice == null ? 'neutral' : currentPrice < average ? 'below' : currentPrice > average ? 'above' : 'neutral';
    const card = document.createElement('button'); card.type = 'button'; card.className = 'quickPrice' + (signal === 'neutral' ? '' : ' price-' + signal); card.setAttribute('aria-label', 'Mostra lo storico prezzo di ' + nameOf(key) + (signal === 'below' ? ': sotto la media' : signal === 'above' ? ': sopra la media' : ''));
    const text = document.createElement('div');
    const name = document.createElement('span'); name.className = 'quickPriceName itemGrade' + gradeClass(key); name.textContent = nameOf(key); name.title = name.textContent;
    const price = document.createElement('strong'); price.textContent = market?.price == null ? '—' : format(Number(market.price)) + ' Kina';
    const listings = document.createElement('small'); listings.textContent = market ? (market.listings || 0) + ' annunci' : 'Prezzo non disponibile';
    text.append(name, price, listings);
    const itemIcon = iconOf(key, 'quickPriceIcon');
    if (signal !== 'neutral') itemIcon.classList.add('signal-' + signal);
    card.append(itemIcon, text);
    card.addEventListener('click', () => openMarketModal(key));
    return card;
  }));
}

async function loadQuickPriceHistory() {
  try {
    const query = new URLSearchParams({ server: String(state.server), items: QUICK_PRICE_ITEMS.join(',') });
    const response = await fetch('/api/history?' + query, { cache: 'no-cache' });
    const result = await response.json();
    if (!response.ok || !result.histories) return;
    state.quickPriceHistory = new Map(Object.entries(result.histories));
    renderQuickPrices();
  } catch { /* Usa lo storico locale del browser come ripiego. */ }
}

const HISTORY_LIMIT = 24 * 60 * 60 * 1000;
function priceHistoryKey(serverId) { return 'aion2craft:priceHistory:' + serverId; }
function savePriceHistory(prices, timestamp) {
  const key = priceHistoryKey(state.server);
  let history = {};
  try { history = JSON.parse(localStorage.getItem(key) || '{}'); } catch { history = {}; }
  const compact = {};
  for (const [itemKey, item] of prices) {
    if (item?.price == null || !Number.isFinite(Number(item.price))) continue;
    const points = (Array.isArray(history[itemKey]) ? history[itemKey] : [])
      .filter(point => Number.isFinite(point.t) && Number.isFinite(point.p) && timestamp - point.t <= HISTORY_LIMIT);
    const reduced = [];
    for (const point of [...points, { t: timestamp, p: Number(item.price) }]) {
      // Keep the start and end of a flat stretch, rather than one point per minute.
      if (reduced.length >= 2 && reduced.at(-1).p === point.p && reduced.at(-2).p === point.p) reduced[reduced.length - 1] = point;
      else reduced.push(point);
    }
    compact[itemKey] = reduced.slice(-128);
  }
  let serialized = JSON.stringify(compact);
  const oldest = Object.keys(compact).sort((a, b) => compact[a].at(-1).t - compact[b].at(-1).t);
  while (serialized.length > 600_000 && oldest.length) {
    delete compact[oldest.shift()]; serialized = JSON.stringify(compact);
  }
  try { localStorage.setItem(key, serialized); }
  catch {
    // A full browser cache must never turn a successful market response into an error.
    try {
      localStorage.removeItem(key);
      const quickOnly = Object.fromEntries(Object.entries(compact).filter(([id]) => QUICK_PRICE_ITEMS.includes(id)));
      localStorage.setItem(key, JSON.stringify(quickOnly));
    } catch { /* Shared database history remains available without a local cache. */ }
  }
}

function getPriceHistory(itemKey) {
  try {
    const history = JSON.parse(localStorage.getItem(priceHistoryKey(state.server)) || '{}');
    return Array.isArray(history[itemKey]) ? history[itemKey].filter(point => Number.isFinite(point.p) && Number.isFinite(point.t) && point.t >= Date.now() - HISTORY_LIMIT) : [];
  } catch { return []; }
}

function drawPriceChart(itemKey, historyOverride = null) {
  const canvas = $('marketChart');
  const context = canvas.getContext('2d');
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(bounds.width * ratio));
  canvas.height = Math.max(1, Math.round(bounds.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const width = bounds.width, height = bounds.height;
  const pad = { l: 76, r: 22, t: 28, b: 42 };
  const plotW = Math.max(1, width - pad.l - pad.r), plotH = Math.max(1, height - pad.t - pad.b);
  const cutoff = Date.now() - HISTORY_LIMIT;
  const points = [...(historyOverride || getPriceHistory(itemKey))]
    .filter(point => Number.isFinite(Number(point.p)) && Number.isFinite(Number(point.t)) && Number(point.t) >= cutoff)
    .sort((a, b) => Number(a.t) - Number(b.t));
  const current = state.prices.get(itemKey);
  if (current?.price != null && (!points.length || points.at(-1).p !== Number(current.price))) points.push({ t: Date.now(), p: Number(current.price) });
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#0d1522'; context.fillRect(0, 0, width, height);
  if (!points.length) {
    context.fillStyle = '#b3c3d7'; context.font = '13px system-ui'; context.textAlign = 'center';
    context.fillText('Lo storico si popolerà con le prossime rilevazioni automatiche.', width / 2, height / 2 - 8);
    context.fillStyle = '#8296b0'; context.font = '11px system-ui';
    context.fillText('Viene raccolto un prezzo al minuto; il grafico mostra al massimo 24 ore.', width / 2, height / 2 + 14);
    return { points, average: null, current: current?.price == null ? null : Number(current.price) };
  }
  const values = points.map(point => Number(point.p));
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const currentValue = current?.price == null ? values.at(-1) : Number(current.price);
  const dataMin = Math.min(...values), dataMax = Math.max(...values);
  const span = Math.max(1, dataMax - dataMin, Math.abs(dataMax) * 0.012);
  const low = Math.max(0, dataMin - span * 0.14), high = dataMax + span * 0.14;
  const y = value => pad.t + (high - value) / Math.max(1, high - low) * plotH;
  const start = points[0].t, end = points.at(-1).t, timeRange = Math.max(1, end - start);
  const x = timestamp => pad.l + (timeRange <= 1 ? plotW / 2 : (timestamp - start) / timeRange * plotW);

  // Griglia e scala prezzi.
  context.font = '10px system-ui'; context.textAlign = 'right'; context.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const value = high - (high - low) * i / 4, yy = pad.t + plotH * i / 4;
    context.beginPath(); context.moveTo(pad.l, yy); context.lineTo(width - pad.r, yy);
    context.strokeStyle = i === 4 ? '#33445b' : '#233248'; context.lineWidth = 1; context.stroke();
    context.fillStyle = '#9aacc2'; context.fillText(format(value), pad.l - 10, yy);
  }
  context.beginPath(); context.moveTo(pad.l, pad.t); context.lineTo(pad.l, pad.t + plotH); context.lineTo(width - pad.r, pad.t + plotH);
  context.strokeStyle = '#40536b'; context.lineWidth = 1; context.stroke();

  // Tacche temporali distribuite sulla finestra realmente disponibile.
  const tickCount = points.length < 2 ? 1 : width < 500 ? 3 : 5;
  context.textAlign = 'center'; context.textBaseline = 'top'; context.fillStyle = '#9aacc2'; context.font = '10px system-ui';
  for (let i = 0; i < tickCount; i++) {
    const fraction = tickCount === 1 ? 0 : i / (tickCount - 1);
    const timestamp = start + timeRange * fraction, xx = pad.l + plotW * fraction;
    context.beginPath(); context.moveTo(xx, pad.t + plotH); context.lineTo(xx, pad.t + plotH + 4); context.strokeStyle = '#52647b'; context.stroke();
    const label = new Date(timestamp).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    context.fillText(label, Math.max(34, Math.min(width - 34, xx)), pad.t + plotH + 9);
  }

  const lineColor = currentValue <= average ? '#51e39a' : '#ff6e76';
  const area = context.createLinearGradient(0, pad.t, 0, pad.t + plotH);
  area.addColorStop(0, currentValue <= average ? '#36dc8b55' : '#ff667355');
  area.addColorStop(1, '#0d152200');
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(x(point.t), y(point.p));
    else { context.lineTo(x(point.t), y(points[index - 1].p)); context.lineTo(x(point.t), y(point.p)); }
  });
  context.lineTo(x(points.at(-1).t), pad.t + plotH); context.lineTo(x(points[0].t), pad.t + plotH); context.closePath();
  context.fillStyle = area; context.fill();

  // Linea di media e linea prezzo, con una tonalità diversa sopra/sotto la media.
  context.beginPath(); context.moveTo(pad.l, y(average)); context.lineTo(width - pad.r, y(average));
  context.setLineDash([5, 5]); context.strokeStyle = '#dce7f7bb'; context.lineWidth = 1.4; context.stroke(); context.setLineDash([]);
  context.font = '10px system-ui'; context.textAlign = 'left'; context.textBaseline = 'bottom'; context.fillStyle = '#e2ebf7';
  context.fillText('MEDIA ' + format(average), pad.l + 7, y(average) - 5);

  if (points.length > 1) {
    for (let i = 1; i < points.length; i++) {
      const previous = points[i - 1], point = points[i];
      context.beginPath(); context.moveTo(x(previous.t), y(previous.p)); context.lineTo(x(point.t), y(previous.p));
      context.strokeStyle = Number(previous.p) <= average ? '#51e39a' : '#ff6e76';
      context.lineWidth = 2.4; context.lineJoin = 'round'; context.lineCap = 'round'; context.stroke();
      if (Number(previous.p) !== Number(point.p)) {
        const crossesAverage = (Number(previous.p) - average) * (Number(point.p) - average) < 0;
        const middle = crossesAverage ? average : Number(point.p);
        context.beginPath(); context.moveTo(x(point.t), y(previous.p)); context.lineTo(x(point.t), y(middle));
        context.strokeStyle = Number(previous.p) <= average ? '#51e39a' : '#ff6e76'; context.stroke();
        if (crossesAverage) {
          context.beginPath(); context.moveTo(x(point.t), y(average)); context.lineTo(x(point.t), y(point.p));
          context.strokeStyle = Number(point.p) <= average ? '#51e39a' : '#ff6e76'; context.stroke();
        }
      }
    }
  } else {
    context.fillStyle = '#aebfd5'; context.font = '12px system-ui'; context.textAlign = 'center';
    context.fillText('In attesa della prossima rilevazione', pad.l + plotW / 2, pad.t + plotH / 2);
  }
  // Etichette sui tratti più ampi, evitando sovrapposizioni sui dati molto variabili.
  const plateaus = [];
  for (const point of points) {
    const last = plateaus.at(-1);
    if (last && Number(last.p) === Number(point.p)) last.end = point.t;
    else { if (last) last.end = point.t; plateaus.push({ p: Number(point.p), start: point.t, end: point.t }); }
  }
  const occupied = [];
  context.font = 'bold 11px system-ui';
  for (const segment of [...plateaus].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, width < 500 ? 3 : 6)) {
    const label = format(segment.p) + ' Kina', labelW = context.measureText(label).width + 18;
    const center = (x(segment.start) + x(segment.end)) / 2;
    const left = Math.max(pad.l, Math.min(width - pad.r - labelW, center - labelW / 2));
    const top = Math.max(4, Math.min(pad.t + plotH - 26, y(segment.p) - 31));
    if (occupied.some(rect => left < rect.right + 8 && left + labelW > rect.left - 8 && top < rect.bottom + 6 && top + 23 > rect.top - 6)) continue;
    occupied.push({ left, right: left + labelW, top, bottom: top + 23 });
    context.fillStyle = '#101d2fee'; context.strokeStyle = segment.p <= average ? '#51e39a' : '#ff6e76'; context.lineWidth = 1;
    context.beginPath(); context.roundRect(left, top, labelW, 23, 6); context.fill(); context.stroke();
    const pointerX = Math.max(left + 8, Math.min(left + labelW - 8, center));
    if (y(segment.p) > top + 28) {
      context.beginPath(); context.moveTo(pointerX - 5, top + 23); context.lineTo(pointerX, top + 29); context.lineTo(pointerX + 5, top + 23);
      context.fill(); context.stroke();
    }
    context.fillStyle = '#edf5ff'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(label, left + labelW / 2, top + 12);
  }
  return { points, average, current: currentValue, min: dataMin, max: dataMax };
}

async function openMarketModal(itemKey, forceRefresh = false) {
  const dialog = $('marketModal');
  dialog.dataset.itemKey = String(itemKey);
  $('marketModalTitle').textContent = 'Prezzo mercato · ' + nameOf(itemKey);
  $('marketItemIcon').replaceChildren(iconOf(itemKey));
  $('marketPriceSequence').textContent = 'Caricamento dei prezzi osservati…';
  const current = state.prices.get(itemKey);
  $('marketModalCurrent').textContent = current?.price == null ? 'Prezzo non disponibile' : format(Number(current.price)) + ' Kina';
  if (!dialog.open) dialog.showModal();
  let points = getPriceHistory(itemKey);
  try {
    const response = await fetch('/api/history?server=' + state.server + '&item=' + encodeURIComponent(itemKey) + (forceRefresh ? '&refresh=' + Date.now() : ''), { cache: 'no-cache' });
    const shared = await response.json();
    if (response.ok && Array.isArray(shared.points) && shared.points.length) points = shared.points;
  } catch { /* Local browser history remains available when the collector is not configured. */ }
  if (dialog.dataset.itemKey !== String(itemKey)) return;
  modalHistory = points;
  const changes = points.filter((point, index) => index === 0 || Number(point.p) !== Number(points[index - 1].p));
  $('marketPriceSequence').textContent = changes.length ? 'Prezzi osservati: ' + (changes.length > 5 ? '… → ' : '') + changes.slice(-5).map(point => format(Number(point.p))).join(' → ') + ' Kina' : 'In attesa delle prime rilevazioni';
  $('marketModalCount').textContent = current ? (current.listings || 0) + ' annunci · ' + points.length + ' rilevazioni salvate' : points.length + ' rilevazioni salvate';
  requestAnimationFrame(() => drawPriceChart(itemKey, modalHistory));
  const average = points.length ? points.reduce((sum, point) => sum + point.p, 0) / points.length : current?.price == null ? null : Number(current.price);
  const currentPrice = current?.price == null ? null : Number(current.price);
  const stats = $('marketStats');
  const ordered = [...points].filter(point => Number.isFinite(Number(point.p)) && Number.isFinite(Number(point.t))).sort((a, b) => a.t - b.t);
  const historyValues = ordered.map(point => Number(point.p));
  const firstPrice = historyValues[0] ?? currentPrice, lastPrice = currentPrice ?? historyValues.at(-1);
  const change = firstPrice != null && lastPrice != null ? lastPrice - firstPrice : null;
  const changePercent = change != null && firstPrice ? change / firstPrice * 100 : null;
  stats.replaceChildren(...[
    ['Minimo 24h', historyValues.length ? format(Math.min(...historyValues)) + ' Kina' : '—', ''],
    ['Massimo 24h', historyValues.length ? format(Math.max(...historyValues)) + ' Kina' : '—', ''],
    ['Media 24h', average == null ? '—' : format(average) + ' Kina', ''],
    ['Variazione', change == null ? '—' : (change > 0 ? '+' : '') + format(change) + ' Kina', change == null ? '' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat', changePercent == null ? '' : (changePercent > 0 ? '+' : '') + changePercent.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%'],
  ].map(([label, value, tone, detail]) => {
    const card = document.createElement('div'); card.className = 'marketStat' + (tone ? ' ' + tone : '');
    const title = document.createElement('small'); title.textContent = label;
    const big = document.createElement('strong'); big.textContent = value;
    const sub = document.createElement('span'); sub.textContent = detail || 'ultime 24 ore';
    card.append(title, big, sub); return card;
  }));
  const summary = $('marketSummary');
  if (average == null || currentPrice == null) { summary.className = 'marketSummary equal'; summary.textContent = 'Lo storico inizierà a raccogliere prezzi da questo aggiornamento.'; }
  else if (currentPrice > average) { summary.className = 'marketSummary above'; summary.textContent = 'Sopra la media di ' + format(currentPrice - average) + ' Kina: può convenire attendere un prezzo più basso.'; }
  else if (currentPrice < average) { summary.className = 'marketSummary below'; summary.textContent = 'Sotto la media di ' + format(average - currentPrice) + ' Kina: prezzo relativamente più conveniente.'; }
  else { summary.className = 'marketSummary equal'; summary.textContent = 'Prezzo in linea con la media dello storico.'; }
  if (points.length < 2) { summary.textContent += ' Il grafico diventerà significativo dopo altri refresh.'; }
}

function renderRecommendations() {
  renderBuyRecommendations();
  const list = $('recommendationList');
  if (!list || !state.graph) return;
  if (!state.prices.size) {
    const message = document.createElement('p'); message.className = 'recommendationEmpty'; message.textContent = 'Le occasioni appariranno dopo il caricamento dei prezzi.';
    list.replaceChildren(message);
    return;
  }
  const faction = serverFaction() === 'Asmodian' ? 'dark' : 'light';
  const model = createCostModel(state.graph, unitPrice, faction, key => localStorage.getItem(overrideKey(key)) === '0', {
    optimizeMaterials: true,
    successRateFor: id => state.graph.recipes[id]?.successChance != null ? MAX_CRAFT_SUCCESS : undefined,
    comboSuccessRateFor: id => state.graph.recipes[id]?.comboSuccessChance != null ? MAX_COMBO_SUCCESS : undefined,
  });
  const byResult = new Map();
  for (const [id, recipe] of recipes()) {
    const outputInfo = state.graph.items?.[String(recipe.out)];
    if (recipe.qr !== faction || !['weapon', 'armor'].includes(outputInfo?.mc) || recipe.bound) continue;
    const targetKey = String(recipe.combo || recipe.out);
    const market = state.prices.get(targetKey);
    if (market?.price == null || !Number(market.listings)) continue;
    const attempt = model.ownAttempt(recipe);
    if (attempt.cost == null || attempt.missing.length) continue;
    const craftSuccess = recipe.successChance != null && !recipe.safe ? MAX_CRAFT_SUCCESS : 1;
    const comboSuccess = recipe.comboSuccessChance != null && !recipe.safe ? MAX_COMBO_SUCCESS : 1;
    const resultChance = recipe.combo ? Number(recipe.cp || 0) / 100 * craftSuccess * comboSuccess : craftSuccess;
    const resultYield = recipe.combo ? 1 : Number(recipe.outq) || 1;
    if (!(resultChance > 0)) continue;
    const cost = attempt.cost / (resultChance * resultYield);
    const netMarket = netSale(market.price);
    const profit = netMarket - cost;
    if (!(profit > 0)) continue;
    const candidate = { id, recipe, targetKey, market, netMarket, cost, profit, margin: profit / cost * 100 };
    const previous = byResult.get(targetKey);
    if (!previous || candidate.profit > previous.profit) byResult.set(targetKey, candidate);
  }
  const recommendations = [...byResult.values()].sort((a, b) => b.profit - a.profit).slice(0, 10);
  if (!recommendations.length) {
    const message = document.createElement('p'); message.className = 'recommendationEmpty'; message.textContent = 'Nessun craft con guadagno calcolabile nei prezzi disponibili.';
    list.replaceChildren(message);
    return;
  }
  list.replaceChildren(...recommendations.map((entry, index) => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'recommendationCard';
    const rank = document.createElement('span'); rank.className = 'recommendationRank'; rank.textContent = '#' + (index + 1);
    const head = document.createElement('div'); head.className = 'recommendationHead';
    const text = document.createElement('div'); text.className = 'recommendationText';
    const name = document.createElement('strong'); name.className = 'itemGrade' + gradeClass(entry.targetKey); name.textContent = nameOf(entry.targetKey); name.title = name.textContent;
    const route = document.createElement('small'); route.textContent = (entry.recipe.type === 'transfer' ? 'Transfer Crafting' : 'Crafting') + ' · ' + (categoryLabels[categoryOf(entry.recipe)] || categoryOf(entry.recipe));
    text.append(name); appendItemLevel(text, entry.targetKey || entry.key); text.append(route); head.append(iconOf(entry.targetKey), text, rank);
    const gainLabel = document.createElement('span'); gainLabel.className = 'recommendationGainLabel'; gainLabel.textContent = 'Guadagno stimato';
    const gain = document.createElement('strong'); gain.className = 'recommendationGain'; gain.textContent = '+' + format(entry.profit) + ' Kina';
    const details = document.createElement('small'); details.className = 'recommendationDetails'; details.textContent = 'Componenti comprati ' + format(entry.cost) + ' → netto dopo tassa 10% ' + format(entry.netMarket) + ' · ' + entry.market.listings + ' annunci';
    card.append(head, gainLabel, gain, details);
    card.addEventListener('click', () => {
      state.mode = entry.recipe.type;
      state.profession = entry.recipe.p;
      state.category = categoryOf(entry.recipe);
      state.selected = entry.id;
      $('search').value = '';
      fillModes(); fillProfessions(); fillCategories(); renderResults(); renderDetail();
      document.querySelector('.layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return card;
  }));
}

function itemLevelDescription(key) {
  const item = state.graph.items?.[String(key)];
  if (item?.level) return 'Livello oggetto ' + item.level;
  const itemName = nameOf(key);
  // Global item-card tiers documented by the publisher of the crafting dataset.
  if (/^Artisan's Splendent /.test(itemName)) return 'Livello oggetto 44';
  if (/^Artisan's /.test(itemName) && ['weapon', 'armor', 'accessory'].includes(item?.mc)) return 'Livello oggetto 39';
  if (/^Expert's Splendent /.test(itemName)) return 'Livello oggetto 35';
  if (/^Expert's /.test(itemName) && ['weapon', 'armor', 'accessory'].includes(item?.mc)) return 'Livello oggetto 28';
  if (/^Splendent /.test(itemName) && item?.g === 21) return 'Livello oggetto 22';
  for (const [, recipe] of recipes()) {
    if (recipe.type !== 'transfer') continue;
    const levels = TRANSFER_LEVELS[transferStageNumber(recipe)];
    if (!levels) continue;
    if (String(recipe.out) === String(key)) return 'Livello oggetto ' + levels.to;
    if (recipe.combo && String(recipe.combo) === String(key)) return 'Livello oggetto ' + levels.combo;
    if (String(recipe.transferFrom) === String(key)) return 'Livello oggetto ' + levels.from;
  }
  if (/^(Splendent )?(True|Star) Dragon Lord /.test(nameOf(key))) return 'Livello oggetto ' + (nameOf(key).startsWith('Splendent ') ? 70 : 62);
  return 'Livello oggetto non disponibile';
}
function appendItemLevel(parent, key) {
  const level = document.createElement('small'); level.className = 'itemLevelDescription'; level.textContent = itemLevelDescription(key); parent.append(level);
}
function renderBuyRecommendations() {
  const list = $('buyRecommendationList');
  if (!list || !state.graph) return;
  const faction = serverFaction() === 'Asmodian' ? 'dark' : 'light';
  const model = createCostModel(state.graph, unitPrice, faction, key => localStorage.getItem(overrideKey(key)) === '0', {
    optimizeMaterials: true,
    successRateFor: id => state.graph.recipes[id]?.successChance != null ? MAX_CRAFT_SUCCESS : undefined,
    comboSuccessRateFor: id => state.graph.recipes[id]?.comboSuccessChance != null ? MAX_COMBO_SUCCESS : undefined,
  });
  const candidates = new Map();
  for (const [id, recipe] of recipes()) {
    if (recipe.type !== 'crafting' || recipe.qr !== faction || recipe.bound) continue;
    const attempt = model.ownAttempt(recipe);
    if (attempt.cost == null || attempt.missing.length) continue;
    const dragon = recipe.successChance != null && !recipe.safe;
    for (const key of [...new Set([recipe.out, recipe.combo].filter(Boolean))].map(String)) {
      const itemType = state.graph.items?.[key]?.mc || state.graph.items?.[String(recipe.out)]?.mc;
      if (!['weapon', 'armor', 'accessory'].includes(itemType)) continue;
      if (!/^(Artisan's Splendent |(?:Splendent )?True Dragon Lord )/.test(nameOf(key))) continue;
      const market = state.prices.get(key);
      if (!(market?.price > 0) || !(market.listings > 0)) continue;
      const cost = dragon ? attempt.cost : model.ownUnit(key).cost;
      if (cost == null) continue;
      const previous = candidates.get(key);
      if (!previous || cost < previous.cost) candidates.set(key, { id, recipe, key, market, cost, saving: cost - Number(market.price) });
    }
  }
  const entries = [...candidates.values()].filter(entry => entry.saving > 0).sort((a, b) => b.saving - a.saving).slice(0, 10);
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p'); empty.className = 'recommendationEmpty'; empty.textContent = state.prices.size ? 'Nessun acquisto più conveniente del craft nei prezzi disponibili.' : 'Gli acquisti consigliati appariranno dopo il caricamento dei prezzi.'; list.append(empty); return;
  }
  for (const [index, entry] of entries.entries()) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'recommendationCard';
    const head = document.createElement('div'); head.className = 'recommendationHead';
    const text = document.createElement('div'); text.className = 'recommendationText';
    const name = document.createElement('strong'); name.className = 'itemGrade' + gradeClass(entry.key); name.textContent = nameOf(entry.key); name.title = name.textContent;
    const route = document.createElement('small'); route.textContent = 'Compra il prodotto finito'; text.append(name); appendItemLevel(text, entry.targetKey || entry.key); text.append(route);
    const rank = document.createElement('span'); rank.className = 'recommendationRank'; rank.textContent = '#' + (index + 1); head.append(iconOf(entry.key), text, rank);
    const label = document.createElement('span'); label.className = 'recommendationGainLabel'; label.textContent = 'Risparmio acquistando';
    const saving = document.createElement('strong'); saving.className = 'recommendationGain'; saving.textContent = format(entry.saving) + ' Kina';
    const detail = document.createElement('small'); detail.className = 'recommendationDetails'; detail.textContent = 'Craft ' + format(entry.cost) + ' · acquisto ' + format(entry.market.price) + ' Kina · ' + entry.market.listings + ' annunci';
    card.append(head, label, saving, detail);
    card.addEventListener('click', () => {
      state.mode = 'crafting'; state.profession = entry.recipe.p; state.category = categoryOf(entry.recipe); state.selected = entry.id; $('search').value = '';
      fillModes(); fillProfessions(); fillCategories(); renderResults(); renderDetail(); document.querySelector('.layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    list.append(card);
  }
}

function completeRecipeItemCategories(graph) {
  // Normal and combo results belong to the same equipment category.
  // Fill only missing fields so categories supplied by the dataset stay authoritative.
  for (const recipe of Object.values(graph.recipes || {})) {
    if (!recipe.combo) continue;
    const normal = graph.items?.[String(recipe.out)];
    const combo = graph.items?.[String(recipe.combo)];
    if (!normal || !combo) continue;
    for (const field of ['mc', 'sc']) {
      if (!combo[field] && normal[field]) combo[field] = normal[field];
      if (!normal[field] && combo[field]) normal[field] = combo[field];
    }
  }
}

function recipes() {
  if (!state.graph?.recipes) return [];
  return Object.entries(state.graph.recipes).filter(([, recipe]) => Array.isArray(recipe.in) && recipe.in.length && recipe.out && categoryOf(recipe) !== 'elevate');
}

function serverFaction() {
  return state.servers.find(server => server.server_id === state.server)?.faction;
}

function categoryOf(recipe) {
  return state.graph?.items?.[String(recipe.out)]?.sc || 'other';
}

function professionRecipes() {
  const faction = serverFaction();
  const recipeType = state.mode === 'calculator' ? 'crafting' : state.mode;
  return recipes().filter(([, recipe]) => recipe.type === recipeType && recipe.p === state.profession && (!faction || recipe.qr === (faction === 'Elyos' ? 'light' : 'dark')) && (state.mode !== 'calculator' || (SEQUENCE_CATEGORIES.has(categoryOf(recipe)) && recipe.combo && !recipe.safe)));
}

const TRANSFER_LEVELS = {
  1: { from: 62, to: 70, guaranteed: true },
  2: { from: 70, to: 78, combo: 86 },
  3: { from: 78, to: 86, guaranteed: true },
  4: { from: 86, to: 94, combo: 102 },
  5: { from: 94, to: 102, guaranteed: true },
};

function transferStageNumber(recipe, seen = new Set()) {
  if (!recipe?.transferFrom) return 0;
  const identity = recipe.out + ':' + recipe.transferFrom;
  if (seen.has(identity)) return 1;
  const nextSeen = new Set(seen).add(identity);
  const producers = Object.values(state.graph?.recipes || {}).filter(candidate =>
    candidate.type === 'transfer' && candidate !== recipe && candidate.p === recipe.p && candidate.qr === recipe.qr &&
    categoryOf(candidate) === categoryOf(recipe) &&
    [candidate.out, candidate.combo].some(item => item != null && String(item) === String(recipe.transferFrom))
  );
  if (!producers.length) return 1;
  return 1 + Math.max(...producers.map(candidate => transferStageNumber(candidate, nextSeen)));
}

function transferLevelLabel(recipe) {
  const stage = transferStageNumber(recipe);
  const levels = TRANSFER_LEVELS[stage];
  if (!levels) return '';
  return 'Lv. ' + levels.from + ' → ' + levels.to + (levels.combo ? ' · Combo Lv. ' + levels.combo : ' · Sicuro');
}

function sequenceFor(rootId) {
  const root = state.graph?.recipes?.[rootId];
  if (!root) return [];
  const candidates = professionRecipes().filter(([, recipe]) => categoryOf(recipe) === categoryOf(root));
  const steps = [[rootId, root]];
  const seen = new Set([String(rootId)]);
  let previous = root;
  while (previous.combo && steps.length < 12) {
    const next = candidates
      .filter(([id, recipe]) => !seen.has(String(id)) && recipe.in.some(([key]) => String(key) === String(previous.combo)) && (recipe.ml == null || previous.ml == null || Number(recipe.ml) > Number(previous.ml)))
      .sort((a, b) => Number(a[1].ml || 0) - Number(b[1].ml || 0) || nameOf(a[1].out).localeCompare(nameOf(b[1].out), 'en'))[0];
    if (!next) break;
    steps.push(next); seen.add(String(next[0])); previous = next[1];
  }
  return steps;
}

function sequenceRoots(categoryFilter = state.category) {
  const candidates = professionRecipes().filter(([, recipe]) => categoryFilter === 'all' || categoryOf(recipe) === categoryFilter);
  const comboKeys = new Set(candidates.map(([, recipe]) => String(recipe.combo)));
  return candidates.filter(([, recipe]) => !recipe.in.some(([key]) => comboKeys.has(String(key))))
    .filter(([id]) => sequenceFor(id).length > 1);
}

function visibleRecipes() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const available = state.mode === 'calculator' ? sequenceRoots() : professionRecipes();
  return available
    .filter(([, recipe]) =>
      (state.category === 'all' || categoryOf(recipe) === state.category) &&
      (!query || nameOf(recipe.out).toLocaleLowerCase().includes(query))
    )
    .sort(([, a], [, b]) => {
      if (state.mode === 'transfer') {
        return categoryOrder.indexOf(categoryOf(a)) - categoryOrder.indexOf(categoryOf(b)) ||
          transferStageNumber(a) - transferStageNumber(b) ||
          nameOf(a.out).localeCompare(nameOf(b.out), 'en');
      }
      return (
      (Number(a.ml) || 0) - (Number(b.ml) || 0) ||
      nameOf(a.out).localeCompare(nameOf(b.out), 'en') ||
      Number(Boolean(a.safe)) - Number(Boolean(b.safe))
      );
    });
}

function chooseFirst() {
  state.selected = visibleRecipes()[0]?.[0] || null;
  renderResults();
  renderDetail();
}

function fillProfessions() {
  const availableProfessions = state.mode === 'calculator' ? SEQUENCE_PROFESSIONS : Object.keys(professionLabels);
  $('professions').replaceChildren(...availableProfessions.map(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = state.profession === value ? 'active' : '';
    const title = document.createElement('strong'); title.textContent = professionLabels[value];
    const hint = document.createElement('small'); hint.textContent = professionHints[value];
    button.append(title, hint);
    button.addEventListener('click', () => { state.profession = value; state.category = 'all'; $('search').value = ''; fillProfessions(); fillCategories(); chooseFirst(); });
    return button;
  }));
}

function fillModes() {
  $('modes').replaceChildren(...[['crafting', 'Crafting'], ['transfer', 'Transfer Crafting'], ['calculator', 'Calculator']].map(([value, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = state.mode === value ? 'active' : '';
    button.textContent = label;
    button.addEventListener('click', () => {
      state.mode = value;
      if (value === 'calculator' && !SEQUENCE_PROFESSIONS.includes(state.profession)) state.profession = 'blacksmithing';
      state.category = 'all'; $('search').value = '';
      fillModes(); fillProfessions(); fillCategories(); chooseFirst();
    });
    return button;
  }));
}

function fillCategories() {
  const categoryRecipes = state.mode === 'calculator' ? sequenceRoots('all') : professionRecipes();
  const available = [...new Set(categoryRecipes.map(([, recipe]) => categoryOf(recipe)))];
  available.sort((a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b));
  if (state.category !== 'all' && !available.includes(state.category)) state.category = 'all';
  $('categories').replaceChildren(...[['all', 'Tutte'], ...available.map(value => [value, categoryLabels[value] || value])].map(([value, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = state.category === value ? 'active' : '';
    button.textContent = label;
    button.addEventListener('click', () => { state.category = value; fillCategories(); chooseFirst(); });
    return button;
  }));
}

function renderResults() {
  const matching = visibleRecipes();
  $('count').textContent = '(' + matching.length + ')';
  const listHeading = document.querySelector('.panelHead h2');
  const listHint = document.querySelector('.panelHead p');
  if (listHeading) listHeading.firstChild.textContent = state.mode === 'calculator' ? 'Oggetto di partenza ' : state.mode === 'transfer' ? 'Progressione Transfer Crafting ' : 'Ricette ';
  if (listHint) listHint.textContent = state.mode === 'calculator'
    ? 'Scegli una categoria e l’oggetto iniziale della sequenza; puoi cercarlo per nome.'
    : state.mode === 'transfer'
      ? 'La linea mostra oggetto trasferito → risultato normale → eventuale combo, con il livello ottenuto in ogni passaggio.'
      : 'Scegli prima il tipo di crafting e la professione, poi filtra per categoria o cerca il nome.';
  const list = $('results');
  list.replaceChildren();
  if (!matching.length) {
    const message = document.createElement('p');
    message.className = 'empty';
    message.textContent = 'Nessuna ricetta trovata.';
    list.append(message);
    return;
  }
  for (const [id, recipe] of matching) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result' + (state.mode === 'transfer' ? ' transferResult' : '') + (state.selected === id ? ' active' : '');
    const icons = document.createElement('div'); icons.className = 'resultIcons';
    if (state.mode === 'transfer' && recipe.transferFrom) {
      const sourceIcon = iconOf(recipe.transferFrom); sourceIcon.classList.add('transferSourceIcon'); sourceIcon.title = 'Oggetto di partenza: ' + nameOf(recipe.transferFrom);
      icons.append(sourceIcon);
      const transferArrow = document.createElement('span'); transferArrow.className = 'resultIconArrow'; transferArrow.textContent = '→';
      const resultIcon = iconOf(recipe.out); resultIcon.classList.add('transferResultIcon');
      icons.append(transferArrow, resultIcon);
    } else icons.append(iconOf(recipe.out));
    if (recipe.combo) {
      const iconArrow = document.createElement('span'); iconArrow.className = 'resultIconArrow'; iconArrow.textContent = '→';
      icons.append(iconArrow, iconOf(recipe.combo));
    }
    const text = document.createElement('div');
    text.className = 'resultText';
    const titleLine = document.createElement('div'); titleLine.className = 'resultTitleLine' + (state.mode === 'transfer' ? ' transferTitleLine' : '');
    const title = document.createElement('strong'); title.className = 'itemGrade' + gradeClass(recipe.out);
    title.textContent = nameOf(recipe.out);
    titleLine.append(title);
    if (recipe.combo) {
      const comboName = document.createElement('strong'); comboName.className = 'resultComboName itemGrade' + gradeClass(recipe.combo); comboName.textContent = nameOf(recipe.combo); comboName.title = nameOf(recipe.combo);
      if (state.mode === 'transfer') {
        const comboLine = document.createElement('div'); comboLine.className = 'transferComboLine';
        const nameArrow = document.createElement('span'); nameArrow.className = 'resultNameArrow'; nameArrow.textContent = '↳';
        comboLine.append(nameArrow, comboName); text.append(titleLine, comboLine);
      } else {
        const nameArrow = document.createElement('span'); nameArrow.className = 'resultNameArrow'; nameArrow.textContent = '→';
        titleLine.append(nameArrow, comboName);
      }
    }
    if (!recipe.combo || state.mode !== 'transfer') text.append(titleLine);
    const sub = document.createElement('span');
    sub.textContent = state.mode === 'calculator'
      ? 'Oggetto di partenza · ' + sequenceFor(id).length + ' passaggi'
      : state.mode === 'transfer'
        ? 'Da ' + nameOf(recipe.transferFrom) + ' · Passaggio ' + transferStageNumber(recipe) + '/5 · ' + transferLevelLabel(recipe)
        : (categoryLabels[categoryOf(recipe)] || 'Materiali') + ' · ' + masteryLabel(recipe.ml) + (recipe.safe ? ' · Sicuro · livello 62 vincolato' : recipe.successChance != null ? ' · Combo · risultato livello 70' : '');
    sub.className = 'resultMeta';
    appendItemLevel(text, recipe.out); text.append(sub);
    button.append(icons, text);
    button.addEventListener('click', () => { state.selected = id; renderResults(); renderDetail(); });
    list.append(button);
  }
}

function overrideKey(itemKey) { return 'aion2craft:' + state.server + ':' + itemKey; }
function unitPrice(itemKey) {
  const saved = localStorage.getItem(overrideKey(itemKey));
  if (saved != null && saved !== '') return Number(saved);
  const market = state.prices.get(String(itemKey));
  return market?.price == null ? null : Number(market.price);
}

function box(label, value, note, className = '') {
  const card = document.createElement('div');
  card.className = 'number ' + className;
  const caption = document.createElement('span'); caption.textContent = label;
  const big = document.createElement('strong'); big.textContent = value;
  const small = document.createElement('small'); small.textContent = note;
  card.append(caption, big, small);
  return card;
}

function addBreakdown(parent, unit, depth = 0) {
  if (unit.source === 'morph') {
    const tag = document.createElement('div'); tag.className = 'sourceTag';
    tag.textContent = 'Trasformazione: 1 × ' + nameOf(unit.odyleId) + ' → 1 materiale vincolato';
    parent.append(tag);
    return;
  }
  if (unit.source !== 'craft' || depth > 3) return;
  const recipe = state.graph.recipes[unit.recipeId];
  const details = document.createElement('details'); details.className = 'craftBreakdown';
  const summary = document.createElement('summary');
  summary.textContent = formatAttempts(unit.expectedAttempts) + ' tentativ' + (unit.expectedAttempts === 1 ? 'o' : 'i') + ' attesi × ' + nameOf(recipe.out) + (unit.combo ? ' → Splendent' : '');
  details.append(summary);
  const list = document.createElement('ul');
  for (const line of unit.lines) {
    const entry = document.createElement('li');
    entry.textContent = format(line.quantity) + ' × ' + nameOf(line.key) + ' · ' + format(line.unit.cost * line.quantity) + ' Kina per tentativo' + (line.unit.source === 'npc' ? ' · negoziante' : '');
    addBreakdown(entry, line.unit, depth + 1);
    list.append(entry);
  }
  details.append(list); parent.append(details);
}

function collectFallbacks(lines, found = new Set()) {
  for (const line of lines) {
    if (line.unit.source === 'market-fallback') found.add(line.key);
    if (line.unit.lines) collectFallbacks(line.unit.lines, found);
  }
  return found;
}

function addMissingPriceInputs(parent, keys, title) {
  if (!keys.length) return;
  const group = document.createElement('div'); group.className = 'missingPrices';
  const heading = document.createElement('h3'); heading.textContent = title;
  group.append(heading);
  for (const key of [...new Set(keys)]) {
    const row = document.createElement('div'); row.className = 'missingPriceRow';
    const label = document.createElement('label'); label.textContent = nameOf(key);
    const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1';
    input.placeholder = 'Kina / unità'; input.value = localStorage.getItem(overrideKey(key)) || '';
    input.setAttribute('aria-label', 'Prezzo manuale per ' + nameOf(key));
    input.addEventListener('change', () => {
      if (input.value === '') localStorage.removeItem(overrideKey(key));
      else if (Number.isFinite(Number(input.value)) && Number(input.value) >= 0) localStorage.setItem(overrideKey(key), input.value);
      renderRecommendations(); renderDetail();
    });
    row.append(label, input); group.append(row);
  }
  parent.append(group);
}

function renderSequenceCalculator(rootId) {
  const pane = $('detail');
  const steps = sequenceFor(rootId);
  const root = steps[0]?.[1];
  pane.replaceChildren();
  if (!root || steps.length < 2) {
    const title = document.createElement('h2'); title.textContent = 'Sequenza non disponibile';
    pane.append(title); return;
  }

  const titleRow = document.createElement('div'); titleRow.className = 'titleRow';
  const title = document.createElement('h2'); title.className = 'itemGrade' + gradeClass(root.out); title.textContent = 'Calculator · ' + nameOf(root.out);
  titleRow.append(iconOf(root.out, 'large'), title); pane.append(titleRow);
  const intro = document.createElement('p'); intro.className = 'calculatorIntro';
  intro.textContent = 'Inserisci i tentativi e le combo realmente ottenute a ogni passaggio. Per le ricette normali i risultati base sono craft tentati meno combo; nelle ricette rischiose inserisci anche i risultati Lv. 62. Le fasi a zero sono saltate e il ricavo considera solo le combo della fase finale eseguita; al ricavo viene sottratta la tassa del 10%.';
  pane.append(intro);

  const modeWrap = document.createElement('fieldset'); modeWrap.className = 'materialMode';
  const modeLabel = document.createElement('legend'); modeLabel.textContent = 'Come valorizzare i materiali';
  const sourceChoices = document.createElement('div'); sourceChoices.className = 'sourceChoices';
  for (const [value, label, hint] of [
    ['optimize', 'Craftato', 'Sceglie il costo minore tra craft, Odyle e mercato'],
    ['market', 'Market', 'Valorizza i materiali al prezzo di mercato'],
  ]) {
    const choice = document.createElement('label'); choice.className = 'sourceChoice';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'materialMode'; radio.value = value; radio.checked = state.materialMode === value;
    radio.addEventListener('change', () => { if (radio.checked) { state.materialMode = value; renderDetail(); } });
    const text = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = label; const small = document.createElement('small'); small.textContent = hint;
    text.append(strong, small); choice.append(radio, text); sourceChoices.append(choice);
  }
  modeWrap.append(modeLabel, sourceChoices); pane.append(modeWrap);

  const storageKey = 'aion2craft:calculator:' + state.server + ':' + rootId;
  let run;
  try { run = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { run = null; }
  if (!run || !Array.isArray(run.steps) || run.steps.length !== steps.length) run = { steps: steps.map(() => ({ crafts: 0, normal: 0, combo: 0 })) };
  const faction = serverFaction() === 'Asmodian' ? 'dark' : 'light';
  const model = createCostModel(state.graph, unitPrice, faction, key => localStorage.getItem(overrideKey(key)) === '0', {
    optimizeMaterials: state.materialMode === 'optimize',
    successRateFor: id => state.graph.recipes[id]?.successChance != null ? MAX_CRAFT_SUCCESS : undefined,
    comboSuccessRateFor: id => state.graph.recipes[id]?.comboSuccessChance != null ? MAX_COMBO_SUCCESS : undefined,
  });
  const total = { cost: 0, revenue: 0, missingCosts: new Set(), missingSales: new Set(), invalid: false };
  const lastActiveStage = run.steps.reduce((last, step, index) => Number(step.crafts) > 0 ? index : last, -1);

  for (let index = 0; index < steps.length; index++) {
    const [recipeId, recipe] = steps[index];
    const values = run.steps[index];
    values.crafts = Math.max(0, Number(values.crafts) || 0);
    values.normal = Math.max(0, Number(values.normal) || 0);
    values.combo = Math.max(0, Number(values.combo) || 0);
    const stage = document.createElement('section'); stage.className = 'calculatorStage';
    const head = document.createElement('div'); head.className = 'calculatorStageHead';
    head.append(iconOf(recipe.out));
    const headText = document.createElement('div'); const headName = document.createElement('strong'); headName.textContent = (index + 1) + '. ' + nameOf(recipe.out);
    const headMeta = document.createElement('small'); headMeta.textContent = recipe.combo ? 'Risultato: ' + nameOf(recipe.out) + ' · combo: ' + nameOf(recipe.combo) : 'Risultato normale';
    headText.append(headName); appendItemLevel(headText, recipe.out); headText.append(headMeta); head.append(headText); stage.append(head);

    const fields = document.createElement('div'); fields.className = 'calculatorStageInputs';
    const risky = recipe.successChance != null && !recipe.safe;
    const stageInputs = [['crafts', 'Craft tentati'], ...(risky ? [['normal', 'Risultati Lv. 62']] : []), ['combo', risky ? 'Combo Lv. 70 ottenute' : 'Combo ottenute']];
    for (const [field, labelText] of stageInputs) {
      const wrap = document.createElement('div'); const label = document.createElement('label'); label.textContent = labelText;
      if (field === 'combo') {
        const expected = document.createElement('span'); expected.className = 'expectedComboBadge';
        expected.textContent = 'Attese: ' + formatAttempts(values.crafts * 0.25);
        expected.title = values.crafts + ' craft × 25%: valore medio, non garantito';
        label.append(expected);
      }
      if (field === 'normal') {
        const expected = document.createElement('span'); expected.className = 'expectedComboBadge';
        expected.textContent = 'Attesi: ' + formatAttempts(values.crafts * 0.75);
        expected.title = values.crafts + ' craft × 75%: risultati normali teorici, prima degli eventuali fallimenti';
        label.append(expected);
      }
      const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.value = String(values[field]); input.setAttribute('aria-label', labelText + ' · ' + nameOf(recipe.out));
      input.addEventListener('change', () => {
        const nextValue = Math.max(0, Math.floor(Number(input.value) || 0));
        values[field] = nextValue;
        if (field === 'combo' && steps[index + 1]) {
          const nextRecipe = steps[index + 1][1];
          const consumedPerCraft = nextRecipe.in.find(([key]) => String(key) === String(recipe.combo))?.[1] || 1;
          run.steps[index + 1].crafts = Math.floor(nextValue / Number(consumedPerCraft));
        }
        localStorage.setItem(storageKey, JSON.stringify(run));
        renderDetail();
      });
      wrap.append(label, input); fields.append(wrap);
    }
    stage.append(fields);

    if (!values.crafts) {
      const skipped = document.createElement('div'); skipped.className = 'calculatorStageCost'; skipped.textContent = 'Fase non eseguita · esclusa dal calcolo';
      stage.append(skipped); pane.append(stage); continue;
    }

    const previousComboKey = index > 0 ? String(steps[index - 1][1].combo) : null;
    const previousStageActive = index > 0 && Number(run.steps[index - 1].crafts) > 0;
    const attempt = model.ownAttempt(recipe);
    let unitCost = 0;
    const stageMissingCosts = new Set();
    for (const line of attempt.lines) {
      if (previousComboKey && String(line.key) === previousComboKey && previousStageActive) continue;
      const unit = previousComboKey && String(line.key) === previousComboKey ? model.marketUnit(line.key) : line.unit;
      if (unit.cost == null) for (const key of unit.missing || [line.key]) stageMissingCosts.add(String(key));
      else unitCost += unit.cost * line.quantity;
    }
    if (values.crafts) for (const key of stageMissingCosts) total.missingCosts.add(key);
    const stageCost = values.crafts && stageMissingCosts.size ? null : unitCost * values.crafts;
    if (stageCost != null) total.cost += stageCost;

    const normalCount = risky ? values.normal : Math.max(0, values.crafts * (Number(recipe.outq) || 1) - values.combo);
    const normalPrice = unitPrice(String(recipe.out));
    const comboPrice = Number(run.salePrice) > 0 ? Number(run.salePrice) : recipe.combo ? unitPrice(String(recipe.combo)) : null;
    let comboRemaining = values.combo;
    if (steps[index + 1] && recipe.combo) {
      const nextRecipe = steps[index + 1][1];
      const inputQuantity = Number(nextRecipe.in.find(([key]) => String(key) === String(recipe.combo))?.[1] || 1);
      comboRemaining -= run.steps[index + 1].crafts * inputQuantity;
      if (comboRemaining < 0) total.invalid = true;
    }
    if (index === lastActiveStage && comboRemaining > 0 && recipe.combo) {
      if (comboPrice == null) total.missingSales.add(String(recipe.combo));
      else total.revenue += netSale(comboPrice) * comboRemaining;
    }
    if (values.combo > values.crafts * (Number(recipe.outq) || 1)) total.invalid = true;
    const costNote = document.createElement('div'); costNote.className = 'calculatorStageCost';
    costNote.textContent = 'Costo stimato per craft: ' + (stageMissingCosts.size && values.crafts ? 'incompleto · controlla i prezzi dei materiali' : format(unitCost) + ' Kina') + (previousStageActive ? ' · il pezzo combo della fase prima è già conteggiato' : previousComboKey ? ' · pezzo iniziale valorizzato al mercato' : '');
    stage.append(costNote); pane.append(stage);
  }

  const spent = total.missingCosts.size ? null : total.cost;
  const revenue = total.missingSales.size ? null : total.revenue;
  const profit = spent == null || revenue == null || total.invalid ? null : revenue - spent;
  const summary = document.createElement('div'); summary.className = 'numbers calculatorTotals';
  summary.append(
    box('Spesa totale stimata', spent == null ? 'Incompleta' : format(spent) + ' Kina', state.materialMode === 'optimize' ? 'Materiali valorizzati con il metodo meno caro' : 'Materiali valorizzati al mercato', spent == null ? 'warn' : ''),
    box('Ricavo netto stimato', revenue == null ? 'Incompleto' : format(revenue) + ' Kina', (Number(run.salePrice) > 0 ? 'Prezzo personale' : 'Prezzo di mercato') + ' meno tassa di vendita 10%', revenue == null ? 'warn' : 'accent'),
    box(profit == null ? 'Guadagno / perdita' : profit >= 0 ? 'Guadagno netto' : 'Perdita netta', profit == null ? '—' : (profit >= 0 ? '+' : '−') + format(Math.abs(profit)) + ' Kina', 'Ricavo netto − spesa totale', 'outcomeProfit ' + (profit == null ? '' : profit >= 0 ? 'gain' : 'loss'))
  );
  const saleCard = document.createElement('div'); saleCard.className = 'number';
  const saleLabel = document.createElement('label'); saleLabel.htmlFor = 'calculatorSalePrice'; saleLabel.textContent = 'Prezzo di vendita per pezzo';
  const saleInput = document.createElement('input'); saleInput.id = 'calculatorSalePrice'; saleInput.type = 'number'; saleInput.min = '0'; saleInput.step = '1'; saleInput.value = String(Math.max(0, Number(run.salePrice) || 0));
  saleInput.addEventListener('change', () => {
    run.salePrice = Math.max(0, Number(saleInput.value) || 0);
    localStorage.setItem(storageKey, JSON.stringify(run)); renderDetail();
  });
  const saleHint = document.createElement('small'); saleHint.textContent = 'In Kina, prima delle tasse. Con 0 usa il mercato. Il prezzo si applica alle combo finali.';
  saleCard.append(saleLabel, saleInput, saleHint); summary.append(saleCard);
  pane.append(summary);
  if (total.invalid) {
    const warning = document.createElement('p'); warning.className = 'buyFinishedAdvice';
    warning.textContent = 'Controlla i risultati inseriti: hai indicato più pezzi prodotti dei craft tentati oppure hai usato più combo di quante ne avevi disponibili.';
    pane.append(warning);
  }
  const footnote = document.createElement('p'); footnote.className = 'calculatorNote';
  footnote.textContent = 'I prezzi di vendita mancanti o i prezzi dei materiali mancanti rendono il totale incompleto. Le fasi a zero sono escluse. Il ricavo considera solo le combo della fase finale eseguita; risultati normali e combo intermedie rimaste sono esclusi. I risultati inseriti sono quelli reali della tua sessione; commissioni di inserzione escluse.';
  pane.append(footnote);
  if (total.missingCosts.size) addMissingPriceInputs(pane, [...total.missingCosts], 'Inserisci i prezzi mancanti dei materiali');
  if (total.missingSales.size) addMissingPriceInputs(pane, [...total.missingSales], 'Inserisci i prezzi mancanti dei risultati');
}

function renderTransferCosts(pane, recipe, craftCount) {
  const faction = serverFaction() === 'Asmodian' ? 'dark' : 'light';
  const baseModel = createCostModel(state.graph, unitPrice, faction, key => localStorage.getItem(overrideKey(key)) === '0', {
    optimizeMaterials: true,
    successRateFor: id => state.graph.recipes[id]?.successChance != null ? MAX_CRAFT_SUCCESS : undefined,
    comboSuccessRateFor: id => state.graph.recipes[id]?.comboSuccessChance != null ? MAX_COMBO_SUCCESS : undefined,
  });
  const baseGearCosts = new Map();
  const boundTransferItems = new Set(recipes().filter(([, r]) => r.type === 'transfer' && r.qr === faction).flatMap(([, r]) => [r.out, r.combo].filter(Boolean).map(String)));
  for (const [id, baseRecipe] of recipes()) {
    if (baseRecipe.type !== 'crafting' || baseRecipe.qr !== faction || baseRecipe.safe || baseRecipe.successChance == null) continue;
    const attempt = baseModel.ownAttempt(baseRecipe);
    const key = String(baseRecipe.out);
    const market = state.prices.get(key);
    const marketPrice = market?.price != null && Number(market.listings) > 0 ? Number(market.price) : null;
    const buyBase = /^True Dragon Lord /.test(nameOf(key)) && marketPrice != null && (attempt.cost == null || marketPrice < attempt.cost);
    baseGearCosts.set(key, buyBase
      ? { cost: marketPrice, missing: [], source: 'market', craftCost: attempt.cost }
      : { ...attempt, source: 'craft', recipeId: id, combo: false, expectedAttempts: 1, attemptCost: attempt.cost });
  }
  const model = createCostModel(state.graph, unitPrice, faction,
    key => localStorage.getItem(overrideKey(key)) === '0',
    {
      optimizeMaterials: true,
      singleAttemptComboCrafting: true,
      unitOverrideFor: key => baseGearCosts.get(String(key)),
      excludeMarketFor: key => boundTransferItems.has(String(key)),
      successRateFor: id => state.graph.recipes[id]?.successChance != null ? MAX_CRAFT_SUCCESS : undefined,
      comboSuccessRateFor: id => state.graph.recipes[id]?.comboSuccessChance != null ? MAX_COMBO_SUCCESS : undefined,
    }
  );
  const attempt = model.ownAttempt(recipe);
  const missing = new Set(attempt.missing.map(String));
  const rows = (recipe.transferFrom ? [[recipe.transferFrom, 1, 'transfer']] : []).concat(recipe.in).map(([rawKey, quantity, kind]) => {
    const key = String(rawKey);
    return { key, quantity: Number(quantity) || 0, kind, own: model.ownUnit(key), market: state.prices.get(key), transfer: kind === 'transfer' };
  });
  const totalCost = attempt.cost == null ? null : attempt.cost * craftCount;
  let extraMaterialsCost = 0;
  const missingExtraMaterials = new Set();
  for (const line of attempt.lines) {
    if (line.kind === 'transfer') continue;
    if (line.unit.cost == null) for (const key of line.unit.missing || [line.key]) missingExtraMaterials.add(String(key));
    else extraMaterialsCost += line.unit.cost * line.quantity;
  }
  const extraMaterialsTotal = missingExtraMaterials.size ? null : extraMaterialsCost * craftCount;
  const summary = document.createElement('div'); summary.className = 'numbers transferCostSummary';
  summary.append(
    box('Altri materiali · per 1 tentativo', extraMaterialsTotal == null ? 'Incompleto' : format(extraMaterialsCost) + ' Kina', extraMaterialsTotal == null ? missingExtraMaterials.size + ' prezzi mancanti · totale per ' + craftCount + ': incompleto' : 'Escluso l’oggetto da trasferire · totale per ' + craftCount + ': ' + format(extraMaterialsTotal) + ' Kina', extraMaterialsTotal == null ? 'warn' : 'accent'),
    box('Totale con oggetto da trasferire · per 1 tentativo', totalCost == null ? 'Incompleto' : format(attempt.cost) + ' Kina', totalCost == null ? 'Include il costo scelto della fase precedente · totale per ' + craftCount + ': incompleto' : 'Include il costo scelto della fase precedente · totale per ' + craftCount + ': ' + format(totalCost) + ' Kina', totalCost == null ? 'warn' : 'accent')
  );
  pane.append(summary);

  const heading = document.createElement('h3'); heading.textContent = 'Materiali e oggetti necessari'; pane.append(heading);
  const table = document.createElement('table');
  const head = document.createElement('thead'); const headerRow = document.createElement('tr');
  for (const label of ['Materiale', 'Quantità', 'Mercato / unità', 'Costo scelto / unità', 'Totale']) { const th = document.createElement('th'); th.textContent = label; headerRow.append(th); }
  head.append(headerRow); table.append(head);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const name = document.createElement('td'); name.className = 'material';
    const nameWrap = document.createElement('div'); nameWrap.className = 'materialName';
    const nameText = document.createElement('span'); nameText.className = 'itemGrade' + gradeClass(row.key); nameText.textContent = nameOf(row.key) + (row.transfer ? ' · costo di partenza incluso' : '');
    nameWrap.append(iconOf(row.key), nameText); name.append(nameWrap);
    const count = document.createElement('td'); count.textContent = formatAttempts(row.quantity * craftCount);
    const marketCell = document.createElement('td');
    if (row.transfer) {
      const source = document.createElement('span'); source.className = 'sourceTag'; source.textContent = boundTransferItems.has(row.key) ? 'Oggetto vincolato · costo dei trasferimenti precedenti' : row.market?.price != null && row.market.listings > 0 ? format(row.market.price) + ' Kina · ' + row.market.listings + ' annunci' : 'Nessun annuncio disponibile'; marketCell.append(source);
    } else {
      const input = document.createElement('input'); input.className = 'priceInput'; input.type = 'number'; input.min = '0'; input.step = '1';
      input.placeholder = row.market?.price == null ? (GLOBAL_VENDOR_PRICES[row.key] == null ? 'Mancante' : String(GLOBAL_VENDOR_PRICES[row.key])) : String(row.market.price);
      const manualValue = localStorage.getItem(overrideKey(row.key)); input.value = manualValue || '';
      input.setAttribute('aria-label', 'Prezzo manuale per ' + nameOf(row.key));
      input.addEventListener('change', () => {
        if (input.value === '') localStorage.removeItem(overrideKey(row.key));
        else if (Number.isFinite(Number(input.value)) && Number(input.value) >= 0) localStorage.setItem(overrideKey(row.key), input.value);
        renderRecommendations(); renderDetail();
      });
      const source = document.createElement('div'); source.className = 'sourceTag';
      source.textContent = manualValue != null && manualValue !== '' ? 'Prezzo manuale' : row.market?.price == null ? (GLOBAL_VENDOR_PRICES[row.key] != null ? 'Negoziante Global · ' + format(GLOBAL_VENDOR_PRICES[row.key]) + ' Kina' : 'Nessun annuncio: inserisci il prezzo') : 'Mercato ' + format(row.market.price) + ' Kina · ' + (row.market.listings || 0) + ' annunci';
      marketCell.append(input, source);
    }
    const methodCell = document.createElement('td');
    if (row.own.cost == null) { methodCell.className = 'missing'; methodCell.textContent = 'Prezzo mancante'; }
    else {
      methodCell.append(document.createTextNode(format(row.own.cost) + ' Kina'));
      if (row.transfer) { const note = document.createElement('div'); note.className = 'sourceTag'; note.textContent = row.own.source === 'market' ? 'Acquisto al mercato: costa meno del craft' : 'Costo craftato della fase precedente'; methodCell.append(note); }
      else if (row.own.source === 'craft' || row.own.source === 'morph') addBreakdown(methodCell, row.own);
      else { const note = document.createElement('div'); note.className = 'sourceTag'; note.textContent = row.own.source === 'npc' ? 'Comprato dal negoziante' : row.own.source === 'owned' ? 'Già posseduto' : 'Acquistato al mercato'; methodCell.append(note); }
    }
    const sum = document.createElement('td'); sum.textContent = row.own.cost == null ? '—' : format(row.own.cost * row.quantity * craftCount);
    if (row.own.cost == null) sum.className = 'missing';
    tr.append(name, count, marketCell, methodCell, sum); body.append(tr);
  }
  table.append(body);
  const scroll = document.createElement('div'); scroll.className = 'tableScroll'; scroll.append(table); pane.append(scroll);
  if (missing.size) addMissingPriceInputs(pane, [...missing], 'Inserisci i prezzi mancanti dei materiali');
  const note = document.createElement('p'); note.className = 'muted';
  note.textContent = 'Per il True Dragon Lord iniziale viene scelto il minore tra prezzo di acquisto al mercato e costo craftato. Il valore scelto entra nei passaggi successivi della linea. Le combo al 25% sono valorizzate al costo di un singolo tentativo, senza moltiplicare per quattro. Tariffe delle ricette escluse.';
  pane.append(note);
}

function renderDetail() {
  const pane = $('detail');
  const recipe = state.graph?.recipes?.[state.selected];
  if (state.mode === 'calculator' && recipe) { renderSequenceCalculator(state.selected); return; }
  if (!recipe) {
    pane.replaceChildren();
    const title = document.createElement('h2'); title.textContent = 'Nessuna ricetta';
    const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'Scegli una categoria o cambia la ricerca.';
    pane.append(title, note);
    return;
  }
  const craftCount = Math.max(1, Math.min(9999, Number($('craftQuantity')?.value) || 1));
  const comboRate = recipe.combo ? Number(recipe.cp || 0) / 100 : 0;
  const expectedComboActivations = craftCount * comboRate;
  const craftSuccessRate = recipe.successChance != null && !recipe.safe ? MAX_CRAFT_SUCCESS : 1;
  const comboSuccessRate = recipe.comboSuccessChance != null && !recipe.safe ? MAX_COMBO_SUCCESS : 1;
  const expectedComboResults = recipe.combo ? expectedComboActivations * craftSuccessRate * comboSuccessRate : 0;
  const expectedOutput = recipe.combo ? expectedComboResults : craftCount * (Number(recipe.outq) || 1);
  pane.replaceChildren();
  const titleRow = document.createElement('div'); titleRow.className = 'titleRow';
  const title = document.createElement('h2'); title.className = 'itemGrade' + gradeClass(recipe.out); title.textContent = nameOf(recipe.out);
  const titleText = document.createElement('div'); titleText.className = 'itemTitleText'; titleText.append(title); appendItemLevel(titleText, recipe.out); titleRow.append(iconOf(recipe.out, 'large'), titleText);
  if (recipe.type !== 'transfer') {
    const marketActions = document.createElement('div'); marketActions.className = 'marketActions';
    const targets = recipe.combo && recipe.successChance != null && !recipe.safe
      ? [[recipe.out, 'Mercato Lv. 62'], [recipe.combo, 'Mercato combo Lv. 70']]
      : [[recipe.combo || recipe.out, 'Prezzo mercato']];
    for (const [key, label] of targets) {
      const marketButton = document.createElement('button'); marketButton.className = 'marketButton'; marketButton.type = 'button'; marketButton.textContent = label;
      marketButton.setAttribute('aria-label', 'Grafico ' + label + ' di ' + nameOf(key));
      marketButton.addEventListener('click', () => openMarketModal(String(key)));
      marketActions.append(marketButton);
    }
    titleRow.append(marketActions);
  }
  const meta = document.createElement('div'); meta.className = 'detailMeta muted';
  meta.textContent = (recipe.type === 'transfer' ? 'Transfer Crafting' : 'Crafting') + ' › ' + (professionLabels[recipe.p] || recipe.p || 'Crafting') + ' › ' + (categoryLabels[categoryOf(recipe)] || categoryOf(recipe)) + ' · ' + masteryLabel(recipe.ml) + ' · ' + (recipe.outq || 1) + ' per tentativo' + (recipe.type === 'transfer' ? ' · Passaggio ' + transferStageNumber(recipe) + '/5 · ' + transferLevelLabel(recipe) : recipe.safe ? ' · risultato sicuro livello 62' : recipe.successChance != null ? ' · combo livello 70' : '');
  const control = document.createElement('div'); control.className = 'controls';
  const quantityWrap = document.createElement('div');
  const quantityLabel = document.createElement('label'); quantityLabel.htmlFor = 'craftQuantity'; quantityLabel.textContent = 'Quantità da craftare';
  const quantity = document.createElement('input'); quantity.id = 'craftQuantity'; quantity.type = 'number'; quantity.min = '1'; quantity.max = '9999'; quantity.value = String(craftCount);
  quantity.addEventListener('change', renderDetail);
  quantityWrap.append(quantityLabel, quantity);
  control.append(quantityWrap);
  if (recipe.type === 'transfer') {
    const note = document.createElement('p'); note.className = 'note'; note.textContent = 'Inserisci quanti tentativi vuoi fare. Vedi solo i materiali necessari e il loro costo; il True Dragon Lord iniziale usa il minore tra mercato e craft, riportato nei passaggi successivi.';
    control.append(note);
  } else {
    const modeWrap = document.createElement('fieldset'); modeWrap.className = 'materialMode';
    const modeLabel = document.createElement('legend'); modeLabel.textContent = 'Materiali di partenza';
    const sourceChoices = document.createElement('div'); sourceChoices.className = 'sourceChoices';
    for (const [value, label, hint] of [
      ['optimize', 'Craftato', 'Usa craft, Odyle o mercato: sceglie il costo minore'],
      ['market', 'Market', 'Compra direttamente tutti i materiali'],
    ]) {
      const choice = document.createElement('label'); choice.className = 'sourceChoice';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'materialMode'; radio.value = value; radio.checked = state.materialMode === value;
      radio.addEventListener('change', () => { if (radio.checked) { state.materialMode = value; renderDetail(); } });
      const text = document.createElement('span');
      const strong = document.createElement('strong'); strong.textContent = label;
      const small = document.createElement('small'); small.textContent = hint;
      text.append(strong, small); choice.append(radio, text); sourceChoices.append(choice);
    }
    modeWrap.append(modeLabel, sourceChoices); control.append(modeWrap);
    const note = document.createElement('p'); note.className = 'note'; note.textContent = recipe.safe ? 'Quantità = numero di craft. Questa ricetta riesce sempre, produce l’arma base vincolata e non può fare combo. La tariffa in Kina non è inclusa.' : recipe.successChance != null ? 'Quantità = numero di craft, non pezzi garantiti. Le combo usano il 25% e possono fallire: per esempio, 20 craft attivano in media 5 combo. Per True Dragon il calcolo usa la probabilità massima della professione al livello 50.' : 'Quantità = numero di craft. Le combo sono una media: al 25%, 20 craft corrispondono a 5 attivazioni. “Craftato” sceglie il metodo meno caro tra mercato, craft e trasformazione 1:1 dall’Odyle; “Market” compra tutti i materiali.';
  control.append(note);
  }
  pane.append(titleRow, meta, control);

  if (recipe.type === 'transfer') {
    renderTransferCosts(pane, recipe, craftCount);
    return;
  }

  const faction = serverFaction() === 'Asmodian' ? 'dark' : 'light';
  const model = createCostModel(state.graph, unitPrice, faction, key => localStorage.getItem(overrideKey(key)) === '0', {
    optimizeMaterials: state.materialMode === 'optimize',
    successRateFor: id => state.graph.recipes[id]?.successChance != null ? MAX_CRAFT_SUCCESS : undefined,
    comboSuccessRateFor: id => state.graph.recipes[id]?.comboSuccessChance != null ? MAX_COMBO_SUCCESS : undefined,
  });
  const marketAttempt = model.marketAttempt(recipe);
  const ownAttempt = model.ownAttempt(recipe);
  const fallbackItems = collectFallbacks(ownAttempt.lines);
  const rows = [];
  const ingredients = recipe.transferFrom ? [[recipe.transferFrom, 1, 'transfer']].concat(recipe.in) : recipe.in;
  for (const ingredient of ingredients) {
    const key = String(ingredient[0]);
    const count = Number(ingredient[1]) * craftCount;
    rows.push({ key, count, buy: model.marketUnit(key), own: model.ownUnit(key), market: state.prices.get(key), transfer: ingredient[2] === 'transfer' });
  }
  const targetItem = String(recipe.combo || recipe.out);
  const output = state.prices.get(targetItem);
  const baseOutput = state.prices.get(String(recipe.out));
  const isLevel70Combo = recipe.combo && recipe.successChance != null && !recipe.safe;
  const resultLabel = isLevel70Combo ? 'combo Lv. 70' : recipe.combo ? 'combo' : 'oggetto';
  const resultsPerCraft = recipe.combo ? comboRate * craftSuccessRate * comboSuccessRate : craftSuccessRate * (Number(recipe.outq) || 1);
  const marketUnitCost = marketAttempt.cost == null || !(resultsPerCraft > 0) ? null : marketAttempt.cost / resultsPerCraft;
  const ownUnitCost = ownAttempt.cost == null || !(resultsPerCraft > 0) ? null : ownAttempt.cost / resultsPerCraft;
  const marketUnitPrice = recipe.bound || output?.price == null ? null : Number(output.price);
  const marketUnitNet = netSale(marketUnitPrice);
  const unitProfit = ownUnitCost == null || marketUnitNet == null ? null : marketUnitNet - ownUnitCost;
  const shownMarketCost = isLevel70Combo ? marketAttempt.cost : marketUnitCost;
  const shownOwnCost = isLevel70Combo ? ownAttempt.cost : ownUnitCost;
  const level62Price = baseOutput?.price == null ? null : Number(baseOutput.price);
  const level62Net = netSale(level62Price);
  const level70Net = netSale(marketUnitPrice);
  const level62Profit = ownAttempt.cost == null || level62Net == null ? null : level62Net - ownAttempt.cost;
  const level70Profit = ownAttempt.cost == null || level70Net == null ? null : level70Net - ownAttempt.cost;
  const missingBuyNames = marketAttempt.missing.map(nameOf);
  const missingBuyNote = missingBuyNames.length === 1
    ? 'Manca il prezzo di ' + missingBuyNames[0] + '; inseriscilo nella tabella sotto'
    : missingBuyNames.length + ' componenti senza prezzo: ' + missingBuyNames.join(', ');
  const numbers = document.createElement('div'); numbers.className = 'numbers';
  const summaryCards = [
    box(isLevel70Combo ? 'Costo comprando / 1 craft' : 'Costo comprando / 1 ' + resultLabel, shownMarketCost == null ? 'Prezzo mancante' : format(shownMarketCost) + ' Kina', marketAttempt.missing.length ? missingBuyNote : 'Totale materiali per ' + craftCount + ' craft: ' + format(marketAttempt.cost * craftCount) + ' Kina', shownMarketCost == null ? 'warn' : ''),
    box(isLevel70Combo ? 'Costo craftato / 1 craft' : 'Costo craftato / 1 ' + resultLabel, shownOwnCost == null ? 'Incompleto' : format(shownOwnCost) + ' Kina', ownAttempt.missing.length ? ownAttempt.missing.length + ' prezzi mancanti' : 'Totale per ' + craftCount + ' craft: ' + format(ownAttempt.cost * craftCount) + ' Kina' + (fallbackItems.size ? ' · alcuni pezzi comprati' : ''), shownOwnCost == null ? 'warn' : 'accent'),
  ];
  summaryCards.push(box(recipe.combo ? 'Combo al 25% attese' : 'Oggetti attesi', recipe.combo ? formatAttempts(expectedComboActivations) : formatAttempts(expectedOutput), recipe.combo ? (recipe.successChance != null && !recipe.safe ? formatAttempts(expectedComboResults) + ' combo riuscite stimate dopo i possibili fallimenti' : craftCount + ' craft × ' + formatPercent(comboRate * 100) + '% · media') : 'Risultato previsto da ' + craftCount + ' craft', isLevel70Combo ? 'wide' : ''));
  if (isLevel70Combo) {
    summaryCards.push(
      box('Prezzo mercato risultato normale Lv. 62', level62Price == null ? '—' : format(level62Price) + ' Kina', baseOutput ? (baseOutput.listings || 0) + ' annunci · prezzo minimo' : 'Nessun annuncio'),
      box('Prezzo mercato combo Lv. 70', marketUnitPrice == null ? '—' : format(marketUnitPrice) + ' Kina', output ? (output.listings || 0) + ' annunci · prezzo minimo' : 'Nessun annuncio')
    );
    summaryCards.push(
      box('Ricavo netto Lv. 62', level62Net == null ? '—' : format(level62Net) + ' Kina', 'Prezzo mercato meno tassa di vendita 10%'),
      box('Ricavo netto combo Lv. 70', level70Net == null ? '—' : format(level70Net) + ' Kina', 'Prezzo mercato meno tassa di vendita 10%')
    );
    summaryCards.push(
      box('Guadagno / perdita netta se esce Lv. 62', level62Profit == null ? '—' : (level62Profit >= 0 ? '+' : '−') + format(Math.abs(level62Profit)) + ' Kina', level62Profit == null ? 'Servono costo craftato e prezzo Lv. 62' : 'Ricavo netto Lv. 62 − costo di 1 craft · inserzione esclusa', 'outcomeProfit ' + (level62Profit == null ? '' : level62Profit >= 0 ? 'gain' : 'loss')),
      box('Guadagno / perdita netta se esce combo Lv. 70', level70Profit == null ? '—' : (level70Profit >= 0 ? '+' : '−') + format(Math.abs(level70Profit)) + ' Kina', level70Profit == null ? 'Servono costo craftato e prezzo Lv. 70' : 'Ricavo netto Lv. 70 − costo di 1 craft · inserzione esclusa', 'outcomeProfit ' + (level70Profit == null ? '' : level70Profit >= 0 ? 'gain' : 'loss'))
    );
  } else {
    summaryCards.push(box('Prezzo mercato / 1 ' + resultLabel, marketUnitPrice == null ? '—' : format(marketUnitPrice) + ' Kina', recipe.bound ? 'Risultato vincolato: non vendibile' : output ? (output.listings || 0) + ' annunci · netto tassa 10%: ' + format(marketUnitNet) + ' Kina' : 'Nessun annuncio'));
    summaryCards.push(box('Guadagno / perdita netta per 1 ' + resultLabel, unitProfit == null ? '—' : (unitProfit >= 0 ? '+' : '−') + format(Math.abs(unitProfit)) + ' Kina', unitProfit == null ? 'Servono costo craftato e prezzo di mercato' : 'Ricavo netto − costo medio craftato · inserzione esclusa', 'profitResult ' + (unitProfit == null ? '' : unitProfit >= 0 ? 'gain' : 'loss')));
  }
  numbers.append(...summaryCards);
  pane.append(numbers);
  const buyFinishedLoss = isLevel70Combo
    ? [level62Profit, level70Profit].some(profit => profit != null && profit < 0)
    : !recipe.bound && unitProfit != null && unitProfit < 0;
  if (buyFinishedLoss) {
    const advice = document.createElement('p');
    advice.className = 'buyFinishedAdvice';
    advice.textContent = isLevel70Combo
      ? 'Compra il prodotto finito per i risultati in perdita: il suo prezzo di mercato, tolta la tassa del 10%, è inferiore al costo di un craft.'
      : 'Conviene comprare l’oggetto finito: il suo prezzo di mercato, tolta la tassa del 10%, è inferiore al costo dei materiali per craftarlo.';
    pane.append(advice);
  }
  const heading = document.createElement('h3'); heading.textContent = recipe.transferFrom ? 'Equipaggiamento e materiali necessari' : 'Materiali necessari'; pane.append(heading);
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const label of ['Materiale', 'Quantità', 'Mercato / unità', 'Metodo scelto / unità', 'Totale da zero']) { const th = document.createElement('th'); th.textContent = label; trh.append(th); }
  head.append(trh); table.append(head);
  const body = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    const name = document.createElement('td'); name.className = 'material';
    const nameWrap = document.createElement('div'); nameWrap.className = 'materialName';
    const nameText = document.createElement('span'); nameText.className = 'itemGrade' + gradeClass(row.key); nameText.textContent = nameOf(row.key) + (row.transfer ? ' · da trasferire' : '');
    nameWrap.append(iconOf(row.key), nameText); name.append(nameWrap);
    const count = document.createElement('td'); count.textContent = formatAttempts(row.count);
    const priceCell = document.createElement('td');
    const input = document.createElement('input'); input.className = 'priceInput'; input.type = 'number'; input.min = '0'; input.step = '1';
    input.placeholder = row.market?.price == null ? (GLOBAL_VENDOR_PRICES[row.key] == null ? 'Mancante' : String(GLOBAL_VENDOR_PRICES[row.key])) : String(row.market.price);
    const manualValue = localStorage.getItem(overrideKey(row.key));
    input.value = manualValue || '';
    input.setAttribute('aria-label', 'Prezzo manuale per ' + nameOf(row.key));
    input.addEventListener('change', () => {
      if (input.value === '') localStorage.removeItem(overrideKey(row.key));
      else if (Number.isFinite(Number(input.value)) && Number(input.value) >= 0) localStorage.setItem(overrideKey(row.key), input.value);
      renderRecommendations(); renderDetail();
    });
    const source = document.createElement('div'); source.className = 'sourceTag';
    source.textContent = manualValue != null && manualValue !== '' ? 'Prezzo manuale' : row.market?.price == null ? (GLOBAL_VENDOR_PRICES[row.key] != null ? 'Negoziante Global · ' + format(GLOBAL_VENDOR_PRICES[row.key]) + ' Kina' : row.transfer ? 'Nessun annuncio: se lo possiedi, inserisci 0' : 'Nessun annuncio: inserisci il prezzo') : 'Mercato ' + format(row.market.price) + ' Kina · ' + (row.market.listings || 0) + ' annunci';
    priceCell.append(input, source);
    const craftCell = document.createElement('td');
    craftCell.textContent = row.own.cost == null ? '—' : format(row.own.cost) + ' Kina';
    if (row.own.cost == null) craftCell.className = 'missing';
    else if (row.own.source === 'craft' || row.own.source === 'morph') addBreakdown(craftCell, row.own);
    else {
      const text = document.createElement('div'); text.className = row.own.source === 'market-fallback' ? 'fallbackNote' : 'sourceTag';
      text.textContent = row.own.source === 'owned' ? 'Già posseduto' : row.own.source === 'market-fallback' ? 'Prezzo di mercato: manca un prezzo nella catena craft' : row.own.source === 'npc' ? 'Comprato dal negoziante' : 'Acquistato al mercato';
      craftCell.append(text);
      if (state.materialMode === 'optimize' && row.own.missingCraft?.length) addMissingPriceInputs(craftCell, row.own.missingCraft, 'Prezzi mancanti per valutare il craft');
    }
    const sum = document.createElement('td'); sum.textContent = row.own.cost == null ? '—' : format(row.own.cost * row.count);
    if (row.own.cost == null) sum.className = 'missing';
    tr.append(name, count, priceCell, craftCell, sum); body.append(tr);
  }
  table.append(body);
  const scroll = document.createElement('div'); scroll.className = 'tableScroll'; scroll.append(table); pane.append(scroll);
  addMissingPriceInputs(pane, ownAttempt.missing, 'Prezzi base mancanti per completare il craft');
  const fee = document.createElement('p'); fee.className = 'muted'; fee.textContent = 'Tariffa ricetta in Kina: non disponibile nei dati Global usati qui; non inclusa nel totale.'; pane.append(fee);
  const vendor = document.createElement('p'); vendor.className = 'muted'; vendor.textContent = 'I reagenti vincolati del negoziante Global, inclusi gli indurenti per le scale del drago, usano prezzi fissi in Kina. La trasformazione da Odyle produce materiali vincolati; verifica che tu abbia la maestria richiesta.'; pane.append(vendor);
}

async function loadPrices(preserveOld = false, forceRefresh = preserveOld) {
  if (!state.server) return;
  status((preserveOld ? 'Aggiornamento' : 'Caricamento') + ' prezzi di Vaizel · Europa…');
  try {
    const result = await getJSON('/api/prices?server=' + state.server + (forceRefresh ? '&refresh=' + Date.now() : ''));
    state.prices = new Map(result.items.map(item => [String(item.item_key), { name: item.name, price: item.price, listings: item.listings }]));
    state.fetchedAt = result.retrieved_at;
    savePriceHistory(state.prices, Date.now());
    const time = new Date(state.fetchedAt).toLocaleString('it-IT');
    status(state.prices.size + ' oggetti dal mercato · consultazione ' + time + ' · prezzi minimi degli annunci', 'good');
    renderQuickPrices(); renderRecommendations(); renderResults(); renderDetail(); void loadQuickPriceHistory();
    const dialog = $('marketModal');
    if (dialog.open && dialog.dataset.itemKey) await openMarketModal(dialog.dataset.itemKey, true);
  } catch (error) {
    if (!preserveOld) state.prices = new Map();
    status((preserveOld ? 'Aggiornamento non riuscito; restano i prezzi precedenti: ' : 'Prezzi non disponibili: ') + error.message + '. Puoi inserire prezzi manuali nelle ricette.', 'error');
    renderQuickPrices(); renderRecommendations(); renderResults(); renderDetail(); void loadQuickPriceHistory();
    const dialog = $('marketModal');
    if (dialog.open && dialog.dataset.itemKey) await openMarketModal(dialog.dataset.itemKey, true);
  }
}

async function init() {
  state.graph = await getJSON('/api/graph');
  completeRecipeItemCategories(state.graph);
  fillModes(); fillProfessions(); fillCategories(); renderQuickPrices(); renderRecommendations(); chooseFirst();
  await loadPrices();
}

$('closeMarketModal').addEventListener('click', () => $('marketModal').close());
$('marketModal').addEventListener('click', event => { if (event.target === $('marketModal')) $('marketModal').close(); });
window.addEventListener('resize', () => { const dialog = $('marketModal'); if (dialog.open && dialog.dataset.itemKey) drawPriceChart(dialog.dataset.itemKey, modalHistory); });

$('search').addEventListener('input', chooseFirst);
setInterval(() => loadPrices(true, false), AUTO_REFRESH_INTERVAL_MS);
init().catch(error => status('Impossibile caricare i dati: ' + error.message + '. Riprova fra poco.', 'error'));
