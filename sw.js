// ServisKotlov PRO – service worker
// Vďaka nemu sa aplikácia otvorí aj bez internetu (kotolňa, pivnica) a knižnice z internetu sa držia v zariadení.
// Dáta zákazníkov sa tu neukladajú — tie sú v úložisku aplikácie.
// Pri zmene tohto súboru zvýš číslo verzie.
const VERSION = 'sk-v1';
const SHELL = VERSION + '-shell';
const LIBS = 'sk-libs-v1';

// súbory aplikácie (relatívne k umiestneniu tohto súboru)
const CORE = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
// knižnice a písma, ktoré aplikácia načítava z internetu
const LIB_URLS = [
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@400;600;800&display=swap',
];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NAV_TIMEOUT = 4000; // pri slabom signáli sa po 4 s ukáže uložená verzia

const scope = () => self.registration.scope;
const corsGet = (url) => fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })));
    // knižnice: čo sa nepodarí stiahnuť teraz, uloží sa pri prvom použití
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_URLS.map(async (u) => {
      try {
        if (await libs.match(u)) return;
        const r = await corsGet(u);
        if (r.ok) await libs.put(u, r);
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('sk-v') && k !== SHELL) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

// Aplikácia: najprv sieť (vždy najnovšia verzia), bez siete alebo pri pomalej sieti uložená kópia.
async function appShell(event) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(scope());
  const net = fetch(event.request).then((r) => {
    if (r.ok && !r.redirected) { cache.put(scope(), r.clone()); return r; }
    return cached || r;
  });
  if (!cached) return net;
  event.waitUntil(net.catch(() => {}));
  return Promise.race([
    net.catch(() => cached),
    new Promise((res) => setTimeout(() => res(cached), NAV_TIMEOUT)),
  ]);
}

// Ikony a manifest: hneď z pamäte, na pozadí sa obnovia.
async function staleWhileRevalidate(event) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(event.request);
  const net = fetch(event.request).then((r) => { if (r.ok) cache.put(event.request, r.clone()); return r; });
  if (!cached) return net;
  event.waitUntil(net.catch(() => {}));
  return cached;
}

// Knižnice a písma majú verziu v adrese — stačí ich stiahnuť raz.
async function libFirst(event) {
  const cache = await caches.open(LIBS);
  const cached = await cache.match(event.request.url);
  if (cached) return cached;
  const r = await corsGet(event.request.url);
  if (r.ok) cache.put(event.request.url, r.clone());
  return r;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const base = new URL(scope()).pathname;
    if (req.mode === 'navigate' && (url.pathname === base || url.pathname === base + 'index.html')) {
      event.respondWith(appShell(event));
    } else if (CORE.slice(1).some((f) => url.pathname === base + f)) {
      event.respondWith(staleWhileRevalidate(event));
    }
    return; // ostatné stránky (admin, kontakt) idú priamo zo siete
  }
  if (LIB_HOSTS.includes(url.hostname)) event.respondWith(libFirst(event));
  // licenčný server, mapové podklady, Google Drive a vyhľadávanie adries: vždy priamo zo siete
});
