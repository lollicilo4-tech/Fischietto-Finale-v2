/* Immagini del riepilogo della settimana, rigenerate a ogni build:
   - /settimana/riepilogo.png, 1080×1920 (storie, Reels, TikTok), in italiano;
   - /settimana/anteprima.png e /en/week/preview.png, 1200×630: anteprima del link (og:image).
   Dati: src/lib/week.js. */
import { C, h, text, brand, frame, clip, renderPng, pngFrom, STORY, PREVIEW, SITE } from "./cardkit.js";
import { LEAGUES } from "./core.js";
import { leagueData } from "./data.js";
import { setLang, t } from "./i18n.js";
import { weekItems, weekSummary, rangeLabel, pickName } from "./week.js";
import { BUILD_NOW } from "./socialcard.js";

export { STORY, PREVIEW };

/* Riepilogo dai JSON pubblicati, con lo stesso "adesso" delle immagini per i social. */
export function buildWeek(lang = "it") {
  setLang(lang);
  return weekSummary(weekItems(Object.fromEntries(LEAGUES.map((l) => [l.code, leagueData(l.code).storico])), BUILD_NOW));
}

const pct = (p) => Math.round(p * 100) + "%";

function leagueBar(r, w) {
  return h({ alignItems: "center", gap: 16 },
    text({ fontFamily: "Barlow", fontWeight: 700, fontSize: w.font, color: C.fg, width: w.label }, clip(r.name.toUpperCase(), 17)),
    h({ flexGrow: 1, height: w.bar, borderRadius: w.bar, backgroundColor: C.line },
      h({ width: Math.max(3, Math.round(r.rate * 100)) + "%", height: w.bar, borderRadius: w.bar, backgroundColor: r.rate >= 0.5 ? C.good : C.blue })),
    text({ fontFamily: "Barlow", fontWeight: 800, fontSize: w.font, color: C.fg, width: w.value, textAlign: "right", justifyContent: "flex-end" }, r.hit + "/" + r.n));
}

function matchLine(x, ok) {
  return h({ justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: "2px solid " + C.line, gap: 16 },
    h({ flexDirection: "column", flexShrink: 1, minWidth: 0 },
      text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 34, color: C.fg, textTransform: "uppercase", lineHeight: 1 }, clip(x.home + " – " + x.away, 30)),
      text({ fontFamily: "Plex", fontSize: 21, color: C.muted, marginTop: 4 }, x.name + " · " + clip(pickName(x), 22) + " al " + pct(x.pick_p) + (x.exact ? " · esatto" : ""))),
    text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 44, color: ok ? C.good : C.bad, flexShrink: 0 }, x.hg + "-" + x.ag));
}

function block(title, color, list, ok) {
  return h({ flexDirection: "column", backgroundColor: C.panel, border: "2px solid " + C.line, borderLeft: "10px solid " + color, borderRadius: 26, padding: "16px 28px 8px" },
    text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 36, color: C.fg, letterSpacing: 1, marginBottom: 4 }, title),
    list.map((x) => matchLine(x, ok)));
}

export function weekStoryTree(s) {
  const leagues = s.leagues.slice().sort((a, b) => b.n - a.n).slice(0, 6);
  return frame(STORY, { x: 56, top: 70, bottom: 56 }, "80% 0%", [
    h({ justifyContent: "space-between", alignItems: "center" }, brand(40), text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 30, color: C.muted, letterSpacing: 2 }, "TUTTI I CAMPIONATI")),
    h({ flexDirection: "column", marginTop: 30 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 88, lineHeight: 0.95, color: C.fg }, "IL MODELLO IN 7 GIORNI"),
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 56, color: C.gold, marginTop: 10 }, rangeLabel(s).toUpperCase())),
    h({ alignItems: "flex-end", gap: 26, marginTop: 26 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 190, lineHeight: 0.85, color: C.fg }, s.n ? s.hit + "/" + s.n : "–"),
      s.n ? h({ flexDirection: "column", marginBottom: 8 },
        text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 64, color: C.gold, lineHeight: 1 }, pct(s.rate)),
        text({ fontFamily: "Plex", fontSize: 24, color: C.muted, marginTop: 6 }, "esiti azzeccati"),
        text({ fontFamily: "Plex", fontSize: 24, color: C.muted }, "se ne aspettava circa " + Math.round(s.expected))) : null),
    h({ flexDirection: "column", gap: 12, marginTop: 30, marginBottom: 26 }, leagues.map((r) => leagueBar(r, { font: 32, bar: 16, label: 300, value: 110 }))),
    h({ flexDirection: "column", gap: 18, flexGrow: 1 },
      s.best.length ? block("I COLPI MIGLIORI", C.good, s.best.slice(0, 4), true) : null,
      s.flops.length ? block("I FLOP", C.bad, s.flops.slice(0, 4), false) : null),
    h({ justifyContent: "space-between", alignItems: "flex-end", marginTop: 20 },
      h({ flexDirection: "column" },
        text({ fontFamily: "Plex", fontSize: 22, color: C.muted }, "Stime statistiche, non certezze."),
        text({ fontFamily: "Plex", fontSize: 22, color: C.muted }, "Nessun invito a scommettere.")),
      text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 38, color: C.blue }, SITE))]);
}

/* Anteprima del link: in italiano o in inglese (la lingua è già impostata da buildWeek). */
export function weekPreviewTree(s) {
  const leagues = s.leagues.slice().sort((a, b) => b.n - a.n).slice(0, 4);
  return frame(PREVIEW, { x: 52, top: 40, bottom: 38 }, "85% 0%", [
    h({ justifyContent: "space-between", alignItems: "center" }, brand(30), text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 26, color: C.blue }, SITE)),
    h({ alignItems: "baseline", gap: 18, marginTop: 14 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 60, color: C.fg }, t("IL MODELLO IN 7 GIORNI")),
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 40, color: C.gold }, rangeLabel(s).toUpperCase())),
    h({ flexGrow: 1, alignItems: "center", gap: 40 },
      h({ flexDirection: "column", width: 420 },
        text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 150, lineHeight: 0.9, color: C.fg }, s.n ? s.hit + "/" + s.n : "–"),
        text({ fontFamily: "Plex", fontSize: 24, color: C.muted, marginTop: 8 }, s.n ? t("esiti azzeccati · {rate}", { rate: pct(s.rate) }) : t("Riepilogo in arrivo"))),
      h({ flexDirection: "column", flexGrow: 1, gap: 14 }, leagues.map((r) => leagueBar(r, { font: 28, bar: 14, label: 230, value: 80 })))),
    text({ fontFamily: "Plex", fontSize: 20, color: C.muted }, t("Stime statistiche, non certezze."))]);
}

export const weekStoryResponse = () => pngFrom("riepilogo settimana", () => renderPng(weekStoryTree(buildWeek("it")), STORY));
export const weekPreviewResponse = (lang) => pngFrom("anteprima settimana " + lang, () => renderPng(weekPreviewTree(buildWeek(lang)), PREVIEW));
