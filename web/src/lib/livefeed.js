/* Live Center: lettura del feed SportScore e schede delle partite. Ricavato da static/index.html.
   Funzioni pure (niente DOM, niente fetch) così si possono provare in Node. */
import { esc, safeUrl } from "./core.js";
import { t, isEn } from "./i18n.js";
import { liveChartsHtml } from "./livecharts.js";

/* Fixtures esplicitamente live più due fonti di riserva (che contengono anche partite finite). */
export const LIVE_ENDPOINTS = [
  { url: "https://sportscore.com/api/v1/fixtures/?sport=football&status=live&limit=200", verifiedLive: true },
  { url: "https://sportscore.com/api/v1/matches/?sport=football&limit=50", verifiedLive: false },
  { url: "https://sportscore.com/api/widget/matches/?sport=football&limit=50", verifiedLive: false }
];
export const matchDetailUrl = (slug) => "https://sportscore.com/api/widget/match/?sport=football&slug=" + encodeURIComponent(slug);

export const MAJOR_LEAGUES = [
  { key: "serie-a", label: "🇮🇹 Serie A" }, { key: "premier-league", label: "🏴 Premier League" },
  { key: "laliga", label: "🇪🇸 LaLiga" }, { key: "bundesliga", label: "🇩🇪 Bundesliga" },
  { key: "ligue-1", label: "🇫🇷 Ligue 1" }, { key: "champions-league", label: "🏆 Champions League" },
  { key: "europa-league", label: "🏆 Europa League" }, { key: "conference-league", label: "🏆 Conference League" },
  { key: "serie-b", label: "🇮🇹 Serie B" }, { key: "eredivisie", label: "🇳🇱 Eredivisie" }, { key: "liga-portugal", label: "🇵🇹 Liga Portugal" },
  { key: "copa-del-rey", label: "🏆 Copa del Rey" }, { key: "championship", label: "🏴 Championship" },
  { key: "brasileirao", label: "🇧🇷 Brasileirão" }
];

export function rowsFrom(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const k of ["fixtures", "matches", "results", "items", "events"]) if (Array.isArray(data[k])) return data[k];
  if (data.data != null) { const nested = rowsFrom(data.data); if (nested.length) return nested; }
  if (data.result != null) { const resultRows = rowsFrom(data.result); if (resultRows.length) return resultRows; }
  return [];
}
function sourceText(value) {
  if (value == null) return "";
  if (typeof value === "object") return String(value.name || value.short_name || value.short || value.slug || value.label || "");
  return String(value);
}
function sourceIdentity(match) {
  const id = match.id || match.match_id || match.fixture_id || match.event_id || match.slug || match.match_slug;
  if (id != null && id !== "") return "id:" + String(id).toLowerCase();
  const home = sourceText(match.home || match.home_team || match.homeTeam || match.localteam || match.home_participant).toLowerCase();
  const away = sourceText(match.away || match.away_team || match.awayTeam || match.visitorteam || match.away_participant).toLowerCase();
  const time = sourceText(match.time || match.start_at || match.start_time || match.kickoff || match.date || match.fixture_date);
  return home && away ? "teams:" + home + "|" + away + "|" + time : "";
}
/* results: [{data, verifiedLive, failed}] nello stesso ordine di LIVE_ENDPOINTS. Unisce le fonti senza doppioni. */
export function combineSources(results) {
  if (results.every((r) => r.failed)) throw new Error("All SportScore live endpoints failed");
  const combined = [], positions = {};
  results.forEach((result) => {
    if (result.failed) return;
    rowsFrom(result.data).forEach((match) => {
      if (!match || typeof match !== "object") return;
      const candidate = Object.assign({}, match, { _ffLiveVerified: result.verifiedLive });
      const identity = sourceIdentity(candidate);
      if (identity && Object.prototype.hasOwnProperty.call(positions, identity)) {
        const position = positions[identity], previous = combined[position];
        combined[position] = Object.assign({}, candidate, previous);
        combined[position]._ffLiveVerified = !!(previous._ffLiveVerified || candidate._ffLiveVerified);
      } else {
        if (identity) positions[identity] = combined.length;
        combined.push(candidate);
      }
    });
  });
  return combined;
}
export function valueText(v) {
  if (v == null) return "";
  if (typeof v === "object") return String(v.name || v.short_name || v.short || v.label || v.code || v.long || v.description || "");
  return String(v);
}
export function matchStatus(m) {
  const s = m.status || m.fixture_status || m.phase || m.time_status || "";
  return valueText(m.status_text || m.status_more || s).trim();
}
export function isLiveStatus(m) {
  const s = m.status || m.fixture_status || m.phase || m.time_status || m.state || "";
  const raw = [valueText(s), valueText(s.short), valueText(s.long), valueText(s.name), m.status_text, m.status_more, m.time_status]
    .map(valueText).join(" ").toLowerCase().replace(/[_-]+/g, " ");
  return /\b(live|in progress|in play|playing|first half|second half|1st half|2nd half|half time|halftime|extra time|penalties|penalty shootout|1h|2h|ht|et|pens|inplay|started)\b/i.test(raw);
}
/* La fonte fixtures è già filtrata sul live; le fonti di riserva vanno filtrate per stato. */
export const liveOnly = (matches) => matches.filter((m) => m._ffLiveVerified === true || isLiveStatus(m));

