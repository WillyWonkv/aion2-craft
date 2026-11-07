import { createCostModel, GLOBAL_VENDOR_PRICES } from './cost-model.js';

const $ = id => document.getElementById(id);
const state = { graph: null, servers: [], prices: new Map(), region: 'EU', server: 11303, mode: 'crafting', profession: 'blacksmithing', category: 'all', selected: null, materialMode: 'optimize', fetchedAt: null };
const format = value => value == null || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString('it-IT');
const formatAttempts = value => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const formatPercent = value => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const MAX_CRAFT_SUCCESS = 0.9464;
const MAX_COMBO_SUCCESS = 0.23 / (MAX_CRAFT_SUCCESS * 0.25);
const MARKET_TAX_RATE = 0.10;
const netSale = value => value == null ? null : Number(value) * (1 - MARKET_TAX_RATE);
const QUICK_PRICE_ITEMS = [
  '610511013', '610511015', '610511014',
  '610610013', '610610014', '610610015', '610610016',
  '610530001', '610530005', '610530008', '610530010',
];
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
    const card = document.createElement('article'); card.className = 'quickPrice';
    const text = document.createElement('div');
    const name = document.createElement('span'); name.className = 'quickPriceName itemGrade' + gradeClass(key); name.textContent = nameOf(key); name.title = name.textContent;
    const price = document.createElement('strong'); price.textContent = market?.price == null ? '—' : format(Number(market.price)) + ' Kina';
    const listings = document.createElement('small'); listings.textContent = market ? (market.listings || 0) + ' annunci' : 'Prezzo non disponibile';
    text.append(name, price, listings); card.append(iconOf(key), text);
    return card;
  }));
}

