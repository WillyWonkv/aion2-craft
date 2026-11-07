// Expected costs for a crafted gear line. Gear always follows its crafting chain;
// materials may use the cheapest known market, crafting or Substance Morph route.
// Fixed Global shop prices in Kina for bound recipe ingredients (2026-11-07).
export const GLOBAL_VENDOR_PRICES = Object.freeze({
  '630541001': 400,   // Orichalcum Solvent
  '630520001': 4650,  // Zircon Hammer
  '630520002': 5600,  // Lazuli Hammer
  '630520003': 6550,  // Moonstone Hammer
  '630542001': 400,   // Abrasive
  '630542005': 400,   // Sandpaper
  '630543005': 400,   // Catalyst
  '630520007': 4650,  // Lesser Dragon Scale Hardener
  '630520008': 5600,  // Intermediate Dragon Scale Hardener
  '630520009': 6550,  // Superior Dragon Scale Hardener
  '630520004': 4650,  // Lesser Dragon Leather Softener
  '630520005': 5600,  // Intermediate Dragon Leather Softener
  '630520006': 6550,  // Superior Dragon Leather Softener
  '630543001': 400,   // Glass Bottle
  '630543002': 1200,  // Professional Glass Bottle
  '630543008': 1200,  // Professional Ink
  '630543013': 10000, // Exceptional Ink
  '530126003': 250,   // Life Potion
  '530116001': 1000,  // Life Serum
  '530146001': 630,   // Healing Potion
  '531060003': 1000,  // Speed Scroll
  '531060004': 1000,  // Courage Scroll
  '531060027': 1000,  // Benediction Scroll
  '630554001': 220,   // Sugar
  '630554005': 880,   // Verteron Pepper
  '630554011': 880,   // Altgard Pepper
  '630554003': 880,   // Ulmus Oil
  '630554008': 880,   // Raw Triora Noodles
  '630554002': 220,   // Salt
  '630554006': 440,   // Curry Powder
  '630554004': 440,   // Soy Sauce
  '630554009': 440,   // Cheese
  '630554007': 880,   // Abex Butter
});
export function resultChanceFor(recipe, target, overrides = {}) {
  if (recipe.safe) return target === 'combo' ? 0 : 1;
  const comboChance = recipe.combo ? Number(recipe.cp || 0) / 100 : 0;
  const success = overrides.successChance ?? recipe.successChance ?? 1;
  const comboSuccess = overrides.comboSuccessChance ?? recipe.comboSuccessChance ?? 1;
  return target === 'combo' ? success * comboChance * comboSuccess : success * (1 - comboChance);
}

export function expectedAttemptsFor(recipe, target, quantity, overrides = {}) {
  const chance = resultChanceFor(recipe, target, overrides);
  const yieldCount = target === 'combo' ? 1 : Number(recipe.outq) || 1;
  return chance > 0 ? quantity / (chance * yieldCount) : null;
}

