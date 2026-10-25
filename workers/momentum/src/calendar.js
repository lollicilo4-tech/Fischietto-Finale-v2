/* Partite in corso trovate dal nostro calendario, non dalla lista "live" di SportScore.
   La lista fixtures?status=live di SportScore spesso non contiene Serie A, LaLiga, Premier League…
   (ottobre 2026: Cagliari–Bologna in corso ma assente), mentre il dettaglio della partita risponde.
   Il dettaglio si chiede con "squadra-a-vs-squadra-b" usando gli slug delle squadre di SportScore
   (l'ordine non conta), quindi:
   1. dal calendario del sito (/live-calendar.json) si prendono le partite iniziate da poco;
   2. per ogni squadra si cerca lo slug con /api/v1/search/ (una volta sola: resta in D1);
   3. si prova il dettaglio e lo si accetta solo se campionato e orario coincidono con il nostro;
   4. lo slug vero della partita resta in D1 per i minuti successivi.
   Ogni passo ha un tetto di richieste per restare nel limite del piano gratuito. */
import { liveLeagueKey, matchSlugOf } from "../../../web/src/lib/livefeed.js";
import { slugify } from "../../../web/src/lib/core.js";

export const CALENDAR_URL = "https://fischiettofinale.com/live-calendar.json";
export const SEARCH_URL = "https://sportscore.com/api/v1/search/?q=";
export const BEFORE_MS = 5 * 60 * 1000;          // si comincia a cercare 5 minuti prima del calcio d'inizio
export const AFTER_MS = 150 * 60 * 1000;         // e si smette 2 ore e mezza dopo
export const TIME_TOLERANCE_MS = 3 * 3600 * 1000; // orario SportScore e nostro devono essere vicini
export const MAX_SEARCHES = 6;                   // ricerche di squadre per esecuzione
export const MAX_GUESSES = 8;                    // dettagli "di prova" per esecuzione
export const MAX_TRIES = 24;                     // poi la partita si lascia perdere (e si segnala)…
export const RETRY_AFTER_MS = 15 * 60 * 1000;    // …per 15 minuti, poi si riprova da capo
const MAX_CANDIDATES = 3;                        // slug candidati per squadra

/* Nomi brevi di football-data.org che la ricerca di SportScore non trova: si cerca il nome completo. */
export const SEARCH_ALIASES = {
  "Man City": "Manchester City", "Man United": "Manchester United", "Brighton Hove": "Brighton Hove Albion",
  "Newcastle": "Newcastle United", "West Ham": "West Ham United", "Wolverhampton": "Wolverhampton Wanderers", "Nottingham": "Nottingham Forest",
  "Atleti": "Atletico Madrid", "Barça": "Barcelona", "Athletic": "Athletic Bilbao", "Celta": "Celta Vigo",
  "Santander": "Racing Santander", "Deportivo": "Deportivo La Coruna", "Sevilla FC": "Sevilla",
  "HSV": "Hamburger SV", "Bremen": "Werder Bremen", "Leverkusen": "Bayer Leverkusen", "Bayern": "Bayern Munich",
  "Dortmund": "Borussia Dortmund", "Frankfurt": "Eintracht Frankfurt", "1. FC Köln": "FC Koln",
  "PSG": "Paris Saint-Germain", "Olympique Lyon": "Lyon", "Stade Rennais": "Rennes", "RC Lens": "Lens",
  "Inter": "Inter Milan", "Shaktar": "Shakhtar Donetsk", "PAE AEK": "AEK Athens", "Sl. Bratislava": "Slovan Bratislava",
  "L. Red Imps": "Lincoln Red Imps", "Bodø/Glimt": "Bodo Glimt",
  "Napoli": "SSC Napoli", "Roma": "AS Roma", "Lazio": "SS Lazio", "Milan": "AC Milan", "Valencia": "Valencia CF",
  "Villarreal": "Villarreal CF", "Getafe": "Getafe CF", "Osasuna": "CA Osasuna", "Levante": "Levante UD"
};
/* Squadre giovanili, femminili, riserve: mai la prima squadra. */
const NOT_FIRST_TEAM = /\b(o?u ?1\d|o?u ?2[0-3]|sub ?\d\d|youth|juniors?|women|woman|ladies|femen\w*|feminin\w*|reserves?|beach|futsal|indoor|esports?|legends?|ii|iii|xi|b|c|r|am|w)\b|\(w\)|ou1\d/i;
/* Parole che SportScore spesso omette nei nomi ("Como 1907" è "Como"). */
const NAME_NOISE = new Set(["fc", "sc", "ac", "cf", "afc", "rc", "sco", "ssc", "ss", "acf", "us", "as", "cd", "ud", "sd", "ca", "sv", "fsv",
  "tsg", "vfb", "vfl", "ssv", "bsc", "rcd", "club", "calcio"]);

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export const matchKey = (m) => m.league + ":" + m.id;
export const searchQuery = (name) => SEARCH_ALIASES[name] || name;

