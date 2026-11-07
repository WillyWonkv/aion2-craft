import { createCostModel, expectedAttemptsFor, resultChanceFor, GLOBAL_VENDOR_PRICES } from './cost-model.js';

const $ = id => document.getElementById(id);
const state = { graph: null, servers: [], prices: new Map(), region: 'EU', server: 11303, mode: 'crafting', profession: 'blacksmithing', category: 'all', selected: null, target: 'combo', materialMode: 'optimize', fetchedAt: null };
const format = value => value == null || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString('it-IT');
const formatAttempts = value => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const formatPercent = value => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 2 });
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

function iconOf(key, extraClass = '') {
  const item = state.graph?.items?.[String(key)];
  const url = item?.icon;
  if (!url) return document.createElement('span');
  const image = document.createElement('img');
  image.className = 'itemIcon' + (extraClass ? ' ' + extraClass : '');
  image.src = url;
  image.alt = '';
  image.loading = 'lazy';
  image.onerror = () => image.remove();
  return image;
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
  return professionRecipes().filter(([, recipe]) =>
    (state.category === 'all' || categoryOf(recipe) === state.category) &&
    (!query || nameOf(recipe.out).toLocaleLowerCase().includes(query))
  );
}

function chooseFirst() {
  state.selected = visibleRecipes()[0]?.[0] || null;
  state.target = state.graph?.recipes?.[state.selected]?.combo ? 'combo' : 'normal';
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
    const title = document.createElement('strong');
    title.textContent = nameOf(recipe.out);
    const sub = document.createElement('span');
    sub.textContent = (categoryLabels[categoryOf(recipe)] || 'Materiali') + ' · ' + masteryLabel(recipe.ml) + (recipe.safe ? ' · Sicuro 100% (vincolato)' : recipe.successChance != null ? ' · Con combo e rischio' : '');
    text.append(title, sub);
    button.append(icon, text);
    button.addEventListener('click', () => { state.selected = id; state.target = recipe.combo ? 'combo' : 'normal'; renderResults(); renderDetail(); });
    list.append(button);
  }
}

