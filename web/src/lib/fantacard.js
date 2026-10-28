/* Immagini dei consigli fantacalcio, generate durante il build (mai nel browser):
   - consigli.png, 1080×1350, da scaricare e pubblicare sui social;
   - anteprima.png, 1200×630, anteprima del link /fantacalcio/ (og:image) su WhatsApp, Telegram, Facebook…
   Il disegno è fatto con satori (layout e testo diventano tracciati SVG, con i caratteri del sito già
   installati da Fontsource) e trasformato in PNG da resvg (WebAssembly): niente servizi esterni,
   niente programmi da installare. Dati: gli stessi della pagina (src/lib/fanta.js). */
import { C, h, text, brand, frame, renderPng, pngFrom, PREVIEW, SOCIAL } from "./cardkit.js";
import { pc, d2, roundDay } from "./core.js";
import { fantaRows, highlights, firstKickoff } from "./fanta.js";
import { setLang } from "./i18n.js";

export { SOCIAL, PREVIEW, renderPng };
export const SITE_LABEL = "fischiettofinale.com/fantacalcio";

/* ---------- Dati ---------- */
/* Le tre liste dell'immagine e le scritte di testa, dalla giornata pubblicata in turno.json. */
export function cardData(turno) {
  /* L'immagine è sempre in italiano: durante il build la lingua resta quella dell'ultima pagina generata
     (spesso una pagina /en/), e numeri e date la seguono. */
  setLang("it");
  const rows = fantaRows(turno ? turno.matches : []);
  const h = highlights(rows);
  const k = firstKickoff(turno ? turno.matches : []);
  const where = (r) => (r.home ? "in casa con " : "in trasferta con ") + r.opp;
  return {
    day: turno && turno.matchday ? "GIORNATA " + turno.matchday : "PROSSIMA GIORNATA",
    deadline: k ? "Prima partita: " + roundDay(k) : "",
    attack: h ? h.attack.map((r) => ({ team: r.team, sub: where(r), value: d2(r.xgFor), unit: "gol attesi" })) : [],
    defence: h ? h.defence.map((r) => ({ team: r.team, sub: where(r), value: pc(r.cs), unit: "porta inviolata" })) : [],
    avoid: h ? h.avoid.map((r) => ({ team: r.team, sub: where(r), value: d2(r.xgFor) + "–" + d2(r.xgAgainst), unit: "gol fatti–subiti" })) : []
  };
}

/* ---------- Disegno (strumenti in src/lib/cardkit.js) ---------- */
function row(item, accent, sizes) {
  return h({ alignItems: "center", justifyContent: "space-between", padding: sizes.pad + "px 0", borderTop: "2px solid " + C.line, gap: 20 },
    h({ flexDirection: "column", flexShrink: 1, minWidth: 0 },
      text({ fontFamily: "Barlow", fontWeight: 700, fontSize: sizes.team, color: C.fg, textTransform: "uppercase", lineHeight: 1 }, item.team),
      sizes.sub ? text({ fontFamily: "Plex", fontSize: sizes.sub, color: C.muted, marginTop: 3 }, item.sub) : null),
    h({ flexDirection: "column", alignItems: "flex-end", flexShrink: 0 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: sizes.value, color: accent, lineHeight: 1 }, item.value),
      text({ fontFamily: "Plex", fontSize: sizes.unit, color: C.muted, marginTop: 4 }, item.unit)));
}

function section(title, hint, items, accent, sizes) {
  return h({ flexDirection: "column", backgroundColor: C.panel, border: "2px solid " + C.line, borderRadius: 28, padding: "16px 30px 6px", borderLeft: "10px solid " + accent },
    h({ alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: sizes.title, color: C.fg, letterSpacing: 1 }, title),
      hint ? text({ fontFamily: "Plex", fontSize: sizes.unit + 2, color: C.muted }, hint) : null),
    items.length ? items.map((it) => row(it, accent, sizes)) : [text({ fontFamily: "Plex", fontSize: sizes.sub || 22, color: C.muted, padding: "14px 0" }, "In arrivo con il prossimo aggiornamento")]);
}

const disclaimer = "Stime statistiche, non certezze.";

export function socialTree(d) {
  const sizes = { team: 38, sub: 21, value: 44, unit: 17, title: 34, pad: 7 };
  return frame(SOCIAL, { x: 60, top: 52, bottom: 44 }, "85% 0%", [
    h({ justifyContent: "space-between", alignItems: "center" }, brand(34), text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 28, color: C.muted, letterSpacing: 2 }, "SERIE A")),
    h({ flexDirection: "column", marginTop: 16, marginBottom: 16 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 80, lineHeight: 0.95, color: C.fg }, "CONSIGLI FANTACALCIO"),
      h({ alignItems: "baseline", justifyContent: "space-between", marginTop: 8 },
        text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 58, color: C.gold }, d.day),
        d.deadline ? text({ fontFamily: "Plex", fontWeight: 600, fontSize: 24, color: C.muted }, d.deadline) : null)),
    h({ flexDirection: "column", gap: 14, flexGrow: 1 },
      section("CAPITANO", "scegli tra i loro attaccanti", d.attack, C.gold, sizes),
      section("PORTA INVIOLATA", "portiere e difesa", d.defence, C.good, sizes),
      section("GIORNATA DIFFICILE", "meglio evitare", d.avoid, C.bad, { ...sizes, sub: 0, team: 30, value: 32, pad: 5 })),
    h({ justifyContent: "space-between", alignItems: "flex-end", marginTop: 18 },
      text({ fontFamily: "Plex", fontSize: 20, color: C.muted }, disclaimer),
      text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 30, color: C.blue }, SITE_LABEL))]);
}

export function previewTree(d) {
  const sizes = { team: 34, sub: 0, value: 38, unit: 16, title: 30, pad: 13 };
  return frame(PREVIEW, { x: 48, top: 40, bottom: 40 }, "90% 0%", [
    h({ justifyContent: "space-between", alignItems: "center" }, brand(28), text({ fontFamily: "Barlow", fontWeight: 700, fontSize: 24, color: C.blue }, SITE_LABEL)),
    h({ alignItems: "baseline", gap: 18, marginTop: 14, marginBottom: 20 },
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 62, color: C.fg }, "CONSIGLI FANTACALCIO"),
      text({ fontFamily: "Barlow", fontWeight: 800, fontSize: 62, color: C.gold }, d.day)),
    h({ gap: 20, flexGrow: 1 },
      h({ flexDirection: "column", flexGrow: 1, flexBasis: 0 }, section("CAPITANO", "", d.attack, C.gold, sizes)),
      h({ flexDirection: "column", flexGrow: 1, flexBasis: 0 }, section("PORTA INVIOLATA", "", d.defence, C.good, sizes))),
    h({ justifyContent: "space-between", marginTop: 18 },
      text({ fontFamily: "Plex", fontSize: 20, color: C.muted }, disclaimer),
      d.deadline ? text({ fontFamily: "Plex", fontWeight: 600, fontSize: 20, color: C.muted }, d.deadline) : null)]);
}

/* ---------- PNG ---------- */
export const pngResponse = (kind, turno) => pngFrom("fantacalcio " + kind, () => {
  const d = cardData(turno);
  return renderPng(kind === "preview" ? previewTree(d) : socialTree(d), kind === "preview" ? PREVIEW : SOCIAL);
});
