import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('./public/recipes-global.json', import.meta.url);
const graph = JSON.parse(await readFile(path, 'utf8'));
let added = 0;
for (const [id, recipe] of Object.entries(graph.recipes)) {
  if (recipe.type !== 'crafting' || !recipe.combo || !/^(True|Star) Dragon Lord /.test(graph.items[recipe.out]?.n || '')) continue;
  recipe.successChance = 0.6751;
  recipe.comboSuccessChance = 0.801;
  const safeId = id[0] + String(Number(id[1]) + 4) + id.slice(2, -3) + '002';
  if (graph.recipes[safeId]) { graph.recipes[safeId].riskyId = id; continue; }
  graph.recipes[safeId] = {
    p: recipe.p, qr: recipe.qr, ml: recipe.ml, in: recipe.in,
    out: recipe.out, outq: recipe.outq, type: 'crafting', safe: true,
    bound: true, successChance: 1, riskyId: id,
  };
  added++;
}
if (!graph.source.includes('guaranteed True/Star Dragon recipes')) graph.source += '; guaranteed True/Star Dragon recipes added from Global 2026-11-04 client';
const ordered = {};
for (const [id, recipe] of Object.entries(graph.recipes)) {
  if (recipe.safe) continue;
  ordered[id] = recipe;
  const safeId = id[0] + String(Number(id[1]) + 4) + id.slice(2, -3) + '002';
  if (graph.recipes[safeId]?.riskyId === id) ordered[safeId] = graph.recipes[safeId];
}
graph.recipes = ordered;
await writeFile(path, JSON.stringify(graph), 'utf8');
console.log(`Added ${added} guaranteed recipes`);
