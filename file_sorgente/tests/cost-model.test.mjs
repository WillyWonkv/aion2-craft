import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCostModel, expectedAttemptsFor, resultChanceFor, GLOBAL_VENDOR_PRICES } from '../public/cost-model.js';

const synthetic = {
  items: Object.fromEntries(['normal1', 'spl1', 'normal2', 'spl2', 'normal3', 'spl3', 'transfer1'].map(key => [key, { mc: 'weapon' }])),
  recipes: {
    base: { qr: 'light', out: 'normal1', combo: 'spl1', cp: 25, outq: 1, in: [['ore', 1]] },
    expert: { qr: 'light', out: 'normal2', combo: 'spl2', cp: 25, outq: 1, in: [['spl1', 1]] },
    artisan: { qr: 'light', out: 'normal3', combo: 'spl3', cp: 25, outq: 1, in: [['spl2', 1]] },
    transfer: { qr: 'light', out: 'transfer1', in: [['ore', 2]], transferFrom: 'spl3', outq: 1 },
  },
};
const model = createCostModel(synthetic, key => key === 'ore' ? 1 : null, 'light');
assert.equal(model.ownUnit('spl1').cost, 4);
assert.equal(model.ownUnit('spl2').cost, 16);
assert.equal(model.ownUnit('spl3').cost, 64);
assert.equal(model.ownUnit('normal1').cost, 4 / 3);
assert.equal(model.ownAttempt(synthetic.recipes.transfer).cost, 66);
assert.equal(model.marketAttempt(synthetic.recipes.artisan).cost, null);

