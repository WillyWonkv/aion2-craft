const SOURCE = 'https://aion2.exchange/api/servers';

export async function onRequestGet({ request }) {
  try {
    const upstream = await fetch(SOURCE, { headers: { accept: 'application/json' } });
    if (!upstream.ok) throw new Error('Mercato non disponibile (' + upstream.status + ')');
    const data = await upstream.json();
    return Response.json(data, { headers: { 'Cache-Control': 'public, max-age=3600' } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 502 });
  }
}