export function createCostModel(graph, unitPrice, faction, isOwned = () => false, options = {}) {
  const optimizeMaterials = options.optimizeMaterials === true;
  const singleAttemptComboCrafting = options.singleAttemptComboCrafting === true;
  const byOutput = new Map();
  const byCombo = new Map();
  const gear = new Set();
  const memo = new Map();
  const morphInput = new Map();
  const byName = new Map(Object.entries(graph.items || {}).map(([id, item]) => [item.n, id]));
  const morphable = [
    'Orichalcum Ore', 'Sapphire Gemstone', 'Diamond Gemstone', 'Ruby Gemstone',
    'Yggdrasil Log', 'Asvata Log', 'Aria', 'Targena', 'Coriolus', 'Kukuru',
    'Mela', 'Inina', 'Cypri', 'Azpha', 'Calendula', 'Morfa', 'Ohkra',
    'Raydam', 'Conide', 'Pujery',
  ];
  for (const [prefix, odyleName] of [['', 'Odyle'], ['Fine ', 'Fine Odyle'], ['Pure ', 'Pure Odyle'], ['Radiant ', 'Radiant Odyle']]) {
    const odyleId = byName.get(odyleName);
    if (!odyleId) continue;
    for (const name of morphable) {
      const itemId = byName.get(prefix + name);
      if (itemId) morphInput.set(itemId, odyleId);
    }
  }
  const fineOdyle = byName.get('Fine Odyle');
  if (fineOdyle) for (const herb of ['Fresh Aria', 'Fresh Targena', 'Fresh Azpha', 'Fresh Calendula']) {
    const itemId = byName.get(herb);
    if (itemId) morphInput.set(itemId, fineOdyle);
  }
  for (const [id, recipe] of Object.entries(graph.recipes)) {
    if (recipe.qr !== faction) continue;
    const output = String(recipe.out);
    const outputType = graph.items?.[output]?.mc;
    if (['weapon', 'armor', 'accessory'].includes(outputType)) {
      gear.add(output);
      if (recipe.combo) gear.add(String(recipe.combo));
    }
    if (!byOutput.has(output)) byOutput.set(output, []);
    byOutput.get(output).push([id, recipe]);
    if (recipe.combo) {
      const combo = String(recipe.combo);
      if (!byCombo.has(combo)) byCombo.set(combo, []);
      byCombo.get(combo).push([id, recipe]);
    }
  }

  function inputs(recipe) {
    return recipe.transferFrom ? [[recipe.transferFrom, 1, 'transfer'], ...recipe.in] : recipe.in;
  }

  function sumInputs(recipe, resolve, trail = new Set()) {
    let cost = 0;
    const missing = new Set();
    const lines = [];
    for (const [rawKey, quantity, kind] of inputs(recipe)) {
      const key = String(rawKey);
      const unit = resolve(key, trail);
      const count = Number(quantity) || 0;
      lines.push({ key, quantity: count, kind: kind || 'material', unit });
      if (unit.cost == null) for (const id of unit.missing || [key]) missing.add(id);
      else cost += unit.cost * count;
    }
    return { cost: missing.size ? null : cost, missing: [...missing], lines };
  }

  function marketUnit(key) {
    if (options.excludeMarketFor?.(key)) return { cost: null, missing: [key], source: 'missing' };
    const price = unitPrice(key);
    if (price != null && Number.isFinite(price)) return { cost: price, missing: [], source: 'market' };
    const vendor = GLOBAL_VENDOR_PRICES[key];
    return vendor == null ? { cost: null, missing: [key], source: 'missing' } : { cost: vendor, missing: [], source: 'npc' };
  }

  function ownUnit(key, trail = new Set()) {
    const override = options.unitOverrideFor?.(key);
    if (override) return override;
    if (isOwned(key)) return { cost: 0, missing: [], source: 'owned' };
    if (!gear.has(key) && !optimizeMaterials) return marketUnit(key);
    if (memo.has(key)) return memo.get(key);
    if (trail.has(key)) return { cost: null, missing: [key], source: 'cycle' };
    const routes = [
      ...(byOutput.get(key) || []).map(([id, recipe]) => ({ id, recipe, combo: false })),
      ...(byCombo.get(key) || []).map(([id, recipe]) => ({ id, recipe, combo: true })),
    ];
    const next = new Set(trail);
    next.add(key);
    let best = null;
    const missing = new Set();
    for (const route of routes) {
      const attempt = sumInputs(route.recipe, ownUnit, next);
      if (attempt.cost == null) {
        for (const id of attempt.missing) missing.add(id);
        continue;
      }
      const overrides = { successChance: options.successRateFor?.(route.id), comboSuccessChance: options.comboSuccessRateFor?.(route.id) };
      const chance = resultChanceFor(route.recipe, route.combo ? 'combo' : 'normal', overrides);
      const yieldCount = route.combo ? 1 : Number(route.recipe.outq) || 1;
      if (chance <= 0) continue;
      const expectedAttempts = singleAttemptComboCrafting && route.combo && Number(route.recipe.cp || 0) === 25 ? 1 : 1 / (chance * yieldCount);
      const candidate = { cost: attempt.cost * expectedAttempts, missing: [], source: 'craft', recipeId: route.id, combo: route.combo, expectedAttempts, attemptCost: attempt.cost, lines: attempt.lines };
      if (!best || candidate.cost < best.cost) best = candidate;
    }
    const morphId = morphInput.get(key);
    if (optimizeMaterials && !gear.has(key) && morphId) {
      const odyle = ownUnit(morphId, next);
      if (odyle.cost != null) {
        const candidate = { cost: odyle.cost, missing: [], source: 'morph', odyleId: morphId, lines: [{ key: morphId, quantity: 1, kind: 'morph', unit: odyle }] };
        if (!best || candidate.cost < best.cost) best = candidate;
      } else for (const id of odyle.missing || [morphId]) missing.add(id);
    }
    const fallback = marketUnit(key);
    const result = gear.has(key)
      ? best || (fallback.cost != null
        ? { ...fallback, source: 'market-fallback', missingCraft: [...missing] }
        : { cost: null, missing: missing.size ? [...missing] : [key], source: 'missing' })
      : fallback.cost != null && (!best || fallback.cost <= best.cost)
        ? { ...fallback, missingCraft: [...missing] }
        : best || { cost: null, missing: missing.size ? [...missing] : [key], source: 'missing' };
    memo.set(key, result);
    return result;
  }

  return {
    marketUnit,
    ownUnit,
    marketAttempt: recipe => sumInputs(recipe, marketUnit),
    ownAttempt: recipe => sumInputs(recipe, ownUnit),
  };
}
