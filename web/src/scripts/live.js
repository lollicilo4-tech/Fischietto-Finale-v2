/* Isola del Live Center. Stesso comportamento del sito attuale:
   - scarica le partite in corso dalle tre fonti SportScore e le unisce;
   - filtri per campionato e ricerca;
   - dettagli (eventi, statistiche, grafici) caricati quando si apre una partita;
   - ogni minuto aggiorna le partite aperte e aggiunge un punto al momentum stimato;
   - ogni 2 minuti aggiorna la lista, solo se la pagina è visibile. */
import {
  LIVE_ENDPOINTS, matchDetailUrl, combineSources, liveOnly, leagueOptions, liveCardHtml, detailEventsHtml, livePhaseHtml, minuteLabel
} from "../lib/livefeed.js";
import {
  liveChartsHtml, lcMatchFromPayload, lcTimelineOf, lcMinuteOf, lcStats, lcNowMinute, lcEvents, lcRecordSample, pickMomentum
} from "../lib/livecharts.js";

const $ = (id) => document.getElementById(id);
const read = (id, fallback) => { const el = $(id); try { return el ? JSON.parse(el.textContent) : fallback; } catch (e) { return fallback; } };
const PRIORS = read("ff-live-priors", []);
const LINKS = read("ff-league-links", {});

/* Campionato scelto (?lega=premier-league): filtro iniziale, menu e barra in basso. */
const chosen = LINKS[new URLSearchParams(location.search).get("lega") || ""] || null;
if (chosen) {
  const select = $("league-select");
  if (select) select.value = chosen.code;
  const map = { "t-home": "home", "t-partite": "partite", "t-live": "live", "t-sicure": "sicure", "t-schedina": "schedina", "t-classifica": "classifica", "t-storico": "storico" };
  Object.keys(map).forEach((id) => { const a = $(id); if (a) a.href = chosen[map[id]]; });
  const back = $("back"); if (back) back.href = chosen.home;
  document.body.dataset.league = chosen.code;
}
/* Dal Live il menu dei campionati porta alla pagina Live dello stesso campionato. */
const headerSelect = $("league-select");
if (headerSelect) headerSelect.querySelectorAll("option").forEach((opt) => {
  const entry = Object.values(LINKS).find((l) => l.code === opt.value);
  if (entry) opt.dataset.href = entry.live;
});

/* Momentum: campioni salvati nel browser per 6 ore, così chi ricarica non perde quanto registrato. */
const MOMENTUM_KEY = "ff-momentum-v1";
const momentumStore = { all: {} };
try { momentumStore.all = JSON.parse(localStorage.getItem(MOMENTUM_KEY) || "{}") || {}; } catch (e) { momentumStore.all = {}; }
function recordSample(key, minute, stats) {
  const list = lcRecordSample(momentumStore, key, minute, stats);
  try { localStorage.setItem(MOMENTUM_KEY, JSON.stringify(momentumStore.all)); } catch (e) { /* resta in memoria */ }
  return list;
}

/* Momentum registrato dal Worker (D1) tramite /api/momentum, sullo stesso dominio. Se il servizio non
   risponde o non conosce la partita (campionati non nostri) resta la serie registrata dal browser. */
async function serverMomentum(slug) {
  try {
    const r = await fetch("/api/momentum?slug=" + encodeURIComponent(slug), { cache: "no-store" });
    if (!r.ok) return [];
    const data = await r.json();
    return (data && data.samples && data.samples[slug]) || [];
  } catch (e) { return []; }
}

let liveLoaded = false, liveLoading = false;
const status = $("live-status"), list = $("live-list"), refresh = $("live-refresh");
const leagueSelect = $("live-league"), searchInput = $("live-search"), filterEmpty = $("live-filter-empty");

function openSlugs() {
  const out = {};
  list.querySelectorAll(".live-match").forEach((card) => {
    const toggle = card.querySelector(".live-detail-toggle"), slug = card.getAttribute("data-live-slug");
    if (slug && toggle && toggle.getAttribute("aria-expanded") === "true") out[slug] = true;
  });
  return out;
}