/* Campionato del feed → chiave del filtro. I nomi si confrontano per intero (con prefissi di paese
   o di federazione ammessi), non per parole contenute: "LigaPro Serie A" (Ecuador), "Azerbaijan
   Premier League" o "AFC Champions League" non sono i nostri campionati e finiscono in "other:". */
const LEAGUE_PATTERNS = [
  ["serie-a", /^(italy |italia |italian )?serie a( tim| enilive)?$/],
  ["premier-league", /^(england |english )?premier league$/],
  ["champions-league", /^(uefa )?champions league$/],
  ["europa-league", /^(uefa )?europa league$/],
  ["conference-league", /^(uefa )?(europa )?conference league$/],
  ["bundesliga", /^(germany |german )?bundesliga$/],
  ["laliga", /^((spain |spanish )?(laliga|la liga)( ea sports)?|(spain|spanish) primera division)$/],
  ["ligue-1", /^(france |french )?ligue 1( mcdonald s| uber eats)?$/],
  ["serie-b", /^(italy |italia |italian )?serie b( bkt)?$/],
  ["eredivisie", /^(netherlands |dutch )?eredivisie$/],
  ["liga-portugal", /^(portugal )?(liga portugal( betclic)?|primeira liga)$/],
  ["copa-del-rey", /^(spain |spanish )?copa del rey$/],
  ["championship", /^(england |english )?(efl |sky bet )?championship$/],
  ["brasileirao", /^((brazil|brazilian) serie a|(campeonato )?brasileir(ao|o)( serie a)?( betano)?)$/]
];
export function liveLeagueKey(name) {
  const n = String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  for (const [key, re] of LEAGUE_PATTERNS) if (re.test(n)) return key;
  return "other:" + n;
}
export const leagueNameOf = (m) => valueText(m.league || m.competition || m.tournament || m.league_name || m.competition_name) || t("Competizione non disponibile");

/* Opzioni del filtro campionato: i principali sempre, poi gli altri presenti nel feed. */
export function leagueOptions(live) {
  const feedLeagues = {};
  live.forEach((m) => { const name = leagueNameOf(m), key = liveLeagueKey(name); if (!feedLeagues[key]) feedLeagues[key] = name; });
  const extra = Object.keys(feedLeagues).filter((key) => !MAJOR_LEAGUES.some((item) => item.key === key))
    .sort((a, b) => feedLeagues[a].localeCompare(feedLeagues[b]));
  return '<option value="all">' + t("Tutti i campionati") + "</option>" +
    MAJOR_LEAGUES.map((item) => '<option value="' + item.key + '">' + esc(item.label) + "</option>").join("") +
    extra.map((key) => '<option value="' + esc(key) + '">' + esc(feedLeagues[key]) + "</option>").join("");
}

