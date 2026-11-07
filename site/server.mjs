import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { onRequestGet as servers } from './functions/api/servers.js';
import { onRequestGet as prices } from './functions/api/prices.js';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4173;
const routes = new Map([
  ['/api/servers', servers],
  ['/api/prices', prices],
]);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/cost-model.js', ['cost-model.js', 'text/javascript; charset=utf-8']],
]);
const cache = new Map();
const ttl = { '/api/servers': 60 * 60 * 1000, '/api/graph': 24 * 60 * 60 * 1000, '/api/prices': 15 * 60 * 1000 };

async function respond(request, response) {
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' });
    response.end('Metodo non consentito');
    return;
  }
  const url = new URL(request.url, 'http://localhost:' + port);
  if (url.pathname === '/api/graph') {
    const body = await readFile(join(root, 'public', 'recipes-global.json'));
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(body);
    return;
  }
  const handler = routes.get(url.pathname);
  if (handler) {
    const key = url.pathname + url.search;
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'HIT' });
      response.end(saved.body);
      return;
    }
    const result = await handler({ request: new Request(url) });
    const body = await result.text();
    if (result.ok) cache.set(key, { body, expires: Date.now() + ttl[url.pathname] });
    response.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Cache': 'MISS' });
    response.end(body);
    return;
  }
  const asset = assets.get(url.pathname);
  if (!asset) {
    response.writeHead(404);
    response.end('Pagina non trovata');
    return;
  }
  const body = await readFile(join(root, 'public', asset[0]));
  response.writeHead(200, { 'Content-Type': asset[1] });
  response.end(body);
}

createServer((request, response) => {
  respond(request, response).catch(error => {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: error.message }));
  });
}).listen(port, '127.0.0.1', () => {
  console.log('Aion 2 Craft: http://localhost:' + port);
});