function overrideKey(itemKey) { return 'aion2craft:' + state.server + ':' + itemKey; }
function chanceKey(recipeId, kind) { return 'aion2craft:chance:' + recipeId + ':' + kind; }
function chanceOverride(recipeId, kind) {
  const saved = localStorage.getItem(chanceKey(recipeId, kind));
  return saved == null ? undefined : Number(saved) / 100;
}
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
      renderDetail();
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
  const desired = Math.max(1, Math.min(9999, Number($('desiredQuantity')?.value) || 1));
  if (!recipe.combo) state.target = 'normal';
  const chanceOverrides = { successChance: chanceOverride(state.selected, 'success'), comboSuccessChance: chanceOverride(state.selected, 'combo') };
  const expectedAttempts = expectedAttemptsFor(recipe, state.target, desired, chanceOverrides);
  const resultChance = resultChanceFor(recipe, state.target, chanceOverrides);
  pane.replaceChildren();
  const titleRow = document.createElement('div'); titleRow.className = 'titleRow';
  const title = document.createElement('h2'); title.textContent = nameOf(recipe.out);
  titleRow.append(iconOf(recipe.out, 'large'), title);
  const meta = document.createElement('div'); meta.className = 'detailMeta muted';
  meta.textContent = (recipe.type === 'transfer' ? 'Transfer Crafting' : 'Crafting') + ' › ' + (professionLabels[recipe.p] || recipe.p || 'Crafting') + ' › ' + (categoryLabels[categoryOf(recipe)] || categoryOf(recipe)) + ' · ' + masteryLabel(recipe.ml) + ' · ' + (recipe.outq || 1) + ' per tentativo' + (recipe.safe ? ' · craft sicuro' : recipe.successChance != null ? ' · craft con combo e rischio' : '');
  const control = document.createElement('div'); control.className = 'controls';
  const quantityWrap = document.createElement('div');
  const quantityLabel = document.createElement('label'); quantityLabel.htmlFor = 'desiredQuantity'; quantityLabel.textContent = 'Quantità desiderata';
  const quantity = document.createElement('input'); quantity.id = 'desiredQuantity'; quantity.type = 'number'; quantity.min = '1'; quantity.max = '9999'; quantity.value = String(desired);
  quantity.addEventListener('change', renderDetail);
  quantityWrap.append(quantityLabel, quantity);
  control.append(quantityWrap);
  const variants = Object.entries(state.graph.recipes).filter(([, other]) => other.type === recipe.type && other.p === recipe.p && other.qr === recipe.qr && String(other.out) === String(recipe.out) && (other.safe || other.successChance != null));
  if (variants.length > 1) {
    const routeWrap = document.createElement('div'); routeWrap.className = 'craftRoute';
    const routeLabel = document.createElement('label'); routeLabel.htmlFor = 'craftRoute'; routeLabel.textContent = 'Ricetta';
    const route = document.createElement('select'); route.id = 'craftRoute';
    for (const [id, optionRecipe] of variants) {
      const option = document.createElement('option'); option.value = id; option.textContent = optionRecipe.safe ? 'Sicuro · arma base vincolata' : 'Con combo · può fallire'; route.append(option);
    }
    route.value = state.selected;
    route.addEventListener('change', () => { state.selected = route.value; state.target = state.graph.recipes[route.value].combo ? 'combo' : 'normal'; renderResults(); renderDetail(); });
    routeWrap.append(routeLabel, route); control.append(routeWrap);
  }
  if (recipe.combo) {
    const targetWrap = document.createElement('div');
    const targetLabel = document.createElement('label'); targetLabel.htmlFor = 'targetResult'; targetLabel.textContent = 'Risultato desiderato';
    const target = document.createElement('select'); target.id = 'targetResult';
    for (const [value, label] of [['combo', 'Splendent'], ['normal', 'Normale']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; target.append(option);
    }
    target.value = state.target;
    target.addEventListener('change', () => { state.target = target.value; renderDetail(); });
    targetWrap.append(targetLabel, target); control.append(targetWrap);
  }
  if (recipe.successChance != null && !recipe.safe) {
    for (const [kind, label, fallback] of [['success', 'Successo craft %', recipe.successChance], ['combo', 'Successo combo %', recipe.comboSuccessChance]]) {
      const wrap = document.createElement('div');
      const fieldLabel = document.createElement('label'); fieldLabel.textContent = label;
      const field = document.createElement('input'); field.type = 'number'; field.min = '1'; field.max = '100'; field.step = '0.01';
      field.value = String((chanceOverride(state.selected, kind) ?? fallback) * 100);
      field.setAttribute('aria-label', label);
      field.addEventListener('change', () => {
        const value = Number(field.value);
        if (Number.isFinite(value) && value > 0 && value <= 100) localStorage.setItem(chanceKey(state.selected, kind), String(value));
        else localStorage.removeItem(chanceKey(state.selected, kind));
        renderDetail();
      });
      wrap.append(fieldLabel, field); control.append(wrap);
    }
  }
  const modeWrap = document.createElement('div'); modeWrap.className = 'materialMode';
  const modeLabel = document.createElement('label'); modeLabel.htmlFor = 'materialMode'; modeLabel.textContent = 'Materiali di partenza';
  const mode = document.createElement('select'); mode.id = 'materialMode';
  for (const [value, label] of [['optimize', 'Prezzo più basso'], ['market', 'Compra al mercato']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; mode.append(option);
  }
  mode.value = state.materialMode;
  mode.addEventListener('change', () => { state.materialMode = mode.value; renderDetail(); });
  modeWrap.append(modeLabel, mode); control.append(modeWrap);
  const note = document.createElement('p'); note.className = 'note'; note.textContent = recipe.safe ? 'Questa ricetta riesce sempre, produce l’arma base vincolata e non può fare combo. I pezzi precedenti della linea si craftano. La tariffa in Kina non è inclusa.' : recipe.successChance != null ? 'Il 25% è l’attivazione della combo dopo il successo del craft; anche la combo può fallire. Le due percentuali sopra partono dai valori Global alla maestria minima: sostituiscile con quelle mostrate nel tuo gioco. I fallimenti dei craft precedenti e la tariffa in Kina non sono inclusi.' : 'La quantità indica i pezzi che vuoi ottenere; i tentativi sono stimati dalla probabilità della combo. Per i materiali il prezzo più basso confronta mercato, craft e trasformazione 1:1 dall’Odyle della stessa qualità. I pezzi precedenti della linea si craftano. Fallimenti e tariffa in Kina non sono inclusi.';
  control.append(note);
  pane.append(titleRow, meta, control);

  const faction = serverFaction() === 'Asmodian' ? 'dark' : 'light';
  const model = createCostModel(state.graph, unitPrice, faction, key => localStorage.getItem(overrideKey(key)) === '0', {
    optimizeMaterials: state.materialMode === 'optimize',
    successRateFor: id => chanceOverride(id, 'success'),
    comboSuccessRateFor: id => chanceOverride(id, 'combo'),
  });
  const marketAttempt = model.marketAttempt(recipe);
  const ownAttempt = model.ownAttempt(recipe);
  const fallbackItems = collectFallbacks(ownAttempt.lines);
  const rows = [];
  const ingredients = recipe.transferFrom ? [[recipe.transferFrom, 1, 'transfer']].concat(recipe.in) : recipe.in;
  for (const ingredient of ingredients) {
    const key = String(ingredient[0]);
    const count = Number(ingredient[1]) * expectedAttempts;
    rows.push({ key, count, buy: model.marketUnit(key), own: model.ownUnit(key), market: state.prices.get(key), transfer: ingredient[2] === 'transfer' });
  }
  const targetItem = state.target === 'combo' ? String(recipe.combo) : String(recipe.out);
  const output = state.prices.get(targetItem);
  const sale = recipe.bound || output?.price == null ? null : Number(output.price) * desired;
  const missingBuyNames = marketAttempt.missing.map(nameOf);
  const missingBuyNote = missingBuyNames.length === 1
    ? 'Manca il prezzo di ' + missingBuyNames[0] + '; inseriscilo nella tabella sotto'
    : missingBuyNames.length + ' componenti senza prezzo: ' + missingBuyNames.join(', ');
  const numbers = document.createElement('div'); numbers.className = 'numbers';
  numbers.append(
    box('Comprando i componenti', marketAttempt.cost == null ? 'Prezzo mancante' : format(marketAttempt.cost * expectedAttempts) + ' Kina', marketAttempt.missing.length ? missingBuyNote : 'Per ' + desired + ' ' + (state.target === 'combo' ? 'Splendent' : 'normali'), marketAttempt.cost == null ? 'warn' : ''),
    box('Craftato', ownAttempt.cost == null ? 'Incompleto' : format(ownAttempt.cost * expectedAttempts) + ' Kina', ownAttempt.missing.length ? ownAttempt.missing.length + ' prezzi mancanti' : fallbackItems.size ? fallbackItems.size + ' pezzi comprati perché la loro catena non è valutabile' : state.materialMode === 'optimize' ? 'Materiali al percorso meno caro, pezzi precedenti craftati' : 'Materiali comprati, pezzi precedenti craftati', ownAttempt.cost == null ? 'warn' : 'accent'),
    box('Tentativi medi richiesti', formatAttempts(expectedAttempts), formatPercent(resultChance * 100) + '% di probabilità per tentativo' + (recipe.safe ? ' · garantito' : ' · media, non garantito')),
    box('Prezzo dei pezzi sul mercato', sale == null ? '—' : format(sale) + ' Kina', recipe.bound ? 'Risultato vincolato: non vendibile' : output ? (output.listings || 0) + ' annunci · ' + desired + ' pezzi' : 'Nessun annuncio')
  );
  pane.append(numbers);
  const heading = document.createElement('h3'); heading.textContent = recipe.transferFrom ? 'Equipaggiamento e materiali medi necessari' : 'Materiali medi necessari'; pane.append(heading);
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
    const nameText = document.createElement('span'); nameText.textContent = nameOf(row.key) + (row.transfer ? ' · da trasferire' : '');
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
      renderDetail();
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
    renderResults(); renderDetail();
  } catch (error) {
    if (!preserveOld) state.prices = new Map();
    status((preserveOld ? 'Aggiornamento non riuscito; restano i prezzi precedenti: ' : 'Prezzi non disponibili: ') + error.message + '. Puoi inserire prezzi manuali nelle ricette.', 'error');
    renderResults(); renderDetail();
  } finally { $('reload').disabled = false; }
}

async function init() {
  state.graph = await getJSON('/api/graph');
  const serverResult = await getJSON('/api/servers');
  state.servers = serverResult.servers || [];
  const saved = Number(localStorage.getItem('aion2craft:server'));
  if (state.servers.some(server => server.server_id === saved)) state.server = saved;
  state.region = state.servers.find(server => server.server_id === state.server)?.region || 'EU';
  fillRegions(); fillServers(); fillModes(); fillProfessions(); fillCategories(); chooseFirst();
  await loadPrices();
}

$('region').addEventListener('change', () => { state.region = $('region').value; fillServers(); localStorage.setItem('aion2craft:server', String(state.server)); fillCategories(); chooseFirst(); loadPrices(); });
$('server').addEventListener('change', () => { state.server = Number($('server').value); localStorage.setItem('aion2craft:server', String(state.server)); fillCategories(); chooseFirst(); loadPrices(); });
$('search').addEventListener('input', chooseFirst);
$('reload').addEventListener('click', () => loadPrices(true));
init().catch(error => status('Impossibile caricare i dati: ' + error.message + '. Riprova fra poco.', 'error'));
