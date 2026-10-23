// Service worker del sito Astro. Prima la rete, poi l'ultima copia salvata:
// senza connessione si vedono le pagine già aperte (partite, classifica...) con i dati di allora.
// Sostituisce quello del sito su GitHub Pages (stesso indirizzo /sw.js): le vecchie cache vengono eliminate.
const VERSION = "fischietto-astro-v1";
const PAGES = VERSION + "-pagine";   // HTML delle pagine visitate
const ASSETS = VERSION + "-asset";   // CSS/JS con nome versionato (/_astro/...), icone, manifest
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png"];
const MAX_PAGES = 60;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGES).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName), keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // SportScore e Google Fonts: sempre dalla rete

  // Pagine: sempre la versione online; la copia salvata solo se la rete non risponde.
  if (req.mode === "navigate" || req.destination === "document") {
    e.respondWith(
      fetch(new Request(req, { cache: "no-store" }))
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(PAGES).then((c) => c.put(url.pathname, copy)).then(() => trim(PAGES, MAX_PAGES)));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match("/")).then((hit) => hit || Response.error()))
    );
    return;
  }

  // File con nome versionato: non cambiano mai, quindi prima la cache.
  if (url.pathname.startsWith("/_astro/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(ASSETS).then((c) => c.put(req, copy))); }
      return res;
    })));
    return;
  }

  // Tutto il resto (JSON pubblicati, icone, manifest): rete, poi copia salvata.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(ASSETS).then((c) => c.put(req, copy))); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
