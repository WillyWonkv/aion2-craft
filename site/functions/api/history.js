const SAMPLE_SECONDS = 5 * 60;
const SAMPLE_COUNT = 7 * 24 * 60 * 60 / SAMPLE_SECONDS;

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const server = Number(url.searchParams.get('server'));
  const item = url.searchParams.get('item') || '';
  const items = (url.searchParams.get('items') || '').split(',').filter(Boolean);
  const requestedItems = [...new Set(items.length ? items : [item])].sort();
  if (!Number.isInteger(server) || server < 10000 || server > 99999 || !requestedItems.length || requestedItems.length > 50 || requestedItems.some(key => !/^\d+$/.test(key))) {
    return Response.json({ error: 'Server o oggetto non valido' }, { status: 400 });
  }
  if (!env.PRICE_HISTORY) {
    return Response.json({ error: 'Storico condiviso non configurato' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    // This cache is reached only after the Pages middleware validates the session.
    const cacheUrl = new URL('/__history_cache_v2', url.origin);
    cacheUrl.search = new URLSearchParams({ server: String(server), [items.length ? 'items' : 'item']: requestedItems.join(',') });
    const cacheKey = new Request(cacheUrl);
    const cache = await globalThis.caches?.open('aion-history-v2').catch(() => undefined);
    const cached = await cache?.match(cacheKey).catch(() => undefined);
    if (cached) return cached;
    const columns = requestedItems.map((key, index) => `json_extract(prices_json, '$."${key}"') AS i${index}`).join(', ');
    const result = await env.PRICE_HISTORY.prepare(
      `WITH RECURSIVE buckets(end_at, bucket) AS (
        SELECT unixepoch('now') + 1, 1
        UNION ALL
        SELECT end_at - ${SAMPLE_SECONDS}, bucket + 1 FROM buckets WHERE bucket < ${SAMPLE_COUNT}
      ), sample_times AS MATERIALIZED (
        SELECT (
          SELECT sampled_at FROM price_snapshots
          WHERE server_id = ?1
            AND sampled_at >= strftime('%Y-%m-%dT%H:%M:%fZ', end_at - ${SAMPLE_SECONDS}, 'unixepoch')
            AND sampled_at < strftime('%Y-%m-%dT%H:%M:%fZ', end_at, 'unixepoch')
          ORDER BY sampled_at DESC LIMIT 1
        ) AS sampled_at
        FROM buckets
      )
      SELECT snapshot.sampled_at, ${columns}
      FROM sample_times AS sample
      CROSS JOIN price_snapshots AS snapshot
      WHERE snapshot.server_id = ?1 AND snapshot.sampled_at = sample.sampled_at
      ORDER BY snapshot.sampled_at DESC`
    ).bind(server).all();
    const histories = Object.fromEntries(requestedItems.map((key, index) => [key, []]));
    for (const row of (result.results || []).reverse()) {
      const timestamp = Date.parse(row.sampled_at);
      if (!Number.isFinite(timestamp)) continue;
      requestedItems.forEach((key, index) => {
        const price = Number(row['i' + index]);
        if (Number.isFinite(price) && price > 0) histories[key].push({ t: timestamp, p: price });
      });
    }
    const response = Response.json(items.length ? { server, histories } : { server, item, points: histories[item] }, {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    });
    if (cache) waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}));
    return response;
  } catch (error) {
    return Response.json({ error: 'Lettura dello storico non riuscita: ' + error.message }, { status: 500 });
  }
}
