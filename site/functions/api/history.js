export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const server = Number(url.searchParams.get('server'));
  const item = url.searchParams.get('item') || '';
  if (!Number.isInteger(server) || server < 10000 || server > 99999 || !/^\d+$/.test(item)) {
    return Response.json({ error: 'Server o oggetto non valido' }, { status: 400 });
  }
  if (!env.PRICE_HISTORY) {
    return Response.json({ error: 'Storico condiviso non configurato' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const result = await env.PRICE_HISTORY.prepare(
      'SELECT sampled_at, json_extract(prices_json, ?) AS price FROM price_snapshots WHERE server_id = ? ORDER BY sampled_at DESC LIMIT 1440'
    ).bind('$.' + JSON.stringify(item), server).all();
    const points = [];
    for (const row of (result.results || []).reverse()) {
      const price = Number(row.price);
      if (Number.isFinite(price)) points.push({ t: Date.parse(row.sampled_at), p: price });
    }
    return Response.json({ server, item, points }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (error) {
    return Response.json({ error: 'Lettura dello storico non riuscita: ' + error.message }, { status: 500 });
  }
}