function translateKind(kind) {
  // Il feed scrive gli eventi in inglese: nelle pagine inglesi restano come sono.
  if (isEn()) return kind;
  const k = kind.toLocaleLowerCase();
  if (/penalty goal|penalty scored/.test(k)) return "Gol su rigore";
  if (/own goal/.test(k)) return "Autogol";
  if (/goal|scoring/.test(k)) return "Gol";
  if (/yellow card/.test(k)) return "Cartellino giallo";
  if (/red card/.test(k)) return "Cartellino rosso";
  if (/second yellow/.test(k)) return "Secondo cartellino giallo";
  if (/substitution/.test(k)) return "Sostituzione";
  if (/var/.test(k)) return "Revisione VAR";
  if (/kick.?off/.test(k)) return "Calcio d'inizio";
  return kind;
}
const firstArray = (values) => values.find(Array.isArray) || [];
function pickText(ev, keys) {
  for (const k of keys) { const val = ev && ev[k]; if (val != null && valueText(val).trim()) return valueText(val).trim(); }
  return "";
}
function eventMinute(ev) {
  let time = ev && (ev.time || ev.minute || ev.elapsed || ev.match_time);
  if (time && typeof time === "object") time = time.elapsed || time.minute || time.value || "";
  return time == null || time === "" ? "" : String(time).replace(/'$/, "") + "'";
}
export function eventsListHtml(rawEvents) {
  const items = rawEvents.map((ev) => {
    if (!ev || typeof ev !== "object") return null;
    const kind = pickText(ev, ["type", "event_type", "incident_type", "name", "detail", "description", "comments"]);
    const player = pickText(ev, ["player", "player_name", "participant", "athlete"]);
    const assist = pickText(ev, ["assist", "assist_player", "related_player"]);
    const team = pickText(ev, ["team", "team_name", "participant_name"]);
    const minute = eventMinute(ev), norm = kind.toLocaleLowerCase();
    const label = [translateKind(kind), player, assist && "Assist: " + assist].filter(Boolean).join(" · ");
    if (!label) return null;
    const cls = /goal|gol|scoring|autogol/.test(norm) ? "goal" : /yellow|giallo/.test(norm) ? "yellow" : /red card|cartellino rosso/.test(norm) ? "red" : /substitution|sostituzion/.test(norm) ? "substitution" : "other";
    const icon = cls === "goal" ? "⚽" : cls === "yellow" ? "🟨" : cls === "red" ? "🟥" : cls === "substitution" ? "🔄" : "•";
    return '<li class="live-event live-event-' + cls + '"><span class="live-event-minute">' + esc(minute || "•") + '</span><span class="live-event-body"><span class="live-event-icon" aria-hidden="true">' + icon +
      '</span><span class="live-event-copy"><b>' + esc(label) + "</b>" + (team ? "<small>" + esc(team) + "</small>" : "") + "</span></span></li>";
  }).filter(Boolean);
  return items.length ? '<section class="live-events"><h4>' + t("Eventi della partita") + "</h4><ol>" + items.join("") + "</ol></section>"
    : '<p class="expl">' + t("Il feed non include eventi verificabili per questa partita. Il risultato e lo stato live restano disponibili.") + "</p>";
}
/* Eventi dal dettaglio della partita (api/widget/match), usati quando si aprono i dettagli. */
export function detailEventsHtml(timeline, homeName, awayName) {
  const items = timeline.map((ev) => {
    if (!ev || typeof ev !== "object") return "";
    let minute = pickText(ev, ["minute", "time", "elapsed", "match_time"]);
    const kind = pickText(ev, ["type", "event_type", "incident_type", "name", "detail", "description", "comments"]);
    const player = pickText(ev, ["player", "player_name", "participant", "athlete"]);
    let team = pickText(ev, ["team", "team_name", "participant_name"]);
    if (!team && (ev.side === "home" || ev.side === "away")) team = (ev.side === "home" ? homeName : awayName) || "";
    const label = [kind, player].filter(Boolean).join(" · ");
    return label ? '<li class="live-event"><span class="live-event-minute">' + esc(minute ? String(minute).replace(/'$/, "") + "'" : "•") + "</span><span><b>" + esc(label) + "</b>" +
      (team ? "<small>" + esc(team) + "</small>" : "") + "</span></li>" : "";
  }).filter(Boolean);
  return items.length ? "<h4>" + t("Eventi della partita") + "</h4><ol>" + items.join("") + "</ol>" : "";
}

/* Identificativo SportScore della partita (usato per il dettaglio e per il momentum).
   Alcune risposte espongono solo l'URL pubblico: se ne estrae lo slug, mai inventato dai nomi. */
export function matchSlugOf(m) {
  let slug = (m && (m.slug || m.match_slug || m.url_slug)) || "";
  if (!slug && m && typeof m.url === "string") { const sm = m.url.match(/\/football\/match\/([^/?#]+)\//i); if (sm && sm[1]) slug = sm[1]; }
  return String(slug);
}

/* ---------- Minuto in corso, come su SportScore ("67'", "45+2'", "Intervallo") ----------
   Fonte esatta: live_minute del dettaglio SportScore (le partite dei nostri campionati arrivano da
   /api/live con il minuto). Per le altre la lista dà solo la fase ("2nd half"): il minuto si stima
   dall'orario d'inizio (1° tempo: minuti trascorsi; 2° tempo: meno 15 di intervallo) e la pagina lo fa
   avanzare da sola ogni minuto. */
export const PHASE_LABEL = { "1H": "1° tempo", "2H": "2° tempo", HT: "Intervallo", ET: "Supplementari", PEN: "Rigori", FT: "Finita", LIVE: "In corso" };
export function livePhase(m) {
  const s = [valueText(m && m.status_text), valueText(m && m.status_more), valueText(m && m.status)].join(" ").toLowerCase();
  if (/penalt|shoot ?out|rigori/.test(s)) return "PEN";
  if (/extra time|overtime|supplementari|\bet\b/.test(s)) return "ET";
  if (/half ?time|\bht\b|intervallo|break/.test(s)) return "HT";
  if (/2nd half|second half|\b2h\b|secondo tempo/.test(s)) return "2H";
  if (/1st half|first half|\b1h\b|primo tempo/.test(s)) return "1H";
  if (/finished|full ?time|\bft\b|ended|terminat/.test(s)) return "FT";
  return "LIVE";
}
/* Minuto (numero) e se è esatto o stimato; null se non si può sapere. */
export function liveMinute(m, now = Date.now()) {
  const phase = livePhase(m), raw = m && m.live_minute != null ? String(m.live_minute).trim() : "";
  if (phase === "HT" || phase === "FT" || phase === "PEN") return { phase, minute: null, exact: false };
  const plus = raw.match(/^(\d{1,3})\s*\+\s*(\d{1,2})$/);
  if (plus) return { phase, minute: +plus[1] + +plus[2], exact: true };
  if (/^\d{1,3}$/.test(raw) && +raw > 0) return { phase, minute: +raw, exact: true };
  const kickoff = Date.parse(m && (m.time || m.start_at || m.start_time || m.kickoff));
  if (!Number.isFinite(kickoff) || now < kickoff || (phase !== "1H" && phase !== "2H")) return { phase, minute: null, exact: false };
  const elapsed = Math.floor((now - kickoff) / 60000) + 1;
  return { phase, minute: phase === "1H" ? Math.max(1, elapsed) : Math.max(46, elapsed - 15), exact: false };
}
/* "67'", "45+2'", "90+4'", "105'" — oltre la fine del tempo si mostra il recupero. */
export function minuteLabel(minute, phase) {
  if (minute == null) return "";
  const end = phase === "1H" ? 45 : phase === "2H" ? 90 : phase === "ET" ? 120 : null;
  return end && minute > end ? end + "+" + Math.min(minute - end, 15) + "'" : minute + "'";
}
/* Testo dell'etichetta: minuto (se c'è) e fase nella lingua della pagina. */
export function livePhaseHtml(m, now = Date.now()) {
  const info = liveMinute(m, now);
  const label = t(PHASE_LABEL[info.phase] || PHASE_LABEL.LIVE);
  const min = info.minute != null
    ? '<b class="live-minute" data-minute="' + info.minute + '" data-minute-at="' + now + '" data-phase="' + info.phase + '"' +
      (info.exact ? "" : ' title="' + t("Minuto stimato dall'orario d'inizio") + '"') + ">" + minuteLabel(info.minute, info.phase) + "</b>"
    : "";
  return '<span class="live-pulse"></span>' + min + '<span class="live-phase-label">' + esc(label) + "</span>";
}

/* Scheda di una partita live. priors: pronostici dei nostri campionati per il grafico delle probabilità. */
export function liveCardHtml(m, priors, now = Date.now()) {
  const homeObj = m.home || m.home_team || m.homeTeam || m.localteam || m.home_participant;
  const awayObj = m.away || m.away_team || m.awayTeam || m.visitorteam || m.away_participant;
  const homeName = valueText(homeObj), awayName = valueText(awayObj);
  const score = m.score || m.scores || {};
  const homeScore = m.home_score != null ? m.home_score : (score.home != null ? score.home : (score.home_score != null ? score.home_score : (m.homeScore != null ? m.homeScore : null)));
  const awayScore = m.away_score != null ? m.away_score : (score.away != null ? score.away : (score.away_score != null ? score.away_score : (m.awayScore != null ? m.awayScore : null)));
  const league = leagueNameOf(m), leagueKey = liveLeagueKey(league);
  const searchText = (league + " " + homeName + " " + awayName).toLocaleLowerCase();
  const homeLogo = m.home_logo || (homeObj && typeof homeObj === "object" ? homeObj.logo || homeObj.image : "") || "";
  const awayLogo = m.away_logo || (awayObj && typeof awayObj === "object" ? awayObj.logo || awayObj.image : "") || "";
  const details = [];
  const kickoff = m.start_at || m.start_time || m.kickoff || m.date || m.fixture_date, venue = m.venue || m.stadium || m.location, round = m.round || m.stage || m.matchday;
  if (kickoff) details.push("<div><small>" + t("Orario") + "</small><b>" + esc(valueText(kickoff)) + "</b></div>");
  if (venue) details.push("<div><small>" + t("Stadio") + "</small><b>" + esc(valueText(venue)) + "</b></div>");
  if (round) details.push("<div><small>" + t("Turno") + "</small><b>" + esc(valueText(round)) + "</b></div>");
  /* Alcuni feed includono gli eventi: si mostrano se presenti, senza inventarli. */
  const rawEvents = firstArray([m.events, m.incidents, m.timeline, m.fixture_events, m.match_events, m.event_list]);
  const chartsMarkup = liveChartsHtml({
    home: homeName || t("Casa"), away: awayName || t("Ospiti"),
    homeId: homeObj && typeof homeObj === "object" ? homeObj.id : m.home_id, awayId: awayObj && typeof awayObj === "object" ? awayObj.id : m.away_id,
    homeScore, awayScore, status: matchStatus(m) || m.minute || m.elapsed, events: rawEvents, stats: m.statistics || m.stats || m.match_statistics, priors
  });
  const matchSlug = matchSlugOf(m);
  const logo = (u) => (safeUrl(u) ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + esc(safeUrl(u)) + '" alt="" data-hide-on-error>' : "");
  const hs = homeScore == null ? "–" : esc(String(homeScore)), as = awayScore == null ? "–" : esc(String(awayScore));
  return '<article class="live-match" data-live-slug="' + esc(matchSlug) + '" data-home="' + esc(homeName) + '" data-away="' + esc(awayName) +
    '" data-hs="' + esc(homeScore == null ? "" : homeScore) + '" data-as="' + esc(awayScore == null ? "" : awayScore) + '" data-status="' + esc(matchStatus(m)) + '" data-live-league="' + esc(leagueKey) +
    '" data-live-search="' + esc(searchText) + '"><div class="live-league-name">' + esc(league) + '</div><div class="live-phase">' + livePhaseHtml(m, now) +
    '</div><div class="live-teams"><div class="live-team">' + logo(homeLogo) + "<b>" + esc(homeName || t("Squadra casa")) + '</b></div><div class="live-score">' + hs + "<span>:</span>" + as +
    '</div><div class="live-team away">' + logo(awayLogo) + "<b>" + esc(awayName || t("Squadra ospite")) + '</b></div></div><button type="button" class="live-detail-toggle" aria-expanded="false">' + t("Dettagli partita") + ' <span aria-hidden="true">＋</span></button><div class="live-match-details" hidden>' +
    (details.length ? '<div class="live-detail-grid">' + details.join("") + "</div>" : "") + chartsMarkup + eventsListHtml(rawEvents) + "</div></article>";
}
