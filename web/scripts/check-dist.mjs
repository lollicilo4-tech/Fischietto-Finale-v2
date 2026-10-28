#!/usr/bin/env node
/* Controlli sul sito generato (dist/), da eseguire dopo "npm run build":
   - ci sono le pagine principali di ogni campionato e i JSON agli indirizzi di oggi;
   - nessuno script inline e nessun attributo on...= (la CSP li bloccherebbe);
   - ogni link interno porta a una pagina che esiste; ogni pagina ha il link per le donazioni (Ko-fi);
   - la CSP in _headers non permette script inline o esterni;
   - ogni indirizzo della sitemap esiste;
   - ogni redirect di _redirects porta a una pagina che esiste, per ogni campionato;
   - nessun "undefined", "NaN" o "[object Object]" nel testo delle pagine;
   - ogni pagina ha la lingua giusta (/en/ in inglese) e il link hreflang all'altra versione;
   - ogni stemma nelle pagine (/stemmi/…) esiste ed è un PNG;
   - l'anteprima del link (og:image) di ogni pagina esiste; quelle delle partite sono PNG 1200×630;
   - i dati strutturati (JSON-LD) sono JSON valido con @context schema.org; ogni partita ha il suo SportsEvent. */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES, SECTIONS, KOFI_URL } from "../src/lib/core.js";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const problems = [];
const fail = (msg) => problems.push(msg);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}
const pageFor = (urlPath) => {
  const clean = decodeURIComponent(urlPath.split("#")[0].split("?")[0]);
  const file = path.join(dist, clean.endsWith("/") ? clean + "index.html" : clean);
  return existsSync(file) ? file : null;
};

if (!existsSync(dist)) { console.error("Manca dist/: esegui prima npm run build"); process.exit(1); }

/* Pagine e file che devono esserci. */
/* Pagine solo in italiano: niente versione inglese, quindi niente hreflang. */
const IT_ONLY = ["/fantacalcio/index.html", "/social/index.html"];
const expected = ["/", "/live/", "/come-funziona/", "/privacy/", "/i-miei-pronostici/", "/fantacalcio/", "/risultati-recenti.json", "/404.html", "/sitemap.xml", "/robots.txt", "/sw.js", "/manifest.webmanifest", "/_headers", "/_redirects", "/ads.txt", "/live-calendar.json", "/turno.json"];
LEAGUES.forEach((l) => Object.values(SECTIONS).forEach((s) => expected.push("/" + l.slug + "/" + s.path, "/en/" + l.slug + "/" + s.en)));
/* Versione inglese (/en/): stesse pagine con indirizzi inglesi. */
expected.push("/en/", "/en/live/", "/en/how-it-works/", "/en/privacy/", "/en/my-predictions/", "/oggi/", "/en/today/", "/social/", "/settimana/", "/en/week/");
expected.forEach((u) => { if (!pageFor(u)) fail("manca " + u); });

/* Immagini dei consigli fantacalcio: PNG veri, della misura giusta (non l'icona di riserva usata se il disegno fallisce). */
[["/fantacalcio/consigli.png", 1080, 1350], ["/fantacalcio/anteprima.png", 1200, 630], ["/settimana/riepilogo.png", 1080, 1920], ["/settimana/anteprima.png", 1200, 630], ["/en/week/preview.png", 1200, 630]].forEach(([u, w, h]) => {
  const file = pageFor(u);
  if (!file) return fail("manca " + u);
  const b = readFileSync(file);
  const isPng = b.length > 24 && b.readUInt32BE(0) === 0x89504e47;
  if (!isPng || b.readUInt32BE(16) !== w || b.readUInt32BE(20) !== h) fail(u + ": non è un PNG " + w + "×" + h + " (disegno non riuscito?)");
});

/* Immagini per i social (/social/*.png): PNG 1080×1920, almeno quella delle partite principali. */
const socialDir = path.join(dist, "social");
const socialPngs = existsSync(socialDir) ? readdirSync(socialDir).filter((f) => f.endsWith(".png")) : [];
const socialPage = pageFor("/social/") ? readFileSync(pageFor("/social/"), "utf-8") : "";
if (socialPage.includes("/social/oggi.png") && !socialPngs.includes("oggi.png")) fail("manca /social/oggi.png");
socialPngs.forEach((f) => {
  const b = readFileSync(path.join(socialDir, f));
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(16) !== 1080 || b.readUInt32BE(20) !== 1920) fail("/social/" + f + ": non è un PNG 1080×1920 (disegno non riuscito?)");
});

