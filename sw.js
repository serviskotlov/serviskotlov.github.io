// ServisKotlov PRO – service worker
// Vďaka nemu sa aplikácia otvorí aj bez internetu (kotolňa, pivnica) a knižnice z internetu sa držia v zariadení.
// Dáta zákazníkov sa tu neukladajú — tie sú v úložisku aplikácie.
// Pri zmene tohto súboru zvýš číslo verzie.
const VERSION = 'sk-v12';
const SHELL = VERSION + '-shell';
const LIBS = 'sk-libs-v1';
const LOCAL = 'sk-local-v1'; // knižnica a písma na PDF z priečinka lib/ (veľké, menia sa zriedka)

// súbory aplikácie (relatívne k umiestneniu tohto súboru)
const CORE = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'favicon.ico', 'apple-touch-icon.png'];
// knižnice a písma, ktoré aplikácia načítava z internetu
const LIB_URLS = [
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@400;600;800&display=swap',
];
// rovnaké knižnice vo vlastnom priečinku lib/ (ak ich tam nahráš, majú prednosť)
const LOCAL_OF = {
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js': 'lib/zxing.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js': 'lib/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css': 'lib/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js': 'lib/leaflet.min.js',
};
const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const NAV_TIMEOUT = 4000; // pri slabom signáli sa po 4 s ukáže uložená verzia

const scope = () => self.registration.scope;
const corsGet = (url) => fetch(new Request(url, { mode: 'cors', credentials: 'omit' }));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })));
    // knižnice: ak sú v priečinku lib/ vedľa aplikácie, cudzí server sa nevolá vôbec.
    // Čo sa nepodarí stiahnuť teraz, uloží sa pri prvom použití.
    const libs = await caches.open(LIBS);
    const local = await caches.open(LOCAL);
    await Promise.all(LIB_URLS.map(async (u) => {
      try {
        const own = LOCAL_OF[u];
        if (own) {
          const key = new URL(own, self.registration.scope).href;
          if (await local.match(key)) return;
          const r0 = await Promise.race([fetch(key, { cache: 'reload' }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))]).catch(() => null);
          if (r0 && r0.ok) { await local.put(key, r0); return; }
        }
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

// lib/ (jsPDF, písma): z pamäte, ak sú; inak zo siete a uložia sa. Nová verzia súboru = nový názov alebo nové LOCAL.
async function localLib(event) {
  const cache = await caches.open(LOCAL);
  const key = event.request.url.split('?')[0];
  const cached = await cache.match(key);
  if (cached) return cached;
  const r = await fetch(event.request);
  if (r.ok) cache.put(key, r.clone());
  return r;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const base = new URL(scope()).pathname;
    if (url.pathname.startsWith(base + 'lib/')) {
      event.respondWith(localLib(event));
    } else if (req.mode === 'navigate' && (url.pathname === base || url.pathname === base + 'index.html')) {
      event.respondWith(appShell(event));
    } else if (CORE.slice(1).some((f) => url.pathname === base + f)) {
      event.respondWith(staleWhileRevalidate(event));
    }
    return; // ostatné stránky (admin, kontakt) idú priamo zo siete
  }
  if (LIB_HOSTS.includes(url.hostname)) event.respondWith(libFirst(event));
  // licenčný server, mapové podklady, Google Drive a vyhľadávanie adries: vždy priamo zo siete
});
