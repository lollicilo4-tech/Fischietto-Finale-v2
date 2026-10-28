/* Anteprima del link di ogni partita (og:image, 1200×630): stemmi, squadre e probabilità 1 X 2 del
   modello. È la scheda che compare quando qualcuno manda il link su WhatsApp, Telegram o sui social.
   Una sola immagine per le pagine italiana e inglese: niente parole, solo nomi, data e numeri. */
import { C, h, text, brand, frame, badge, clip, renderPng, pngFrom, PREVIEW, SITE } from "./cardkit.js";
import { crestDataUri } from "./crestpng.js";
import { leagueByCode, matchSlug } from "./core.js";
import { finalOutcome } from "./model.js";

export { PREVIEW };
/* Indirizzo dell'immagine (uguale in italiano e in inglese). */
export const previewPath = (league, m) => "/anteprime/" + leagueByCode(league).slug + "/" + matchSlug(m) + ".png";

const pct = (p) => Math.round(p * 100) + "%";
const dateFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" });
/* "28.10.2026" (ora italiana): si legge allo stesso modo in tutte le lingue. */
export const dateLabel = (kickoff) => { const d = new Date(kickoff || ""); return isNaN(d) ? "" : dateFmt.format(d).replace(/\//g, "."); };

/* Dati dell'immagine (funzione pura). crests: { home, away } come data URI, o "". */
export function matchCardData(league, m, crests = {}) {
  const L = leagueByCode(league), fo = finalOutcome(m);
  return {
    league: L ? L.name.toUpperCase() : "", date: dateLabel(m.kickoff),
    home: { name: m.home, crest: crests.home || "" }, away: { name: m.away, crest: crests.away || "" },
    cells: [["1", m.prob.p1], ["X", m.prob.px], ["2", m.prob.p2]].map(([code, p]) => ({ code, value: pct(p), p, hot: fo[0] === code }))
  };
}

const side = (team) => h({ flexDirection: "column", alignItems: "center", justifyContent: "center", width: 430, gap: 18 },
  badge(team.crest, team.name, 168),
  text({ fontFamily: "Barlow", fontWeight: 800, fontSize: team.name.length > 16 ? 40 : 50, color: C.fg, textTransform: "uppercase", lineHeight: 1, textAlign: "center" }, clip(team.name, 24)));

const cell = (c) => h({ flexDirection: "column", flexGrow: 1, flexBasis: 0, backgroundColor: C.panel, borderRadius: 22, padding: "12px 24px 16px",
  border: "3px solid " + (c.hot ? C.gold : C.line) },
  h({ justifyContent: "space-between", alignItems: "baseline" },
    text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 34, color: c.hot ? C.gold : C.muted }, c.code),
    text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 54, color: c.hot ? C.gold : C.fg, lineHeight: 1 }, c.value)),
  h({ height: 10, borderRadius: 10, backgroundColor: C.line, marginTop: 8 },
    h({ width: Math.max(4, Math.round(c.p * 100)) + "%", height: 10, borderRadius: 10, backgroundColor: c.hot ? C.gold : C.blue })));

export function matchTree(d) {
  return frame(PREVIEW, { x: 56, top: 40, bottom: 38 }, "50% 30%", [
    h({ justifyContent: "space-between", alignItems: "center" }, brand(30),
      h({ gap: 16, alignItems: "baseline" },
        text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 28, color: C.fg, letterSpacing: 1 }, d.league),
        d.date ? text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 28, color: C.muted }, d.date) : null)),
    h({ flexGrow: 1, alignItems: "center", justifyContent: "space-between" },
      side(d.home),
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 64, color: C.muted }, "–"),
      side(d.away)),
    h({ gap: 20 }, d.cells.map(cell)),
    h({ justifyContent: "flex-end", marginTop: 12 }, text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 24, color: C.blue }, SITE))]);
}

export async function matchPng(league, m) {
  const [home, away] = await Promise.all([crestDataUri(league, m.home, 192), crestDataUri(league, m.away, 192)]);
  return renderPng(matchTree(matchCardData(league, m, { home, away })), PREVIEW);
}
export const matchPngResponse = (league, m) => pngFrom("anteprima " + league + " " + m.id, () => matchPng(league, m));
