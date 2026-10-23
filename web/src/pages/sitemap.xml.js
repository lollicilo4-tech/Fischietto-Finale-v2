/* Mappa del sito per i motori di ricerca: tutte le pagine generate (tranne la 404). */
import { LEAGUES, SECTIONS, slugify, matchSlug, INFO_URL } from "../lib/core.js";
import { leagueData, allTeams } from "../lib/data.js";

export function GET({ site }) {
  const base = String(site).replace(/\/$/, "");
  const urls = ["/", INFO_URL, "/live/"];
  LEAGUES.forEach((l) => {
    Object.values(SECTIONS).forEach((s) => { if (!(l.code === "SA" && s.path === "")) urls.push("/" + l.slug + "/" + s.path); });
    const t = leagueData(l.code).turno;
    (t ? t.matches : []).forEach((m) => urls.push("/" + l.slug + "/partita/" + matchSlug(m) + "/"));
    [...new Set(allTeams(l.code).map(slugify))].forEach((s) => urls.push("/" + l.slug + "/squadra/" + s + "/"));
  });
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => "  <url><loc>" + base + u + "</loc></url>").join("\n") + "\n</urlset>\n";
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
