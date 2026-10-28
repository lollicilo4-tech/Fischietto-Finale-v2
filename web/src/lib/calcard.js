/* Immagine del calendario fantacalcio (/fantacalcio/calendario.png, 1080×1920, storie, Reels e TikTok):
   le squadre di Serie A dal calendario più favorevole, con avversarie e probabilità di vittoria delle
   prossime giornate (src/lib/fanta.js). Sempre in italiano, rigenerata a ogni build. */
import { C, h, text, brand, frame, badge, clip, renderPng, pngFrom, STORY, SITE } from "./cardkit.js";
import { crestDataUri } from "./crestpng.js";
import { fantaCalendar, METRICS, short } from "./fanta.js";
import { leagueData } from "./data.js";
import { setLang } from "./i18n.js";

export { STORY };
export const CAL_IMAGE = "/fantacalcio/calendario.png";
const BG = { easy: "rgba(63,210,155,0.30)", mid: "rgba(242,176,30,0.26)", hard: "rgba(255,122,107,0.28)" };

export function calendarData() {
  setLang("it");
  return fantaCalendar(leagueData("SA").turno, "win");
}

export function calendarTree(cal, crests = {}) {
  const n = Math.max(cal.teams.length, 1), rowH = Math.min(64, Math.floor((1330 - 6 * (n - 1)) / n));
  /* Riquadro interno largo 992 px: colonna delle squadre e celle delle giornate (spazio 8 px tra le celle). */
  const cols = Math.max(cal.rounds.length, 1), teamW = cols >= 5 ? 300 : 352, cellW = Math.floor((992 - teamW - 8 * cols) / cols);
  const span = cal.rounds.length ? (cal.rounds.length > 1 ? "GIORNATE " + cal.rounds[0] + "–" + cal.rounds[cal.rounds.length - 1] : "GIORNATA " + cal.rounds[0]) : "";
  /* Due righe per cella (avversaria, poi casa/trasferta e probabilità): il testo non va mai a capo. */
  const cell = (c) => c && Number.isFinite(c.v)
    ? h({ width: cellW, height: rowH, flexShrink: 0, borderRadius: 12, backgroundColor: BG[METRICS.win.tier(c.v)], flexDirection: "column", alignItems: "center", justifyContent: "center" },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: Math.round(rowH * 0.4), color: C.fg, lineHeight: 1 }, short(c.opp)),
      text({ fontFamily: "Barlow", fontWeight: 700, fontSize: Math.round(rowH * 0.3), color: C.fg, lineHeight: 1, marginTop: 3 }, (c.home ? "C " : "T ") + Math.round(c.v * 100) + "%"))
    : h({ width: cellW, height: rowH, flexShrink: 0, borderRadius: 12, backgroundColor: C.panel, alignItems: "center", justifyContent: "center" }, text({ fontFamily: "Barlow", fontSize: 26, color: C.muted }, "–"));
  return frame(STORY, { x: 44, top: 64, bottom: 50 }, "80% 0%", [
    h({ justifyContent: "space-between", alignItems: "center" }, brand(38), text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 30, color: C.muted, letterSpacing: 2 }, "SERIE A")),
    h({ flexDirection: "column", marginTop: 22, marginBottom: 18 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 80, lineHeight: 0.95, color: C.fg }, "CALENDARIO FANTACALCIO"),
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 48, color: C.gold, marginTop: 8 }, span),
      text({ fontFamily: "Plex", fontSize: 23, color: C.muted, marginTop: 6 }, "Probabilità di vittoria del modello · C casa, T trasferta")),
    h({ alignItems: "center", gap: 8, marginBottom: 8 },
      h({ width: teamW }, text({ fontFamily: "Plex", fontWeight: 600, fontSize: 20, color: C.muted }, "dal calendario più favorevole")),
      cal.rounds.map((d) => h({ width: cellW, flexShrink: 0, justifyContent: "center" }, text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 24, color: C.muted }, "G" + d)))),
    h({ flexDirection: "column", gap: 6, flexGrow: 1 }, cal.teams.map((r, i) => h({ alignItems: "center", gap: 8, height: rowH },
      h({ width: teamW, alignItems: "center", gap: 12, flexShrink: 0 },
        text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 24, color: C.muted, width: 34 }, String(i + 1)),
        badge(crests[r.team] || "", r.team, Math.min(44, rowH - 10)),
        text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 30, color: C.fg, textTransform: "uppercase" }, clip(r.team, 13))),
      r.cells.map(cell)))),
    h({ justifyContent: "space-between", alignItems: "flex-end", marginTop: 16 },
      h({ flexDirection: "column" },
        text({ fontFamily: "Plex", fontSize: 21, color: C.muted }, "Stime statistiche, non certezze."),
        text({ fontFamily: "Plex", fontSize: 21, color: C.muted }, "Verde favorevole · giallo equilibrata · rosso difficile")),
      text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 34, color: C.blue }, SITE))]);
}

export async function calendarPng(cal = calendarData()) {
  const crests = Object.fromEntries(await Promise.all(cal.teams.map(async (r) => [r.team, await crestDataUri("SA", r.team, 96)])));
  return renderPng(calendarTree(cal, crests), STORY);
}
export const calendarResponse = () => pngFrom("calendario fantacalcio", () => calendarPng());
