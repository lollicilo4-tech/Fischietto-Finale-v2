/* Riquadro "In corso adesso" della pagina Partite: le partite del campionato che il Worker sta
   seguendo (/api/live), con minuto e punteggio. Funzioni pure, provate in Node. */
import { esc } from "./core.js";
import { liveLeagueKey, leagueNameOf, valueText, livePhaseHtml, matchSlugOf } from "./livefeed.js";

/* Righe di /api/live di un campionato (chiave del Live: "serie-a", "premier-league"…). */
export function rowsOfLeague(rows, liveKey) {
  return (Array.isArray(rows) ? rows : []).filter((m) => m && m.home && m.away && liveLeagueKey(leagueNameOf(m)) === liveKey);
}

export function nowLiveHtml(rows, liveUrl, now = Date.now()) {
  if (!rows.length) return "";
  const score = (v) => (v == null || v === "" ? "–" : esc(String(v)));
  return '<div class="now-live-head"><h2>In corso adesso</h2><a class="foot-link ff-btn" href="' + esc(liveUrl) + '">Segui nel Live →</a></div>' +
    '<div class="now-live-list">' + rows.map((m) =>
      '<a class="now-live-row ff-btn" href="' + esc(liveUrl) + '" data-live-slug="' + esc(matchSlugOf(m)) + '">' +
        '<span class="live-phase">' + livePhaseHtml(m, now) + "</span>" +
        '<span class="now-live-team">' + esc(valueText(m.home)) + "</span>" +
        '<span class="now-live-score">' + score(m.home_score) + "<span>:</span>" + score(m.away_score) + "</span>" +
        '<span class="now-live-team away">' + esc(valueText(m.away)) + "</span></a>").join("") +
    "</div>";
}
