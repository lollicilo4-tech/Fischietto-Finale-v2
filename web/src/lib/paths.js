/* Percorsi statici delle pagine di ogni campionato (getStaticPaths di Astro), uguali in italiano e in
   inglese: cambia solo la cartella della pagina (/serie-a/partita/… · /en/serie-a/match/…). */
import { LEAGUES, slugify, matchSlug } from "./core.js";
import { leagueData, allTeams } from "./data.js";

export const leaguePaths = () => LEAGUES.map((l) => ({ params: { lega: l.slug }, props: { league: l.code } }));
export function matchPaths() {
  return LEAGUES.flatMap((l) => {
    const t = leagueData(l.code).turno;
    return (t ? t.matches : []).map((m) => ({ params: { lega: l.slug, partita: matchSlug(m) }, props: { league: l.code, match: m } }));
  });
}
export function teamPaths() {
  return LEAGUES.flatMap((l) => {
    const seen = new Set();
    return allTeams(l.code).filter((name) => { const s = slugify(name); if (seen.has(s)) return false; seen.add(s); return true; })
      .map((name) => ({ params: { lega: l.slug, squadra: slugify(name) }, props: { league: l.code, team: name } }));
  });
}