const global = JSON.parse(await readFile(new URL('../public/recipes-global.json', import.meta.url), 'utf8'));
const recipes = Object.values(global.recipes);
assert.equal(recipes.length, 566);
assert.equal(recipes.filter(recipe => recipe.qr === 'light').length, 283);
assert.equal(recipes.filter(recipe => recipe.safe).length, 38);
for (const safe of recipes.filter(recipe => recipe.safe)) {
  const risky = global.recipes[safe.riskyId];
  assert.ok(risky?.combo, safe.riskyId);
  assert.equal(safe.out, risky.out);
  assert.deepEqual(safe.in, risky.in);
}
assert.equal(recipes.filter(recipe => recipe.type === 'transfer').length, 190);
assert.equal(recipes.filter(recipe => recipe.type === 'transfer' && !global.items[recipe.transferFrom]).length, 0);
const spellbookModel = createCostModel(global, () => 1, 'light');
for (const name of ['Truth Spellbook', "Expert's Truth Spellbook", "Artisan's Truth Spellbook"]) {
  const recipe = recipes.find(entry => entry.qr === 'light' && global.items[entry.out]?.n === name);
  assert.ok(recipe, name);
  assert.equal(spellbookModel.ownUnit(recipe.combo).expectedAttempts, 4, name);
}
const truth = recipes.find(entry => entry.qr === 'light' && global.items[entry.out]?.n === 'Truth Spellbook');
assert.equal(expectedAttemptsFor(truth, 'combo', 1), 4);
assert.equal(expectedAttemptsFor(truth, 'combo', 3), 12);
assert.equal(expectedAttemptsFor(truth, 'normal', 1), 4 / 3);
const riskyDragon = global.recipes['311053001'];
const safeDragon = global.recipes['351053002'];
assert.equal(safeDragon.safe, true);
assert.equal(safeDragon.combo, undefined);
assert.deepEqual(safeDragon.in, riskyDragon.in);
assert.equal(expectedAttemptsFor(safeDragon, 'normal', 1), 1);
assert.equal(expectedAttemptsFor(safeDragon, 'combo', 1), null);
assert.ok(Math.abs(resultChanceFor(riskyDragon, 'combo') - 0.135188775) < 1e-9);
assert.ok(Math.abs(expectedAttemptsFor(riskyDragon, 'combo', 1) - 7.397064) < 1e-5);
assert.ok(Math.abs(expectedAttemptsFor(riskyDragon, 'normal', 1) - 1 / (0.6751 * 0.75)) < 1e-9);
assert.equal(expectedAttemptsFor(riskyDragon, 'combo', 1, { successChance: 1, comboSuccessChance: 1 }), 4);
const observedPrices = { '610740015': 4600, '610530014': 10, '610530001': 549, '610610013': 4798 };
const partial = createCostModel(global, key => observedPrices[key] ?? null, 'light');
assert.equal(partial.ownUnit('610740015').source, 'market');
assert.equal(partial.ownAttempt(truth).cost, 26141);
assert.equal(partial.ownAttempt(truth).cost / 0.25, 104564);
const completed = createCostModel(global, key => ({ ...observedPrices, '630543005': 400 })[key] ?? null, 'light');
assert.equal(completed.ownUnit('610740015').source, 'market');
assert.equal(completed.ownAttempt(truth).cost, partial.ownAttempt(truth).cost);
const optimized = createCostModel(global, key => ({ ...observedPrices, '630543005': 400 })[key] ?? null, 'light', () => false, { optimizeMaterials: true });
assert.equal(optimized.ownUnit('610740015').source, 'craft');
assert.equal(optimized.ownUnit('610740015').cost, 420);
assert.equal(optimized.ownAttempt(truth).cost, 13601);
const missingCatalyst = createCostModel(global, key => observedPrices[key] ?? null, 'light', () => false, { optimizeMaterials: true });
assert.equal(missingCatalyst.ownUnit('610740015').source, 'craft');
assert.equal(missingCatalyst.ownUnit('610740015').cost, 420);
assert.equal(GLOBAL_VENDOR_PRICES['630520007'], 4650);
assert.equal(GLOBAL_VENDOR_PRICES['630520008'], 5600);
assert.equal(GLOBAL_VENDOR_PRICES['630520009'], 6550);
const scaleRecipe = recipes.find(entry => entry.qr === 'light' && global.items[entry.out]?.n === 'Enhanced Thick Balaur Scale');
const scaleModel = createCostModel(global, key => key === scaleRecipe.in[0][0] ? 100 : null, 'light', () => false, { optimizeMaterials: true });
assert.equal(scaleModel.ownAttempt(scaleRecipe).cost, 4850);
const morphPrices = { '610620013': 100, '610610013': 20, '610660025': 80, '610660028': 500, '610610014': 40 };
const morphed = createCostModel(global, key => morphPrices[key] ?? null, 'light', () => false, { optimizeMaterials: true });
assert.equal(morphed.ownUnit('610620013').source, 'morph');
assert.equal(morphed.ownUnit('610620013').cost, 20);
assert.equal(morphed.ownUnit('610660025').cost, 20);
assert.equal(morphed.ownUnit('610660028').cost, 40);
assert.equal(morphed.ownUnit('610660028').odyleId, '610610014');
const bought = createCostModel(global, key => morphPrices[key] ?? null, 'light', () => false, { optimizeMaterials: false });
assert.equal(bought.ownUnit('610620013').cost, 100);
const ingotId = Object.keys(global.items).find(id => global.items[id].n === 'Orichalcum Ingot');
const ingotModel = createCostModel(global, key => ({ ...morphPrices, '630541001': 400, [ingotId]: 1000 })[key] ?? null, 'light', () => false, { optimizeMaterials: true });
assert.equal(ingotModel.ownUnit(ingotId).source, 'craft');
assert.equal(ingotModel.ownUnit(ingotId).cost, 440);
const expert = recipes.find(entry => entry.qr === 'light' && global.items[entry.out]?.n === "Expert's Truth Spellbook");
const artisan = recipes.find(entry => entry.qr === 'light' && global.items[entry.out]?.n === "Artisan's Truth Spellbook");
const gearLine = createCostModel(global, key => observedPrices[key] ?? 1, 'light');
assert.equal(gearLine.ownAttempt(truth).cost, gearLine.marketAttempt(truth).cost);
assert.equal(gearLine.ownUnit(truth.combo).cost, 4 * gearLine.marketAttempt(truth).cost);
assert.equal(gearLine.ownUnit(expert.combo).cost, 4 * gearLine.ownAttempt(expert).cost);
assert.equal(gearLine.ownUnit(artisan.combo).cost, 4 * gearLine.ownAttempt(artisan).cost);
console.log('Catena 25%, transfer e catalogo Global verificati.');
