export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const server = Number(url.searchParams.get('server'));
  const item = url.searchParams.get('item') || '';
  const items = (url.searchParams.get('items') || '').split(',').filter(Boolean);
  const requestedItems = items.length ? items : [item];
  if (!Number.isInteger(server) || server < 10000 || server > 99999 || !requestedItems.length || requestedItems.length > 50 || requestedItems.some(key => !/^\d+$/.test(key))) {
    return Response.json({ error: 'Server o oggetto non valido' }, { status: 400 });
  }
  if (!env.PRICE_HISTORY) {
    return Response.json({ error: 'Storico condiviso non configurato' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const columns = requestedItems.map((key, index) => `json_extract(prices_json, '$."${key}"') AS i${index}`).join(', ');
    const result = await env.PRICE_HISTORY.prepare(
      `SELECT sampled_at, ${columns} FROM price_snapshots WHERE server_id = ? AND sampled_at >= datetime('now', '-24 hours') ORDER BY sampled_at DESC LIMIT 1440`
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
    if (items.length) return Response.json({ server, histories }, { headers: { 'Cache-Control': 'public, max-age=60' } });
    return Response.json({ server, item, points: histories[item] }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (error) {
    return Response.json({ error: 'Lettura dello storico non riuscita: ' + error.message }, { status: 500 });
  }
}