function applyFilters() {
  const league = leagueSelect ? leagueSelect.value : "all";
  const query = searchInput ? searchInput.value.trim().toLocaleLowerCase() : "";
  let visible = 0;
  list.querySelectorAll(".live-match").forEach((card) => {
    const ok = (league === "all" || card.getAttribute("data-live-league") === league) && (!query || (card.getAttribute("data-live-search") || "").indexOf(query) !== -1);
    card.hidden = !ok;
    if (ok) visible++;
  });
  if (filterEmpty) {
    filterEmpty.hidden = visible > 0;
    if (!visible) filterEmpty.textContent = query || league !== "all"
      ? "Nessuna partita live corrisponde alla ricerca o al campionato selezionato. Prova a cambiare filtro."
      : "Nessuna partita live disponibile dal feed.";
  }
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function loadLiveMatches(force) {
  if (liveLoading || (!force && liveLoaded)) return;
  liveLoading = true; liveLoaded = true;
  status.hidden = false;
  status.textContent = "Caricamento delle partite in diretta…";
  const reopen = openSlugs();
  const previousFilter = leagueSelect ? leagueSelect.value : "all";
  list.innerHTML = "";
  if (refresh) { refresh.disabled = true; refresh.textContent = "Caricamento…"; }
  try {
    /* Si interrogano tutte le fonti: la lista "fixtures" a volte ne restituisce solo una parte e spesso
       non elenca i campionati principali. Per prime le partite dei nostri campionati registrate dal
       Worker (/api/live, stesso dominio): a parità di partita i loro dati (minuto compreso) prevalgono. */
    const sources = [{ url: "/api/live", verifiedLive: true }].concat(LIVE_ENDPOINTS);
    const results = await Promise.all(sources.map((ep) => fetchJson(ep.url)
      .then((data) => ({ data, verifiedLive: ep.verifiedLive, failed: false }))
      .catch(() => ({ data: null, verifiedLive: ep.verifiedLive, failed: true }))));
    const live = liveOnly(combineSources(results));
    if (leagueSelect) {
      leagueSelect.innerHTML = leagueOptions(live);
      /* Si parte dal campionato scelto, così il Live non mostra altre leghe mentre l'intestazione dice Serie A. */
      leagueSelect.value = force && previousFilter ? previousFilter : (chosen ? chosen.liveKey : "all");
      if (!leagueSelect.value) leagueSelect.value = "all";
    }
    if (!live.length) {
      status.innerHTML = '<strong>Nessuna partita in diretta restituita dal servizio.</strong><p class="expl">Il feed live non segnala incontri in corso in questo momento. Puoi comunque scegliere una lega o cercare una squadra; le partite concluse non vengono mostrate in questa sezione.</p>';
      if (filterEmpty) filterEmpty.hidden = true;
      return;
    }
    status.hidden = true;
    list.innerHTML = live.map((m) => liveCardHtml(m, PRIORS)).join("");
    applyFilters();
    /* Dopo l'aggiornamento automatico riapre le partite che erano aperte e ne ricarica i dettagli. */
    list.querySelectorAll(".live-match").forEach((card) => {
      const slug = card.getAttribute("data-live-slug"), toggle = card.querySelector(".live-detail-toggle");
      if (slug && toggle && reopen[slug]) toggle.click();
    });
  } catch (e) {
    liveLoaded = false;
    status.hidden = false;
    list.innerHTML = "";
    status.innerHTML = '<strong>Impossibile caricare il feed live.</strong><p class="expl">Il servizio dati non ha risposto correttamente. Riprova con ↻ Aggiorna; non mostriamo risultati non verificati.</p>';
  } finally {
    liveLoading = false;
    if (refresh) { refresh.disabled = false; refresh.textContent = "↻ Aggiorna"; }
  }
}

/* Eventi, statistiche e grafici di una partita. quiet: aggiornamento periodico, senza messaggi di caricamento. */
async function loadLiveDetails(card, quiet) {
  const details = card.querySelector(".live-match-details");
  if (!details || card.dataset.detailsLoading === "true") return;
  const slug = card.getAttribute("data-live-slug");
  if (!slug) {
    card.dataset.detailsLoaded = "true";
    if (!details.querySelector(".live-events")) {
      const note = document.createElement("p");
      note.className = "expl";
      note.textContent = "Il feed non fornisce un identificativo partita utilizzabile per caricare la cronologia.";
      details.appendChild(note);
    }
    return;
  }
  card.dataset.detailsLoading = "true";
  if (!quiet) {
    const loading = document.createElement("p");
    loading.className = "expl live-detail-loading";
    loading.textContent = "Caricamento eventi e statistiche…";
    details.appendChild(loading);
  }
  const fromServer = serverMomentum(slug);  // in parallelo al dettaglio SportScore
  try {
    const match = lcMatchFromPayload(await fetchJson(matchDetailUrl(slug)));
    /* Il dettaglio ha il minuto esatto: si aggiorna l'etichetta della scheda. */
    const phase = card.querySelector(".live-phase");
    if (phase && match && match.live_minute != null) phase.innerHTML = livePhaseHtml(match);
    const timeline = lcTimelineOf(match);
    const minute = lcMinuteOf(match, card.getAttribute("data-status"));
    const home = card.getAttribute("data-home"), away = card.getAttribute("data-away");
    const hs = match && match.home_score != null ? match.home_score : card.getAttribute("data-hs");
    const as = match && match.away_score != null ? match.away_score : card.getAttribute("data-as");
    const stats = match && (match.statistics || match.stats || match.match_statistics);
    const local = recordSample(slug, lcNowMinute(minute, lcEvents(timeline, home, away)), lcStats(stats));
    const momentum = pickMomentum(await fromServer, local);
    const chartsHtml = liveChartsHtml({
      home, away, homeId: match.home_team && match.home_team.id, awayId: match.away_team && match.away_team.id,
      homeScore: hs, awayScore: as, status: minute, events: timeline, stats,
      momentum: momentum.samples, momentumSource: momentum.source, priors: PRIORS
    });
    const oldCharts = details.querySelector(".live-charts");
    if (chartsHtml) {
      const holder = document.createElement("div");
      holder.innerHTML = chartsHtml;
      if (holder.firstElementChild) {
        if (oldCharts) details.replaceChild(holder.firstElementChild, oldCharts);
        else details.insertBefore(holder.firstElementChild, details.querySelector(".live-events") || null);
      }
    }
    const existing = details.querySelector(".live-events");
    const eventsHtml = detailEventsHtml(timeline, home, away);
    if (eventsHtml) {
      const section = document.createElement("section");
      section.className = "live-events";
      section.innerHTML = eventsHtml;
      if (existing) details.replaceChild(section, existing); else details.appendChild(section);
      const fallback = details.querySelector(".expl");
      if (fallback && fallback.textContent.indexOf("non include eventi") >= 0) fallback.remove();
    } else if (!existing && !details.querySelector(".live-no-events")) {
      const empty = document.createElement("p");
      empty.className = "expl live-no-events";
      empty.textContent = "Il dettaglio del servizio non contiene eventi verificabili per questa partita.";
      details.appendChild(empty);
    }
    card.dataset.detailsLoaded = "true";
  } catch (e) {
    if (!quiet) {  // un aggiornamento periodico fallito lascia i dati già mostrati
      const err = document.createElement("p");
      err.className = "expl";
      err.textContent = "Non è stato possibile caricare gli eventi dal servizio. Puoi riprovare aggiornando le partite live.";
      details.appendChild(err);
    }
  } finally {
    card.dataset.detailsLoading = "false";
    const loader = details.querySelector(".live-detail-loading");
    if (loader) loader.remove();
  }
}

list.addEventListener("click", (event) => {
  const toggle = event.target.closest(".live-detail-toggle");
  if (!toggle) return;
  const card = toggle.closest(".live-match"), details = card && card.querySelector(".live-match-details");
  if (!details) return;
  const open = toggle.getAttribute("aria-expanded") !== "true";
  toggle.setAttribute("aria-expanded", String(open));
  details.hidden = !open;
  toggle.lastElementChild.textContent = open ? "−" : "＋";
  if (!open || card.dataset.detailsLoaded === "true" || card.dataset.detailsLoading === "true") return;
  loadLiveDetails(card, false);
});
if (leagueSelect) leagueSelect.addEventListener("change", applyFilters);
if (searchInput) searchInput.addEventListener("input", applyFilters);
if (refresh) refresh.addEventListener("click", () => loadLiveMatches(true));

/* Ogni minuto aggiorna le partite aperte: eventi, statistiche e un nuovo punto del momentum. */
setInterval(() => {
  if (document.hidden) return;
  list.querySelectorAll(".live-match").forEach((card) => {
    const toggle = card.querySelector(".live-detail-toggle");
    if (toggle && toggle.getAttribute("aria-expanded") === "true" && card.dataset.detailsLoaded === "true") loadLiveDetails(card, true);
  });
}, 60000);
/* Il minuto avanza da solo tra un aggiornamento e l'altro (nell'intervallo resta fermo). */
function tickMinutes() {
  const now = Date.now();
  list.querySelectorAll(".live-minute[data-minute]").forEach((el) => {
    const phase = el.getAttribute("data-phase");
    if (phase !== "1H" && phase !== "2H" && phase !== "ET") return;
    const minute = +el.getAttribute("data-minute") + Math.floor((now - +el.getAttribute("data-minute-at")) / 60000);
    const text = minuteLabel(minute, phase);
    if (el.textContent !== text) el.textContent = text;
  });
}
setInterval(() => { if (!document.hidden) tickMinutes(); }, 15000);
/* Risultati freschi senza interrogare il servizio quando la scheda del browser è in secondo piano. */
setInterval(() => { if (!document.hidden) loadLiveMatches(true); }, 120000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && liveLoaded) loadLiveMatches(true); });

loadLiveMatches(false);
