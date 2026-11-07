const BASE = 'https://aion2.exchange/api/items';

async function page(server, offset) {
  const url = new URL(BASE);
  url.search = new URLSearchParams({ sort: 'name', order: 'asc', window: '24h', limit: '200', offset: String(offset), server: String(server) });
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Prezzi non disponibili (' + response.status + ')');
  return response.json();
}

export async function onRequestGet({ request }) {
  const server = new URL(request.url).searchParams.get('server');
  if (!/^\d{5}$/.test(server || '')) {
    return Response.json({ error: 'Server non valido' }, { status: 400 });
  }
  try {
    const first = await page(server, 0);
    const total = Number(first.total) || 0;
    if (!Array.isArray(first.items) || total > 10000) throw new Error('Risposta del mercato inattesa');
    const offsets = [];
    for (let offset = 200; offset < total; offset += 200) offsets.push(offset);
    const rest = await Promise.all(offsets.map(offset => page(server, offset)));
    const items = [first, ...rest].flatMap(result => result.items || []);
    return Response.json({ server: Number(server), items, retrieved_at: new Date().toISOString() }, { headers: { 'Cache-Control': 'public, max-age=900' } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
