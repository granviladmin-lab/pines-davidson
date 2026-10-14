// Decrypts files under site/ on the fly. Plain files never leave the build machine.
const BASE = new URL('./', self.location).pathname;
const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css', js: 'text/javascript',
  json: 'application/json', xml: 'application/xml', txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', pdf: 'application/pdf',
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

let cached = null;
const idbGet = k => new Promise((res, rej) => {
  const r = indexedDB.open('gate', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('k');
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const q = r.result.transaction('k').objectStore('k').get(k);
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  };
});
async function secrets() {
  if (cached) return cached;
  const key = await idbGet('key'), pathSalt = await idbGet('pathSalt');
  if (!key || !pathSalt) return null;
  return (cached = { key, pathSalt });
}
self.addEventListener('message', e => { if (e.data === 'lock') cached = null; });

async function nameFor(path, pathSalt) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pathSalt + path));
  return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function load(path, s) {
  const r = await fetch(BASE + 'enc/' + (await nameFor(path, s.pathSalt)) + '.bin');
  if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, s.key, buf.slice(12));
}

function candidates(rel, search) {
  let p = rel;
  try { p = decodeURIComponent(rel); } catch {}
  if (p === '' || p.endsWith('/')) return [p + 'index.html'];
  const list = [];
  if (search) { let q = search; try { q = decodeURIComponent(search); } catch {} list.push(p + q); }
  list.push(p);
  if (!/\.[a-z0-9]{1,5}$/i.test(p)) list.push(p + '/index.html', p + '.html');
  return list;
}

async function handle(req, url) {
  const rel = url.pathname.slice(BASE.length + 'site/'.length);
  const s = await secrets();
  if (!s) return Response.redirect(BASE + '?next=' + encodeURIComponent('site/' + rel), 302);
  for (const path of candidates(rel, url.search)) {
    const body = await load(path, s);
    if (!body) continue;
    if (path.endsWith('/index.html') && !rel.endsWith('/') && !path.endsWith(rel)) {
      return Response.redirect(url.pathname + '/', 301);
    }
    const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    return new Response(body, { headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream' } });
  }
  return new Response('<!doctype html><title>Not found</title><p style="font-family:system-ui;padding:2rem">This page wasn’t part of the saved copy. <a href="' + BASE + 'site/">Back to the start</a></p>', { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE + 'site/') || e.request.method !== 'GET') return;
  e.respondWith(handle(e.request, url));
});
