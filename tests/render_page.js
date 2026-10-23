// Esegue gli script di static/index.html con un DOM finto e i JSON di docs/, senza browser.
// Uso: node tests/render_page.js <radice repo> <lega> <cartella output>  (lo lancia test_frontend_render.py)
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = process.argv[2], league = process.argv[3] || "SA";
const html = fs.readFileSync(path.join(root, "static/index.html"), "utf8");
const errors = [];

class El {
  constructor(id) { this.id = id; this._html = ""; this.textContent = ""; this.hidden = false; this.style = {};
    this.handlers = {}; this.attrs = {}; this.children = [];
    const cls = new Set(); this.classList = { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : f; on ? cls.add(c) : cls.delete(c); return on; }, contains: c => cls.has(c) }; }
  set innerHTML(v) { this._html = String(v); } get innerHTML() { return this._html; }
  addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); }
  removeEventListener() {}
  click() { (this.handlers.click || []).forEach(f => f({ target: this, preventDefault() {}, stopPropagation() {} })); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  querySelector() { return new El(); } querySelectorAll() { return []; } closest() { return null; }
  appendChild(c) { this.children.push(c); return c; } insertBefore(c) { return c; } remove() {} focus() {} scrollIntoView() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 300, height: 100 }; }
  get value() { return this.attrs.value || ""; } set value(v) { this.attrs.value = v; }
  get options() { return []; } get dataset() { return {}; }
}
const byId = {};
const special = { "[data-open-info]": [], ".tile[data-go]": [] };
const document = {
  getElementById: id => (byId[id] = byId[id] || new El(id)),
  querySelector: () => new El(), querySelectorAll: sel => special[sel] || [],
  createElement: () => new El(), addEventListener() {}, body: new El("body"), documentElement: new El("html"),
  hidden: false, title: "",
};
special["[data-open-info]"].push(new El("info-tile"), new El("info-foot"));
const fetchMap = (url) => {
  const name = String(url).replace(/^\//, "").replace(/^api\/(turno|storico|classifica)$/, "$1.json");
  const file = path.join(root, "docs", name);
  if (!fs.existsSync(file)) return Promise.reject(new Error("404 " + url));
  const body = fs.readFileSync(file, "utf8");
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, json: () => Promise.resolve(JSON.parse(body)), text: () => Promise.resolve(body) });
};
const ctx = {
  document, console, URLSearchParams, Promise, setTimeout, clearTimeout, Date, Math, JSON, Number, String, Array, Object, Intl,
  setInterval: () => 0, clearInterval() {}, requestAnimationFrame: f => setTimeout(f, 0),
  location: { search: league === "SA" ? "" : "?league=" + league, href: "", pathname: "/", origin: "https://fischiettofinale.com", hash: "" },
  navigator: {}, localStorage: (() => { const st = {}; return { getItem: k => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); } }; })(),
  sessionStorage: { getItem: () => null, setItem() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  scrollTo() {}, addEventListener() {}, fetch: fetchMap, open: () => null,
  Headers: class {}, Response: class {}, AbortController: class { constructor() { this.signal = {}; } abort() {} },
};
ctx.window = ctx; ctx.self = ctx;
vm.createContext(ctx);
const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g; let m;
while ((m = re.exec(html))) {
  try { vm.runInContext(m[1], ctx); } catch (e) { errors.push("script: " + e.message); }
}
process.on("unhandledRejection", e => errors.push("promise: " + (e && e.message)));
setTimeout(() => {
  const out = {
    errors,
    matches: byId.matches ? byId.matches.innerHTML : "",
    verdict: byId.verdict ? byId.verdict.innerHTML : "",
    quality: byId.quality ? byId.quality.innerHTML : "",
  };
  // apri "Come funziona" dal piè di pagina e torna a Home
  special["[data-open-info]"][1].click();
  out.infoOpen = !byId["p-info"].hidden && byId["p-home"].hidden && !byId.back.hidden;
  byId["t-home"].click();
  out.infoClosed = byId["p-info"].hidden && !byId["p-home"].hidden;
  // pagina squadra, preferiti e condivisione (se la pagina li espone)
  out.season = byId.season ? byId.season.innerHTML : "";
  out.nextRounds = byId["next-rounds"] ? byId["next-rounds"].innerHTML : "";
  out.recap = byId.recap ? byId.recap.innerHTML : "";
  if (ctx.FF) {
    try {
      const firstTeam = (out.matches.match(/data-team="([^"]+)"/) || [])[1];
      if (firstTeam) {
        out.teamName = firstTeam;
        out.team = ctx.FF.openTeam(firstTeam.replace(/&amp;/g, "&").replace(/&#39;/g, "'"));
        out.teamOpen = !byId["p-team"].hidden && byId["p-home"].hidden;
        out.favOn = ctx.FF.toggleFav(firstTeam);
        out.matchesAfterFav = byId.matches.innerHTML;
        out.favStrip = byId["fav-strip"].innerHTML;
        byId["t-home"].click();
        out.teamClosed = byId["p-team"].hidden;
      }
      const firstId = (out.matches.match(/data-share="([^"]+)"/) || [])[1];
      if (firstId) out.share = ctx.FF.shareMatch(firstId);
    } catch (e) { errors.push("FF: " + e.message); }
  }
  // Live Center: grafici di andamento con tre forme di feed diverse (nessuna rete)
  if (ctx.FFLive) {
    try {
      const L = ctx.FFLive;
      out.live = {
        // eventi con nome della squadra, risultato coerente, un rosso
        named: L.liveChartsHtml({ home: "Inter", away: "Genoa", homeScore: 2, awayScore: 1, status: "67'",
          events: [{ type: "Goal", minute: 12, team: "Inter", player: "Lautaro" }, { type: "Yellow card", minute: 30, team: "Genoa" },
                   { type: "Goal", minute: 41, team: { name: "Genoa" } }, { type: "Red card", minute: 55, team: "Genoa" },
                   { type: "Goal", minute: "60+1", team: "Inter" }, { type: "Substitution", minute: 63, team: "Inter" }],
          stats: [{ name: "Ball possession", home: "58%", away: "42%" }, { name: "Shots on target", home: 6, away: 2 }] }),
        // lato indicato con side/is_home e statistiche a gruppi (stile Sofascore)
        sided: L.liveChartsHtml({ home: "A", away: "B", homeScore: 0, awayScore: 1, status: "HT",
          events: [{ incident_type: "goal", time: 33, is_home: false }],
          stats: { groups: [{ groupName: "Shots", statisticsItems: [{ name: "Total shots", home: "9", away: "4" }] }] } }),
        // eventi che non spiegano il risultato: niente curva, solo stima attuale
        partial: L.liveChartsHtml({ home: "X", away: "Y", homeScore: 2, awayScore: 0, status: "70'", events: [] }),
        empty: L.liveChartsHtml({ home: "X", away: "Y", homeScore: null, awayScore: null, status: "", events: [] }),
        curve: L.lcCurve({ lh: 1.5, la: 1.0 }, L.lcEvents([{ type: "Goal", minute: 10, side: "home" }], "A", "B"), 80, 1, 0),
      };
    } catch (e) { errors.push("FFLive: " + e.message); }
  }
  out.errors = errors;
  fs.writeFileSync(path.join(process.argv[4], `render-${league}.json`), JSON.stringify(out));
  console.log(league, "errors:", errors.length ? errors : "none", "| matches html:", out.matches.length,
    "| verdict:", out.verdict.length, "| quality:", out.quality.length, "| info open/close:", out.infoOpen, out.infoClosed);
}, 600);