/* Partite del calendario che dovrebbero essere in corso adesso. */
export function dueMatches(calendar, now) {
  return (calendar || []).filter((m) => {
    const t = Date.parse(m.kickoff);
    return Number.isFinite(t) && m.id && m.home && m.away && m.liveKey && t - BEFORE_MS <= now && now <= t + AFTER_MS;
  });
}

/* Squadre nella risposta della ricerca, ovunque si trovino: {name, slug} con un indirizzo /football/team/. */
export function teamsInSearch(data) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const url = typeof v.url === "string" ? v.url : "";
    if (typeof v.slug === "string" && /\/football\/team\//.test(url)) out.push({ name: String(v.name || v.slug), slug: v.slug });
    else Object.values(v).forEach(walk);
  };
  walk(data);
  return out;
}

/* Fino a 3 slug di prima squadra, il nome identico per primo. */
export function teamCandidates(name, results) {
  const want = norm(searchQuery(name)), short = norm(name);
  const seen = new Set();
  const first = results.filter((t) => /^[a-z0-9][a-z0-9-]*$/.test(t.slug) && !NOT_FIRST_TEAM.test(norm(t.name)))
    .filter((t) => (seen.has(t.slug) ? false : seen.add(t.slug)));
  const score = (t) => { const n = norm(t.name); return n === want || n === short ? 0 : n.includes(want) || want.includes(n) ? 1 : 2; };
  return first.map((t, i) => ({ t, s: score(t), i })).sort((a, b) => a.s - b.s || a.i - b.i).slice(0, MAX_CANDIDATES).map((x) => x.t.slug);
}

/* Il dettaglio restituito è davvero la nostra partita? Campionato e orario devono coincidere. */
export function isSameMatch(cal, payload) {
  const m = payload && payload.match;
  if (!m || typeof m !== "object") return false;
  if (liveLeagueKey(m.competition) !== cal.liveKey) return false;
  const t = Date.parse(m.time);
  return Number.isFinite(t) && Math.abs(t - Date.parse(cal.kickoff)) <= TIME_TOLERANCE_MS;
}

/* Parole significative di un nome (senza anni e sigle): "SSC Napoli" → ["napoli"]. */
const coreTokens = (name) => norm(name).split(" ").filter((t) => t && !/^\d+$/.test(t) && !NAME_NOISE.has(t));
/* Quante parole "in più" ha uno slug rispetto al nome; null se non contiene tutte le parole del nome
   o se è una squadra giovanile, femminile, riserve… ("aa-anapolina" non è Napoli). */
function slugDistance(slug, tokens) {
  const parts = String(slug).split("-");
  if (!tokens.length || !tokens.every((t) => parts.includes(t)) || NOT_FIRST_TEAM.test(parts.join(" "))) return null;
  return parts.filter((p) => !tokens.includes(p) && !NAME_NOISE.has(p) && !/^\d+$/.test(p)).length;
}
/* Slug da provare per una squadra, i più probabili prima: i risultati della ricerca uguali al nome
   (a parte sigle e anni), il nome semplice ("napoli"), i risultati con una parola in più
   ("tottenham-hotspur"), le forme con sigla ("valencia-cf", "fc-koln"), poi gli altri. Massimo 5. */
