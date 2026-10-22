// Prima la rete, poi l'ultima copia salvata: senza connessione l'app mostra l'ultimo turno visto.
const CACHE = "fischietto-v8";
const DATA_CACHE = "fischietto-dati-v1"; // ultima copia valida di partite, storico e classifica
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== DATA_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Copia salvata dei dati, marcata come offline così la pagina può avvisare l'utente.
function offlineCopy(req) {
  return caches.open(DATA_CACHE).then((c) => c.match(req)).then((hit) => {
    if (!hit) return Response.error();
    const headers = new Headers(hit.headers);
    headers.set("X-Fischietto-Offline", "1");
    return hit.blob().then((body) => new Response(body, { status: 200, headers }));
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  const url = new URL(req.url);
  // Le navigazioni HTML, incluse le URL ?league=BL1, devono caricare la versione online.
  if (req.mode === "navigate" || req.destination === "document") {
    e.respondWith(
      fetch(new Request(req, { cache: "no-store" }))
        .catch(() => caches.match("./").then((hit) => hit || Response.error()))
    );
    return;
  }
  // I dati di partite, storico e classifica arrivano sempre dalla rete; l'ultima risposta
  // valida viene conservata e usata solo quando la rete non risponde.
  if (url.pathname.endsWith(".json") || /\/api\/(turno|storico|classifica)$/.test(url.pathname)) {
    e.respondWith(
      fetch(new Request(req, { cache: "no-store" }))
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(DATA_CACHE).then((c) => c.put(req, copy)));
          }
          return res;
        })
        .catch(() => offlineCopy(req))
    );
    return;
  }
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./")))
  );
});
