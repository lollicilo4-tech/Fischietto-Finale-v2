/* Dati strutturati (schema.org, JSON-LD) per i motori di ricerca: percorso della pagina (BreadcrumbList),
   partita (SportsEvent) e sito (WebSite). Solo fatti già nella pagina: squadre, data, campionato.
   Funzioni pure; la pagina li inserisce in <script type="application/ld+json">, che il browser non
   esegue (la Content Security Policy non cambia). */
import { leagueByCode, leagueUrl, homeUrl, SECTIONS, matchUrl } from "./core.js";
import { t, lang } from "./i18n.js";

const CONTEXT = "https://schema.org";

/* Percorso: Fischietto finale › campionato › sezione › pagina. extra: [{ name, path }] in fondo.
   Niente se la pagina non appartiene a un campionato o se il percorso ha un solo livello. */
export function breadcrumbLd(site, { league, section, extra = [] } = {}) {
  if (!league || !leagueByCode(league)) return null;
  const L = leagueByCode(league), items = [{ name: "Fischietto finale", path: homeUrl() }];
  if (leagueUrl(league, "home") !== homeUrl()) items.push({ name: L.name, path: leagueUrl(league, "home") });
  else items[0].name = "Fischietto finale · " + L.name;
  if (section && section !== "home" && SECTIONS[section]) items.push({ name: t(SECTIONS[section].label), path: leagueUrl(league, section) });
  extra.forEach((x) => { if (x && x.name && x.path) items.push(x); });
  if (items.length < 2) return null;
  return {
    "@context": CONTEXT, "@type": "BreadcrumbList",
    itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, item: site + x.path }))
  };
}

/* Una partita in programma. Senza orario valido niente evento (startDate è obbligatoria). */
export function sportsEventLd(site, league, m, description) {
  const L = leagueByCode(league);
  if (!L || !m || !m.home || !m.away || !Number.isFinite(Date.parse(m.kickoff || ""))) return null;
  const team = (name) => ({ "@type": "SportsTeam", name });
  return {
    "@context": CONTEXT, "@type": "SportsEvent",
    name: m.home + " – " + m.away,
    startDate: m.kickoff,
    url: site + matchUrl(league, m),
    sport: t("Calcio"),
    description,
    inLanguage: lang(),
    eventStatus: CONTEXT + "/EventScheduled",
    homeTeam: team(m.home), awayTeam: team(m.away), competitor: [team(m.home), team(m.away)],
    superEvent: { "@type": "SportsEvent", name: L.name }
  };
}

export const websiteLd = (site, description) => ({
  "@context": CONTEXT, "@type": "WebSite", name: "Fischietto finale", url: site + homeUrl(), inLanguage: lang(), description
});