/* HTML: script, gestori inline, link interni, testo. */
const files = walk(dist);
const html = files.filter((f) => f.endsWith(".html"));
let links = 0, ldCount = 0, crestImgs = 0, ogChecked = 0;
for (const file of html) {
  const rel = "/" + path.relative(dist, file);
  const src = readFileSync(file, "utf-8");
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1], body = m[2];
    if (/type="application\/json"/.test(attrs)) { try { JSON.parse(body); } catch (e) { fail(rel + ": JSON incorporato non valido"); } continue; }
    if (/type="application\/ld\+json"/.test(attrs)) {
      try { const ld = JSON.parse(body); if (ld["@context"] !== "https://schema.org" || !ld["@type"]) fail(rel + ": dati strutturati senza @context o @type"); ldCount++; }
      catch (e) { fail(rel + ": dati strutturati (JSON-LD) non validi"); }
      continue;
    }
    if (!/\bsrc="\/_astro\//.test(attrs) || body.trim()) fail(rel + ": script inline o esterno: " + attrs.trim().slice(0, 80));
  }
  if (/<[^>]+\son[a-z]+\s*=/i.test(src)) fail(rel + ": attributo on...= (vietato dalla CSP)");
  if (/\/(partita|match)\//.test(rel) && !src.includes('"@type":"SportsEvent"')) fail(rel + ": manca il dato strutturato SportsEvent");
  const og = (src.match(/<meta property="og:image" content="https:\/\/fischiettofinale\.com(\/[^"]*)"/) || [])[1];
  if (!og || !pageFor(og)) fail(rel + ": anteprima del link (og:image) mancante " + (og || ""));
  else if (/\/(partita|match)\//.test(rel)) {
    ogChecked++;
    const b = readFileSync(pageFor(og));
    if (!og.startsWith("/anteprime/") || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(16) !== 1200 || b.readUInt32BE(20) !== 630) fail(rel + ": anteprima della partita non è un PNG 1200×630 (" + og + ")");
  }
  if (/javascript:/i.test(src)) fail(rel + ": link javascript:");
  if (/fonts\.(googleapis|gstatic)\.com/.test(src)) fail(rel + ": carica caratteri da Google Fonts");
  const text = src.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const bad of ["undefined", "NaN", "[object Object]"]) if (text.includes(bad)) fail(rel + ": contiene " + bad);
  for (const m of src.matchAll(/<img\b[^>]*\ssrc="(\/stemmi\/[^"]*)"/g)) {
    crestImgs++;
    if (!pageFor(m[1])) fail(rel + ": stemma mancante " + m[1]);
  }
  for (const m of src.matchAll(/\shref="(\/[^"]*)"/g)) {
    links++;
    if (!pageFor(m[1])) fail(rel + ": link rotto " + m[1]);
  }
  if (!/<link rel="canonical" href="https:\/\/fischiettofinale\.com\//.test(src)) fail(rel + ": manca il link canonico");
  const en = rel.startsWith("/en/");
  if (!src.includes(en ? 'href="/en/privacy/"' : 'href="/privacy/"')) fail(rel + ": manca il link a Privacy e cookie");
  if (rel !== "/404.html" && !src.includes('<html lang="' + (en ? "en" : "it") + '"')) fail(rel + ": lingua della pagina sbagliata");
  if (rel !== "/404.html" && !IT_ONLY.includes(rel) && !/<link rel="alternate" hreflang="en" href="https:\/\/fischiettofinale\.com\//.test(src)) fail(rel + ": manca il link hreflang alla versione inglese");
  if (!src.includes('href="' + KOFI_URL + '" target="_blank" rel="noopener noreferrer"')) fail(rel + ": manca il link Ko-fi");
}

/* Calendari .ics: uno per squadra e per lingua, formato iCalendar con fine riga CRLF. */
const icsFiles = files.filter((f) => f.endsWith(".ics"));
if (icsFiles.length < 100) fail("calendari .ics: solo " + icsFiles.length + " file");
icsFiles.forEach((f) => {
  const s = readFileSync(f, "utf-8"), rel = path.relative(dist, f);
  if (!s.startsWith("BEGIN:VCALENDAR\r\n") || !s.endsWith("END:VCALENDAR\r\n")) fail(rel + ": calendario non valido");
  if (/[^\r]\n/.test(s)) fail(rel + ": righe senza CRLF");
  if ((s.match(/BEGIN:VEVENT/g) || []).length !== (s.match(/END:VEVENT/g) || []).length) fail(rel + ": eventi non chiusi");
  for (const bad of ["undefined", "NaN", "[object Object]"]) if (s.includes(bad)) fail(rel + ": contiene " + bad);
});

/* Stemmi: solo PNG veri (al build ogni stemma passa da resvg, mai l'SVG originale). */
files.filter((f) => f.includes(path.sep + "stemmi" + path.sep)).forEach((f) => {
  const b = readFileSync(f);
  if (!f.endsWith(".png") || b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") fail(path.relative(dist, f) + ": lo stemma non è un PNG");
});

/* Content Security Policy. */
const headers = readFileSync(path.join(dist, "_headers"), "utf-8");
const csp = (headers.match(/Content-Security-Policy: (.*)/) || [])[1] || "";
const scriptSrc = (csp.match(/script-src ([^;]*)/) || [])[1] || "";
if (scriptSrc.trim() !== "'self'") fail("_headers: script-src deve essere solo 'self' (ora: " + scriptSrc + ")");
["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'none'"].forEach((d) => { if (!csp.includes(d)) fail("_headers: manca " + d); });
if (/fonts\.(googleapis|gstatic)\.com/.test(headers)) fail("_headers: Google Fonts non serve più (i caratteri sono serviti dal sito)");
if (!/^\s+Strict-Transport-Security: max-age=\d{7,}/m.test(headers)) fail("_headers: manca Strict-Transport-Security (almeno 4 mesi)");
headers.split("\n").forEach((line, i) => { if (line.length > 2000) fail("_headers: riga " + (i + 1) + " oltre i 2000 caratteri di Cloudflare"); });

/* Sitemap. */
const sitemap = readFileSync(path.join(dist, "sitemap.xml"), "utf-8");
const locs = [...sitemap.matchAll(/<loc>https:\/\/fischiettofinale\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
locs.forEach((u) => { if (!pageFor(u)) fail("sitemap: " + u + " non esiste"); });

/* Redirect: la destinazione esiste per ogni campionato, la vecchia pagina non c'è più. */
const redirects = readFileSync(path.join(dist, "_redirects"), "utf-8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
redirects.forEach((line) => {
  const [from, to, code] = line.split(/\s+/);
  if (code !== "301") fail("_redirects: " + from + " deve essere un 301");
  LEAGUES.forEach((l) => {
    const src = from.replace(":lega", l.slug), dst = to.replace(":lega", l.slug);
    if (!pageFor(dst)) fail("_redirects: " + src + " porta a " + dst + ", che non esiste");
    if (src.endsWith("/") && pageFor(src)) fail("_redirects: " + src + " esiste ancora come pagina");
  });
});

/* ads.txt: solo righe "dominio, pub-…, DIRECT|RESELLER[, id]" o commenti. */
readFileSync(path.join(dist, "ads.txt"), "utf-8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).forEach((l) => {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}, pub-\d{16}, (DIRECT|RESELLER)(, [0-9a-f]+)?$/.test(l)) fail("ads.txt: riga non valida: " + l);
});

/* Calendario per il Worker del momentum: partite con campionato, nomi e orario validi. */
const calendar = JSON.parse(readFileSync(path.join(dist, "live-calendar.json"), "utf-8"));
const liveKeys = new Set(LEAGUES.map((l) => l.liveKey));
if (!Array.isArray(calendar.matches)) fail("live-calendar.json: manca l'elenco delle partite");
else calendar.matches.forEach((m) => {
  if (!liveKeys.has(m.liveKey) || !m.home || !m.away || !m.id || !Number.isFinite(Date.parse(m.kickoff))) fail("live-calendar.json: partita non valida " + JSON.stringify(m));
});

/* JSON ripubblicati. */
files.filter((f) => f.endsWith(".json")).forEach((f) => { try { JSON.parse(readFileSync(f, "utf-8")); } catch (e) { fail(path.relative(dist, f) + ": JSON non valido"); } });

/* Limite di Cloudflare Pages (piano gratuito): 20.000 file. */
if (files.length > 15000) fail("dist/ ha " + files.length + " file: vicino al limite di 20.000 di Cloudflare Pages");

if (ogChecked < 20) fail("anteprime delle partite controllate: solo " + ogChecked);

if (problems.length) {
  console.error(problems.length + " problemi nel sito generato:\n- " + problems.slice(0, 50).join("\n- "));
  process.exit(1);
}
console.log("dist/ ok: " + html.length + " pagine, " + files.length + " file, " + links + " link interni verificati, " + locs.length + " indirizzi in sitemap, " + ldCount + " blocchi di dati strutturati, " + crestImgs + " stemmi nelle pagine, " + ogChecked + " anteprime delle partite.");
