#!/usr/bin/env node
/* Controlli sul sito generato (dist/), da eseguire dopo "npm run build":
   - ci sono le pagine principali di ogni campionato e i JSON agli indirizzi di oggi;
   - nessuno script inline e nessun attributo on...= (la CSP li bloccherebbe);
   - ogni link interno porta a una pagina che esiste;
   - la CSP in _headers non permette script inline o esterni;
   - ogni indirizzo della sitemap esiste;
   - nessun "undefined", "NaN" o "[object Object]" nel testo delle pagine. */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEAGUES, SECTIONS } from "../src/lib/core.js";

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
const expected = ["/", "/live/", "/come-funziona/", "/404.html", "/sitemap.xml", "/robots.txt", "/sw.js", "/manifest.webmanifest", "/_headers", "/turno.json"];
LEAGUES.forEach((l) => Object.values(SECTIONS).forEach((s) => expected.push("/" + l.slug + "/" + s.path)));
expected.forEach((u) => { if (!pageFor(u)) fail("manca " + u); });

/* HTML: script, gestori inline, link interni, testo. */
const files = walk(dist);
const html = files.filter((f) => f.endsWith(".html"));
let links = 0;
for (const file of html) {
  const rel = "/" + path.relative(dist, file);
  const src = readFileSync(file, "utf-8");
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1], body = m[2];
    if (/type="application\/json"/.test(attrs)) { try { JSON.parse(body); } catch (e) { fail(rel + ": JSON incorporato non valido"); } continue; }
    if (!/\bsrc="\/_astro\//.test(attrs) || body.trim()) fail(rel + ": script inline o esterno: " + attrs.trim().slice(0, 80));
  }
  if (/<[^>]+\son[a-z]+\s*=/i.test(src)) fail(rel + ": attributo on...= (vietato dalla CSP)");
  if (/javascript:/i.test(src)) fail(rel + ": link javascript:");
  const text = src.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const bad of ["undefined", "NaN", "[object Object]"]) if (text.includes(bad)) fail(rel + ": contiene " + bad);
  for (const m of src.matchAll(/\shref="(\/[^"]*)"/g)) {
    links++;
    if (!pageFor(m[1])) fail(rel + ": link rotto " + m[1]);
  }
  if (!/<link rel="canonical" href="https:\/\/fischiettofinale\.com\//.test(src)) fail(rel + ": manca il link canonico");
}

/* Content Security Policy. */
const headers = readFileSync(path.join(dist, "_headers"), "utf-8");
const csp = (headers.match(/Content-Security-Policy: (.*)/) || [])[1] || "";
const scriptSrc = (csp.match(/script-src ([^;]*)/) || [])[1] || "";
if (scriptSrc.trim() !== "'self'") fail("_headers: script-src deve essere solo 'self' (ora: " + scriptSrc + ")");
["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'none'"].forEach((d) => { if (!csp.includes(d)) fail("_headers: manca " + d); });
headers.split("\n").forEach((line, i) => { if (line.length > 2000) fail("_headers: riga " + (i + 1) + " oltre i 2000 caratteri di Cloudflare"); });

/* Sitemap. */
const sitemap = readFileSync(path.join(dist, "sitemap.xml"), "utf-8");
const locs = [...sitemap.matchAll(/<loc>https:\/\/fischiettofinale\.com(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
locs.forEach((u) => { if (!pageFor(u)) fail("sitemap: " + u + " non esiste"); });

/* JSON ripubblicati. */
files.filter((f) => f.endsWith(".json")).forEach((f) => { try { JSON.parse(readFileSync(f, "utf-8")); } catch (e) { fail(path.relative(dist, f) + ": JSON non valido"); } });

/* Limite di Cloudflare Pages (piano gratuito): 20.000 file. */
if (files.length > 15000) fail("dist/ ha " + files.length + " file: vicino al limite di 20.000 di Cloudflare Pages");

if (problems.length) {
  console.error(problems.length + " problemi nel sito generato:\n- " + problems.slice(0, 50).join("\n- "));
  process.exit(1);
}
console.log("dist/ ok: " + html.length + " pagine, " + files.length + " file, " + links + " link interni verificati, " + locs.length + " indirizzi in sitemap.");