export function withVariants(name, slugs) {
  const tokens = coreTokens(searchQuery(name));
  const simple = tokens.join("-");
  const out = [], add = (v) => { if (v && !out.includes(v)) out.push(v); };
  const found = (slugs || []).map((s, i) => ({ s, d: slugDistance(s, tokens), i })).filter((x) => x.d != null).sort((a, b) => a.d - b.d || a.i - b.i);
  found.filter((x) => x.d === 0).forEach((x) => add(x.s));
  add(simple);
  found.filter((x) => x.d === 1).forEach((x) => add(x.s));
  if (simple) { add(simple + "-cf"); add("fc-" + simple); add(simple + "-fc"); }
  found.filter((x) => x.d > 1).forEach((x) => add(x.s));
  return out.slice(0, 5);
}
/* La cache di una squadra serve ancora? Se nessuno slug salvato contiene il suo nome si ricerca. */
export const usefulSlugs = (name, slugs) => (slugs || []).some((s) => slugDistance(s, coreTokens(searchQuery(name))) != null);

/* Coppie di slug da provare, in ordine: prima i candidati migliori di entrambe le squadre. */
export function slugPairs(homeSlugs, awaySlugs) {
  const out = [];
  homeSlugs.forEach((h, i) => awaySlugs.forEach((a, j) => out.push({ slug: h + "-vs-" + a, rank: i + j })));
  return out.sort((x, y) => x.rank - y.rank).map((x) => x.slug);
}

/* Per ogni partita in corso del calendario restituisce lo slug SportScore (se trovato) e, quando è stato
   appena trovato, anche il dettaglio già scaricato. Aggiorna le cache passate (Map) e conta le richieste.
   - teamCache: nome nostro → array di slug candidati ([] = cercato senza risultati)
   - matchCache: chiave partita → { slug, tries } */
export async function resolveDue({ due, teamCache, matchCache, getJson, matchDetailUrl, now = Date.now() }) {
  const out = [], budget = { searches: 0, guesses: 0 }, changedTeams = new Set(), changedMatches = new Set();
  const teamSlugs = async (name) => {
    if (teamCache.has(name) && (usefulSlugs(name, teamCache.get(name)) || budget.searches >= MAX_SEARCHES)) return teamCache.get(name);
    if (budget.searches >= MAX_SEARCHES) return null;  // si riprova al prossimo minuto
    budget.searches++;
    let slugs = [];
    try { slugs = teamCandidates(name, teamsInSearch(await getJson(SEARCH_URL + encodeURIComponent(searchQuery(name))))); }
    catch (e) { return null; }
    if (!slugs.length) { const own = slugify(searchQuery(name)); if (own) slugs = [own]; }
    teamCache.set(name, slugs); changedTeams.add(name);
    return slugs;
  };
  for (const cal of due) {
    const key = matchKey(cal), cached = matchCache.get(key);
    if (cached && cached.slug) { out.push({ cal, slug: cached.slug }); continue; }
    const retry = cached && cached.tries >= MAX_TRIES && now - (cached.updatedAt || 0) > RETRY_AFTER_MS;
    if (cached && cached.tries >= MAX_TRIES && !retry) { out.push({ cal, slug: null, gaveUp: true }); continue; }
    const hs = await teamSlugs(cal.home), as = await teamSlugs(cal.away);
    let found = null, tries = cached && !retry ? cached.tries : 0;
    if (hs && as) {
      for (const slug of slugPairs(withVariants(cal.home, hs), withVariants(cal.away, as))) {
        if (budget.guesses >= MAX_GUESSES || tries >= MAX_TRIES) break;
        budget.guesses++; tries++;
        try {
          const payload = await getJson(matchDetailUrl(slug));
          if (isSameMatch(cal, payload)) { found = { slug: matchSlugOf(payload.match) || slug, payload }; break; }
        } catch (e) { /* 404: coppia sbagliata, si prova la successiva */ }
      }
    }
    if (found || tries !== (cached ? cached.tries : 0) || retry) { matchCache.set(key, { slug: found ? found.slug : null, tries, updatedAt: now }); changedMatches.add(key); }
    out.push(found ? { cal, slug: found.slug, payload: found.payload } : { cal, slug: null });
  }
  return { resolved: out, budget, changedTeams, changedMatches };
}
