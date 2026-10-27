/* Calendario di una squadra in formato iCalendar (.ics, RFC 5545): le prossime partite con orario,
   campionato e pronostico del modello. Il telefono lo aggiunge come calendario e lo riscarica da solo
   (REFRESH-INTERVAL), quindi orari e probabilità seguono gli aggiornamenti del sito.
   Funzioni pure, provate in Node; i file li genera il build (src/pages/calendario/, src/pages/en/calendar/). */
import { leagueByCode, matchUrl, teamUrl, pc } from "./core.js";
import { t, isEn } from "./i18n.js";

/* Partite della squadra: turno in corso (con la pagina della partita) e prossime giornate. */
export function teamFixtures(team, turno) {
  const out = [], seen = new Set();
  const add = (m, page) => {
    if (!m || (m.home !== team && m.away !== team) || !Number.isFinite(Date.parse(m.kickoff || "")) || seen.has(String(m.id))) return;
    seen.add(String(m.id));
    out.push({ m, page });
  };
  ((turno && turno.matches) || []).forEach((m) => add(m, true));
  ((turno && turno.next_rounds) || []).forEach((r) => ((r && r.matches) || []).forEach((m) => add(m, false)));
  return out.sort((a, b) => a.m.kickoff.localeCompare(b.m.kickoff));
}

/* Testo di una proprietà: \ ; , e a capo vanno protetti. */
export const icsText = (s) => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/* Righe al massimo di 75 byte: le successive iniziano con uno spazio. */
export function fold(line) {
  const size8 = (x) => new TextEncoder().encode(x).length;
  if (size8(line) <= 75) return line;
  const parts = [];
  let cur = "", size = 0, limit = 75;
  for (const ch of line) {
    const n = size8(ch);
    if (size + n > limit) { parts.push(cur); cur = ""; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function teamCalendar({ site, league, team, turno, generatedAt }) {
  const L = leagueByCode(league), now = stamp(generatedAt || (turno && turno.generated_at) || new Date().toISOString());
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fischietto finale//" + (isEn() ? "Team calendar//EN" : "Calendario squadra//IT"),
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:" + icsText(team + " · Fischietto finale"),
    "X-WR-CALDESC:" + icsText(t("Prossime partite di {team} ({league}) con il pronostico del modello. Stime statistiche, non un invito a scommettere.", { team, league: L.name })),
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"
  ];
  teamFixtures(team, turno).forEach(({ m, page }) => {
    const p = m.prob || {}, top = m.top || (m.top_scores && m.top_scores[0]);
    const odds = Number.isFinite(p.p1) ? "1 " + m.home + " " + pc(p.p1) + " · X " + pc(p.px) + " · 2 " + m.away + " " + pc(p.p2) : "";
    const desc = L.name + ". " + (odds ? t("Modello: {odds}", { odds }) + (top ? ", " + t("risultato probabile {score}", { score: top[0] + "-" + top[1] }) : "") + ". " : "") +
      t("Stime statistiche, non un invito a scommettere.");
    const url = site + (page ? matchUrl(league, m) : teamUrl(league, team));
    lines.push("BEGIN:VEVENT", "UID:" + icsText(league.toLowerCase() + "-" + m.id + "@fischiettofinale.com"), "DTSTAMP:" + now,
      "DTSTART:" + stamp(m.kickoff), "DURATION:PT2H", "SUMMARY:" + icsText(m.home + " – " + m.away),
      "DESCRIPTION:" + icsText(desc), "URL:" + url, "STATUS:CONFIRMED", "TRANSP:TRANSPARENT", "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
