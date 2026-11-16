// Carnet — serveur de notifications (Cloudflare Worker, offre gratuite)
// Stocke le planning envoyé par l'app et envoie chaque notification à la minute prévue (Web Push chiffré).
// Liaison KV attendue : CARNET (namespace KV). Déclencheur cron : "* * * * *".
// Aucune clé à saisir : la paire de clés VAPID est créée au premier lancement et gardée dans KV.
// L'app s'enregistre avec un jeton aléatoire ; le premier jeton reçu devient le seul accepté.

const SUB = 'https://anthonyfrappier66-oss.github.io/carnet/';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function getVapid(env) {
  let v = await env.CARNET.get('vapid', 'json');
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    v = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    await env.CARNET.put('vapid', JSON.stringify(v));
  }
  return v;
}

async function vapidHeader(env, endpoint) {
  const v = await getVapid(env);
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUB })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
}

// Chiffrement aes128gcm (RFC 8291)
async function encrypt(sub, payload) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

async function sendPush(env, sub, msg) {
  const body = await encrypt(sub, JSON.stringify(msg));
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high' },
    body
  });
  return r.status;
}

async function sendAll(env, msg) {
  const subs = (await env.CARNET.get('subs', 'json')) || [];
  const keep = [], res = [];
  for (const s of subs) {
    let st = 0;
    try { st = await sendPush(env, s, msg); } catch (e) { st = -1; }
    res.push(st);
    if (st !== 404 && st !== 410) keep.push(s); // abonnement expiré : on l'oublie
  }
  if (keep.length !== subs.length) await env.CARNET.put('subs', JSON.stringify(keep));
  return res;
}

async function checkToken(env, token) {
  if (typeof token !== 'string' || token.length < 20) return false;
  const saved = await env.CARNET.get('token');
  if (!saved) { await env.CARNET.put('token', token); return true; }
  return saved === token;
}

const clean = (s, n) => String(s || '').slice(0, n);

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      if (req.method === 'GET' && url.pathname === '/vapid') return json({ publicKey: (await getVapid(env)).pub });
      if (req.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'carnet-notifications' });
      if (req.method !== 'POST') return json({ error: 'not found' }, 404);
      const b = await req.json();
      if (!(await checkToken(env, b.token))) return json({ error: 'jeton refusé' }, 403);
      if (url.pathname === '/register') {
        const s = b.subscription;
        if (!s || !s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return json({ error: 'abonnement invalide' }, 400);
        const subs = ((await env.CARNET.get('subs', 'json')) || []).filter(x => x.endpoint !== s.endpoint);
        subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
        await env.CARNET.put('subs', JSON.stringify(subs.slice(-5)));
        return json({ ok: true, devices: subs.length });
      }
      if (url.pathname === '/schedule') {
        const now = Date.now();
        const items = (Array.isArray(b.items) ? b.items : []).filter(i => +i.t > now - 60000).slice(0, 1500)
          .map(i => ({ t: +i.t, title: clean(i.title, 80), body: clean(i.body, 400), url: clean(i.url, 60), tag: clean(i.tag, 40) }));
        await env.CARNET.put('sched', JSON.stringify(items));
        return json({ ok: true, count: items.length });
      }
      if (url.pathname === '/test') return json({ ok: true, results: await sendAll(env, { title: 'Carnet', body: 'Les notifications fonctionnent ✓', url: './', tag: 'test' }) });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
  // Chaque minute : envoie ce qui tombe dans la minute écoulée (pas d'état, donc pas de doublon).
  async scheduled(ev, env, ctx) {
    ctx.waitUntil((async () => {
      const end = ev.scheduledTime, start = end - 60000;
      const items = (await env.CARNET.get('sched', 'json')) || [];
      const due = items.filter(i => i.t > start && i.t <= end);
      for (const i of due) await sendAll(env, { title: i.title, body: i.body, url: i.url || './', tag: i.tag || '' });
    })());
  }
};