function renderRecommendations() {
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
  const recommendations = [...byResult.values()].sort((a, b) => b.profit - a.profit).slice(0, 6);
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
    text.append(name, route); head.append(iconOf(entry.targetKey), text, rank);
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

function recipes() {
  if (!state.graph?.recipes) return [];
  return Object.entries(state.graph.recipes).filter(([, recipe]) => Array.isArray(recipe.in) && recipe.in.length && recipe.out);
}

function serverFaction() {
  return state.servers.find(server => server.server_id === state.server)?.faction;
}

function categoryOf(recipe) {
  return state.graph?.items?.[String(recipe.out)]?.sc || 'other';
}

function professionRecipes() {
  const faction = serverFaction();
  return recipes().filter(([, recipe]) => recipe.type === state.mode && recipe.p === state.profession && (!faction || recipe.qr === (faction === 'Elyos' ? 'light' : 'dark')));
}

function visibleRecipes() {
  const query = $('search').value.trim().toLocaleLowerCase();
  return professionRecipes()
    .filter(([, recipe]) =>
      (state.category === 'all' || categoryOf(recipe) === state.category) &&
      (!query || nameOf(recipe.out).toLocaleLowerCase().includes(query))
    )
    .sort(([, a], [, b]) =>
      (Number(a.ml) || 0) - (Number(b.ml) || 0) ||
      nameOf(a.out).localeCompare(nameOf(b.out), 'en') ||
      Number(Boolean(a.safe)) - Number(Boolean(b.safe))
    );
}

function chooseFirst() {
  state.selected = visibleRecipes()[0]?.[0] || null;
  renderResults();
  renderDetail();
}

function fillRegions() {
  const labels = { EU: 'Europa', NAE: 'Nord America Est', NAW: 'Nord America Ovest', LA: 'America Latina', AS: 'Asia (Global)' };
  const available = [...new Set(state.servers.map(server => server.region))];
  available.sort((a, b) => Object.keys(labels).indexOf(a) - Object.keys(labels).indexOf(b));
  $('region').replaceChildren(...available.map(region => {
    const option = document.createElement('option');
    option.value = region;
    option.textContent = labels[region] || region;
    return option;
  }));
  if (!available.includes(state.region)) state.region = available[0];
  $('region').value = state.region;
}

function fillServers() {
  const servers = state.servers.filter(server => server.region === state.region);
  $('server').replaceChildren(...servers.map(server => {
    const option = document.createElement('option');
    option.value = String(server.server_id);
    option.textContent = server.name + ' · ' + (server.faction === 'Elyos' ? 'Elyos' : 'Asmodian');
    return option;
  }));
  if (!servers.some(server => server.server_id === state.server)) state.server = servers[0]?.server_id;
  $('server').value = String(state.server);
}

function fillProfessions() {
  $('professions').replaceChildren(...Object.keys(professionLabels).map(value => {
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
  $('modes').replaceChildren(...[['crafting', 'Crafting'], ['transfer', 'Transfer Crafting']].map(([value, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = state.mode === value ? 'active' : '';
    button.textContent = label;
    button.addEventListener('click', () => { state.mode = value; state.category = 'all'; $('search').value = ''; fillModes(); fillCategories(); chooseFirst(); });
    return button;
  }));
}

function fillCategories() {
  const available = [...new Set(professionRecipes().map(([, recipe]) => categoryOf(recipe)))];
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
    button.className = 'result' + (state.selected === id ? ' active' : '');
    const icon = iconOf(recipe.out);
    const text = document.createElement('div');
    const title = document.createElement('strong'); title.className = 'itemGrade' + gradeClass(recipe.out);
    title.textContent = nameOf(recipe.out);
    const sub = document.createElement('span');
    sub.textContent = (categoryLabels[categoryOf(recipe)] || 'Materiali') + ' · ' + masteryLabel(recipe.ml) + (recipe.safe ? ' · Sicuro · livello 63 vincolato' : recipe.successChance != null ? ' · Combo · risultato livello 70' : '');
    text.append(title, sub);
    button.append(icon, text);
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

function renderDetail() {
  const pane = $('detail');
  const recipe = state.graph?.recipes?.[state.selected];
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
  titleRow.append(iconOf(recipe.out, 'large'), title);
  const meta = document.createElement('div'); meta.className = 'detailMeta muted';
  meta.textContent = (recipe.type === 'transfer' ? 'Transfer Crafting' : 'Crafting') + ' › ' + (professionLabels[recipe.p] || recipe.p || 'Crafting') + ' › ' + (categoryLabels[categoryOf(recipe)] || categoryOf(recipe)) + ' · ' + masteryLabel(recipe.ml) + ' · ' + (recipe.outq || 1) + ' per tentativo' + (recipe.safe ? ' · risultato sicuro livello 63' : recipe.successChance != null ? ' · combo livello 70' : '');
  const control = document.createElement('div'); control.className = 'controls';
  const quantityWrap = document.createElement('div');
  const quantityLabel = document.createElement('label'); quantityLabel.htmlFor = 'craftQuantity'; quantityLabel.textContent = 'Quantità da craftare';
  const quantity = document.createElement('input'); quantity.id = 'craftQuantity'; quantity.type = 'number'; quantity.min = '1'; quantity.max = '9999'; quantity.value = String(craftCount);
  quantity.addEventListener('change', renderDetail);
  quantityWrap.append(quantityLabel, quantity);
  control.append(quantityWrap);
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
  const note = document.createElement('p'); note.className = 'note'; note.textContent = recipe.safe ? 'La quantità indica quanti craft vuoi eseguire. Questa ricetta riesce sempre, produce l’arma base vincolata e non può fare combo. La tariffa in Kina non è inclusa.' : recipe.successChance != null ? 'La quantità indica quanti craft vuoi eseguire. Le combo attese usano il 25%: per esempio, 20 craft attivano in media 5 combo. Per i True Dragon il calcolo usa automaticamente la probabilità massima della professione al livello 50.' : 'La quantità indica quanti craft vuoi eseguire. Le combo attese sono una media: con il 25%, 20 craft corrispondono a 5 combo. Per i materiali, Craftato confronta mercato, craft e trasformazione 1:1 dall’Odyle.';
  control.append(note);
  pane.append(titleRow, meta, control);

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
  const level63Price = baseOutput?.price == null ? null : Number(baseOutput.price);
  const level63Net = netSale(level63Price);
  const level70Net = netSale(marketUnitPrice);
  const level63Profit = ownAttempt.cost == null || level63Net == null ? null : level63Net - ownAttempt.cost;
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
  summaryCards.push(box(recipe.combo ? 'Combo al 25% attese' : 'Oggetti attesi', recipe.combo ? formatAttempts(expectedComboActivations) : formatAttempts(expectedOutput), recipe.combo ? (recipe.successChance != null && !recipe.safe ? formatAttempts(expectedComboResults) + ' oggetti combo riusciti stimati considerando i fallimenti' : craftCount + ' craft × ' + formatPercent(comboRate * 100) + '% · valore medio') : 'Da ' + craftCount + ' craft', isLevel70Combo ? 'wide' : ''));
  if (isLevel70Combo) {
    summaryCards.push(
      box('Prezzo mercato risultato normale Lv. 63', level63Price == null ? '—' : format(level63Price) + ' Kina', baseOutput ? (baseOutput.listings || 0) + ' annunci · prezzo minimo' : 'Nessun annuncio'),
      box('Prezzo mercato combo Lv. 70', marketUnitPrice == null ? '—' : format(marketUnitPrice) + ' Kina', output ? (output.listings || 0) + ' annunci · prezzo minimo' : 'Nessun annuncio')
    );
    summaryCards.push(
      box('Ricavo netto Lv. 63', level63Net == null ? '—' : format(level63Net) + ' Kina', 'Prezzo mercato meno tassa di vendita 10%'),
      box('Ricavo netto combo Lv. 70', level70Net == null ? '—' : format(level70Net) + ' Kina', 'Prezzo mercato meno tassa di vendita 10%')
    );
    summaryCards.push(
      box('Guadagno / perdita netta se esce Lv. 63', level63Profit == null ? '—' : (level63Profit >= 0 ? '+' : '−') + format(Math.abs(level63Profit)) + ' Kina', level63Profit == null ? 'Servono costo craftato e prezzo Lv. 63' : 'Ricavo netto Lv. 63 − costo di 1 craft · inserzione esclusa', 'outcomeProfit ' + (level63Profit == null ? '' : level63Profit >= 0 ? 'gain' : 'loss')),
      box('Guadagno / perdita netta se esce combo Lv. 70', level70Profit == null ? '—' : (level70Profit >= 0 ? '+' : '−') + format(Math.abs(level70Profit)) + ' Kina', level70Profit == null ? 'Servono costo craftato e prezzo Lv. 70' : 'Ricavo netto Lv. 70 − costo di 1 craft · inserzione esclusa', 'outcomeProfit ' + (level70Profit == null ? '' : level70Profit >= 0 ? 'gain' : 'loss'))
    );
  } else {
    summaryCards.push(box('Prezzo mercato / 1 ' + resultLabel, marketUnitPrice == null ? '—' : format(marketUnitPrice) + ' Kina', recipe.bound ? 'Risultato vincolato: non vendibile' : output ? (output.listings || 0) + ' annunci · netto tassa 10%: ' + format(marketUnitNet) + ' Kina' : 'Nessun annuncio'));
    summaryCards.push(box('Guadagno / perdita netta per 1 ' + resultLabel, unitProfit == null ? '—' : (unitProfit >= 0 ? '+' : '−') + format(Math.abs(unitProfit)) + ' Kina', unitProfit == null ? 'Servono costo craftato e prezzo di mercato' : 'Ricavo netto − costo medio craftato · inserzione esclusa', 'profitResult ' + (unitProfit == null ? '' : unitProfit >= 0 ? 'gain' : 'loss')));
  }
  numbers.append(...summaryCards);
  pane.append(numbers);
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

async function loadPrices(preserveOld = false) {
  if (!state.server) return;
  status((preserveOld ? 'Aggiornamento' : 'Caricamento') + ' prezzi di ' + $('server').selectedOptions[0]?.textContent + '…');
  $('reload').disabled = true;
  try {
    const result = await getJSON('/api/prices?server=' + state.server + (preserveOld ? '&refresh=' + Date.now() : ''));
    state.prices = new Map(result.items.map(item => [String(item.item_key), { name: item.name, price: item.price, listings: item.listings }]));
    state.fetchedAt = result.retrieved_at;
    const time = new Date(state.fetchedAt).toLocaleString('it-IT');
    status(state.prices.size + ' oggetti dal mercato · consultazione ' + time + ' · prezzi minimi degli annunci', 'good');
    renderQuickPrices(); renderRecommendations(); renderResults(); renderDetail();
  } catch (error) {
    if (!preserveOld) state.prices = new Map();
    status((preserveOld ? 'Aggiornamento non riuscito; restano i prezzi precedenti: ' : 'Prezzi non disponibili: ') + error.message + '. Puoi inserire prezzi manuali nelle ricette.', 'error');
    renderQuickPrices(); renderRecommendations(); renderResults(); renderDetail();
  } finally { $('reload').disabled = false; }
}

async function init() {
  state.graph = await getJSON('/api/graph');
  const serverResult = await getJSON('/api/servers');
  state.servers = serverResult.servers || [];
  const saved = Number(localStorage.getItem('aion2craft:server'));
  if (state.servers.some(server => server.server_id === saved)) state.server = saved;
  state.region = state.servers.find(server => server.server_id === state.server)?.region || 'EU';
  fillRegions(); fillServers(); fillModes(); fillProfessions(); fillCategories(); renderQuickPrices(); renderRecommendations(); chooseFirst();
  await loadPrices();
}

$('region').addEventListener('change', () => { state.region = $('region').value; fillServers(); localStorage.setItem('aion2craft:server', String(state.server)); fillCategories(); chooseFirst(); loadPrices(); });
$('server').addEventListener('change', () => { state.server = Number($('server').value); localStorage.setItem('aion2craft:server', String(state.server)); fillCategories(); chooseFirst(); loadPrices(); });
$('search').addEventListener('input', chooseFirst);
$('reload').addEventListener('click', () => loadPrices(true));
init().catch(error => status('Impossibile caricare i dati: ' + error.message + '. Riprova fra poco.', 'error'));
