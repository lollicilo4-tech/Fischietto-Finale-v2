/* Mappa del sito per i motori di ricerca: le pagine indicizzabili (src/lib/indexing.js), in italiano e in inglese.
   Live Center, I miei pronostici, Più probabili, Le scelte del modello e le pagine con pochi dati sono noindex. */
import { TODAY_URL, WEEK_URL, ABOUT_URL, LEAGUES, SECTIONS, slugify, matchSlug, INFO_URL, PRIVACY_URL, FANTA_URL, altPath } from "../lib/core.js";
import { leagueData, allTeams } from "../lib/data.js";
import { sectionIndexable, teamIndexable } from "../lib/indexing.js";

export function GET({ site }) {
  const base = String(site).replace(/\/$/, "");
  const urls = ["/", INFO_URL, PRIVACY_URL, TODAY_URL, WEEK_URL, ABOUT_URL];
  LEAGUES.forEach((l) => {
    const data = leagueData(l.code), t = data.turno;
    Object.entries(SECTIONS).forEach(([key, s]) => {
      if (!(l.code === "SA" && s.path === "") && sectionIndexable(key, data)) urls.push("/" + l.slug + "/" + s.path);
    });
    (t ? t.matches : []).forEach((m) => urls.push("/" + l.slug + "/partita/" + matchSlug(m) + "/"));
    const seen = new Set();
    allTeams(l.code).forEach((name) => {
      const slug = slugify(name);
      if (!seen.has(slug) && teamIndexable(name, data)) urls.push("/" + l.slug + "/squadra/" + slug + "/");
      seen.add(slug);
    });
  });
  urls.push(...urls.map((u) => altPath(u, "en")));
  urls.push(FANTA_URL, FANTA_URL + "calendario/", FANTA_URL + "guida/");  // solo in italiano
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => "  <url><loc>" + base + u + "</loc></url>").join("\n") + "\n</urlset>\n";
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
