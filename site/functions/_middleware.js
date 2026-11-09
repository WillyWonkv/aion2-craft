const COOKIE = '__Host-aion_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 24 * 60 * 60;
const LOCK_SECONDS = 15 * 60;
const encoder = new TextEncoder();

function redirect(location, cookie) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function unavailable() {
  return new Response('Accesso temporaneamente non disponibile.', {
    status: 503, headers: { 'Cache-Control': 'no-store' },
  });
}

async function sign(key, message) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sessionCookie(key, password, now) {
  const expires = now + SESSION_SECONDS;
  const signature = hex(await sign(key, JSON.stringify(['session', password, expires])));
  return `${COOKIE}=${expires}.${signature}; Max-Age=${SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

async function sessionExpiration(request, key, password, now) {
  const value = request.headers.get('Cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  const match = /^(\d{10})\.([0-9a-f]{64})$/.exec(value || '');
  if (!match) return 0;
  const expires = Number(match[1]);
  if (expires <= now || expires > now + SESSION_SECONDS) return 0;
  const bytes = Uint8Array.from(match[2].match(/../g), pair => parseInt(pair, 16));
  const valid = await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(JSON.stringify(['session', password, expires])));
  return valid ? expires : 0;
}

async function login(request, env, key, now) {
  if (request.method !== 'POST') return redirect('/login');
  if (!env.PRICE_HISTORY) return unavailable();
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) {
    return new Response('Formato non valido.', { status: 415 });
  }
  const db = env.PRICE_HISTORY;
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const client = hex(await sign(key, JSON.stringify(['ip', address])));
  await db.prepare(`CREATE TABLE IF NOT EXISTS site_login_attempts (
    client TEXT PRIMARY KEY, failures INTEGER NOT NULL, blocked_until INTEGER NOT NULL
  )`).run();
  const state = await db.prepare('SELECT blocked_until FROM site_login_attempts WHERE client = ?').bind(client).first();
  if (state?.blocked_until > now) return redirect('/login?blocked=1');

  const body = await request.text();
  if (body.length > 4096) return new Response('Richiesta troppo grande.', { status: 413 });
  const password = new URLSearchParams(body).get('password') || '';
  const expected = await sign(key, JSON.stringify(['password', env.SITE_PASSWORD]));
  const valid = await crypto.subtle.verify('HMAC', key, expected, encoder.encode(JSON.stringify(['password', password])));
  if (valid) {
    await db.prepare('DELETE FROM site_login_attempts WHERE client = ? AND blocked_until <= ?').bind(client, now).run();
    const remaining = await db.prepare('SELECT blocked_until FROM site_login_attempts WHERE client = ?').bind(client).first();
    if (remaining?.blocked_until > now) return redirect('/login?blocked=1');
    return redirect('/', await sessionCookie(key, env.SITE_PASSWORD, now));
  }

  // The update and lock are atomic, including when several attempts arrive together.
  const attempt = await db.prepare(`INSERT INTO site_login_attempts (client, failures, blocked_until)
    VALUES (?1, 1, 0)
    ON CONFLICT(client) DO UPDATE SET
      failures = CASE WHEN blocked_until > 0 THEN 1 ELSE failures + 1 END,
      blocked_until = CASE WHEN blocked_until = 0 AND failures >= 2 THEN ?2 + ?3 ELSE 0 END
    WHERE blocked_until <= ?2
    RETURNING blocked_until`).bind(client, now, LOCK_SECONDS).first();
  return redirect(!attempt || attempt.blocked_until > now ? '/login?blocked=1' : '/login?error=1');
}

export async function onRequest({ request, env, next }) {
  const path = new URL(request.url).pathname;
  if (!env.SITE_PASSWORD || !env.SITE_SESSION_SECRET || env.SITE_SESSION_SECRET.length < 32) return unavailable();
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(env.SITE_SESSION_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const now = Math.floor(Date.now() / 1000);
    if (path === '/auth/login') return await login(request, env, key, now);
    const expires = await sessionExpiration(request, key, env.SITE_PASSWORD, now);
    if (!expires) {
      if (path.startsWith('/api/')) {
        return Response.json({ error: 'Accesso richiesto' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      }
      return redirect('/login');
    }
    const upstream = await next();
    const response = new Response(upstream.body, upstream);
    response.headers.set('Cache-Control', 'private, no-store');
    if (expires <= now + SESSION_SECONDS - RENEW_AFTER_SECONDS) {
      response.headers.append('Set-Cookie', await sessionCookie(key, env.SITE_PASSWORD, now));
    }
    return response;
  } catch {
    return unavailable();
  }
}
