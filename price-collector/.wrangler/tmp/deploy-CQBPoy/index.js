var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var API = "https://aion2.exchange/api/items";
var PAGE_SIZE = 200;
var MAX_ITEMS = 1e4;
async function initialize(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS price_snapshots (
    server_id INTEGER NOT NULL,
    sampled_at TEXT NOT NULL,
    prices_json TEXT NOT NULL,
    PRIMARY KEY (server_id, sampled_at)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_price_snapshots_server_time ON price_snapshots(server_id, sampled_at DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_price_snapshots_retention ON price_snapshots(sampled_at)").run();
}
__name(initialize, "initialize");
async function getPage(serverId, offset) {
  const url = new URL(API);
  url.search = new URLSearchParams({ sort: "name", order: "asc", window: "24h", limit: String(PAGE_SIZE), offset: String(offset), server: String(serverId) });
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Prezzi server ${serverId} non disponibili (${response.status})`);
  return response.json();
}
__name(getPage, "getPage");
async function collectServer(db, serverId, sampledAt) {
  const first = await getPage(serverId, 0);
  const total = Number(first.total) || 0;
  if (!Array.isArray(first.items) || total > MAX_ITEMS) throw new Error(`Risposta prezzi inattesa per il server ${serverId}`);
  const offsets = [];
  for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);
  const pages = await Promise.all(offsets.map((offset) => getPage(serverId, offset)));
  const priceMap = {};
  for (const item of [first, ...pages].flatMap((page) => page.items || [])) {
    const id = String(item.item_key ?? item.item_id ?? item.id ?? "");
    const price = Number(item.price);
    if (/^\d+$/.test(id) && Number.isFinite(price)) priceMap[id] = price;
  }
  await db.prepare("INSERT OR REPLACE INTO price_snapshots (server_id, sampled_at, prices_json) VALUES (?, ?, ?)").bind(Number(serverId), sampledAt, JSON.stringify(priceMap)).run();
  return Object.keys(priceMap).length;
}
__name(collectServer, "collectServer");
async function collect(env, scheduledTime) {
  await initialize(env.PRICE_HISTORY);
  const configured = String(env.SERVER_IDS || "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 1e4 && value <= 99999);
  if (!configured.length) throw new Error("SERVER_IDS deve contenere almeno un ID server a 5 cifre");
  const sampledAt = new Date(scheduledTime || Date.now()).toISOString();
  const results = [];
  for (const serverId of [...new Set(configured)]) {
    try {
      const count = await collectServer(env.PRICE_HISTORY, serverId, sampledAt);
      results.push({ serverId, count, ok: true });
    } catch (error) {
      console.error(`Raccolta fallita per ${serverId}: ${error.message}`);
      results.push({ serverId, ok: false, error: error.message });
    }
  }
  const retentionDays = Math.max(1, Math.min(90, Number(env.RETENTION_DAYS) || 30));
  const cutoff = new Date(Date.now() - retentionDays * 864e5).toISOString();
  await env.PRICE_HISTORY.prepare("DELETE FROM price_snapshots WHERE sampled_at < ?").bind(cutoff).run();
  console.log(JSON.stringify({ sampledAt, results }));
}
__name(collect, "collect");
var index_default = {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(collect(env, controller.scheduledTime));
  },
  async fetch(request) {
    return new Response("Aion2 price collector is active. Historical prices are served by the Pages API.", {
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
