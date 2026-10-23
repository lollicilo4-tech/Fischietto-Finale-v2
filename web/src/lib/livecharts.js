/* Live Center: grafici di andamento (stile Sofascore, solo dati disponibili). Ricavato da static/index.html.
   1) linea del tempo con gol, cartellini e cambi sopra (casa) e sotto (trasferta);
   2) probabilità 1-X-2 minuto per minuto, ricalcolate dal modello con risultato, minuto e rossi;
   3) momentum stimato: il feed dà solo i totali (attacchi pericolosi, tiri, angoli), quindi la
      pagina li registra a ogni aggiornamento e disegna di quanto crescono minuto per minuto.
      Vale da quando la partita è stata aperta in questo browser: i minuti prima non si inventano;
   4) statistiche live (possesso, tiri...) se il feed le fornisce.
   Funzioni pure: lo stato del momentum vive in un oggetto "store" passato da fuori. */
import { pc, esc } from "./core.js";

export function lcNorm(v) { return String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }
export function lcText(v) {
  if (v == null) return "";
  if (typeof v === "object") return String(v.name || v.short_name || v.shortName || v.title || v.value || v.label || "");
  return String(v);
}
export function lcMinute(v) {
  if (v && typeof v === "object") v = v.elapsed != null ? v.elapsed : v.minute != null ? v.minute : v.value;
  const m = String(v == null ? "" : v).match(/(\d+)\s*(?:\+\s*(\d+))?/);
  if (!m) return null;
  return Math.min(130, parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0));
}
export function lcNowMinute(status, events) {
  const s = lcText(status).toLowerCase();
  if (/\b(ht|half ?time|intervallo)\b/.test(s)) return 45;
  if (/\b(ft|full ?time|finished|ended|terminat)/.test(s)) return 90;
  const m = lcMinute(s);
  if (m != null) return m;
  let last = 0;
  (events || []).forEach((e) => { if (e.minute != null && e.minute > last) last = e.minute; });
  return last || null;
}
function lcKind(raw) {
  const k = lcNorm(raw);
  if (/own goal|autogol/.test(k)) return "owngoal";
  if (/missed penalty|penalty missed|rigore sbagliato/.test(k)) return "other";
  if (/goal|gol|scoring/.test(k)) return "goal";
  if (/second yellow|red card|cartellino rosso|^red( |$)/.test(k)) return "red";
  if (/yellow|giallo/.test(k)) return "yellow";
  if (/substitution|sostituzion|subst/.test(k)) return "sub";
  return "other";
}
function lcSide(ev, home, away, homeId, awayId) {
  const raw = ev.side != null ? ev.side : ev.team_side != null ? ev.team_side : ev.home_away != null ? ev.home_away : ev.is_home;
  if (raw === true || /^(home|h|1|casa)$/i.test(String(raw))) return "home";
  if (raw === false || /^(away|a|2|trasferta)$/i.test(String(raw))) return "away";
  const team = ev.team || ev.team_name || ev.participant_name || ev.participant;
  const id = team && typeof team === "object" ? team.id : ev.team_id;
  if (id != null && homeId != null && String(id) === String(homeId)) return "home";
  if (id != null && awayId != null && String(id) === String(awayId)) return "away";
  const t = lcNorm(lcText(team)), h = lcNorm(home), a = lcNorm(away);
  if (!t) return null;
  if (t === h || (t.length >= 4 && (h.indexOf(t) >= 0 || t.indexOf(h) >= 0))) return "home";
  if (t === a || (t.length >= 4 && (a.indexOf(t) >= 0 || t.indexOf(a) >= 0))) return "away";
  return null;
}
export function lcEvents(list, home, away, homeId, awayId) {
  return (Array.isArray(list) ? list : []).map((ev) => {
    if (!ev || typeof ev !== "object") return null;
    const kindRaw = ev.type || ev.event_type || ev.incident_type || ev.name || ev.detail || ev.description || "";
    const kind = lcKind(lcText(kindRaw) + " " + lcText(ev.detail || ev.incident_class || ""));
    const minute = lcMinute(ev.minute != null ? ev.minute : ev.time != null ? ev.time : ev.elapsed != null ? ev.elapsed : ev.match_time);
    if (minute == null || kind === "other") return null;
    return { minute, kind, side: lcSide(ev, home, away, homeId, awayId), player: lcText(ev.player || ev.player_name || ev.athlete || "") };
  }).filter(Boolean).sort((a, b) => a.minute - b.minute);
}
/* Pronostico pre-partita: dai nostri turni se la partita c'è, altrimenti medie generali.
   priors: [{home, away, xg:[casa, trasferta]}] da tutti i campionati pubblicati. */
export function lcPrior(priors, home, away) {
  const h = lcNorm(home), a = lcNorm(away);
  const same = (x, y) => { x = lcNorm(x); return x === y || (x.length >= 4 && y.length >= 4 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0)); };
  const found = (priors || []).find((m) => same(m.home, h) && same(m.away, a));
  return found ? { lh: found.xg[0], la: found.xg[1], model: true } : { lh: 1.45, la: 1.15, model: false };
}
const lcPois = (l, k) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
export function lcProb(lh, la, gh, ga) {
  const r = { p1: 0, px: 0, p2: 0 };
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const q = lcPois(lh, i) * lcPois(la, j), dh = gh + i, da = ga + j;
    if (dh > da) r.p1 += q; else if (dh === da) r.px += q; else r.p2 += q;
  }
  const t = r.p1 + r.px + r.p2;
  return { p1: r.p1 / t, px: r.px / t, p2: r.p2 / t };
}
/* Curva delle probabilità minuto per minuto. Ritorna null se gli eventi non spiegano il risultato. */
export function lcCurve(prior, events, now, gh, ga) {
  const goals = (flip) => events.filter((e) => (e.kind === "goal" || e.kind === "owngoal") && e.side).map((e) => {
    const side = e.kind === "owngoal" && flip ? (e.side === "home" ? "away" : "home") : e.side;
    return { minute: e.minute, side };
  });
  const count = (list, side) => list.filter((g) => g.side === side).length;
  let list = goals(false);
  if (count(list, "home") !== gh || count(list, "away") !== ga) {
    list = goals(true);
    if (count(list, "home") !== gh || count(list, "away") !== ga) return null;
  }
  const reds = events.filter((e) => e.kind === "red" && e.side);
  const end = Math.max(1, Math.min(now || 0, 120)), pts = [];
  for (let m = 0; m <= end; m++) {
    let sh = 0, sa = 0, rh = 0, ra = 0;
    list.forEach((g) => { if (g.minute <= m) { if (g.side === "home") sh++; else sa++; } });
    reds.forEach((r) => { if (r.minute <= m) { if (r.side === "home") rh++; else ra++; } });
    const rest = Math.max(0, (Math.max(90, end) - m) / 90);
    const lh = prior.lh * rest * Math.pow(0.75, rh) * Math.pow(1.2, ra);
    const la = prior.la * rest * Math.pow(0.75, ra) * Math.pow(1.2, rh);
    const p = lcProb(lh, la, sh, sa);
    pts.push({ m, p1: p.p1, px: p.px, p2: p.p2 });
  }
  return pts;
}
function lcTimelineSvg(events, now, home, away) {
  const W = 340, H = 92, L = 8, R = 8, mid = 46, end = Math.max(90, now || 0);
  const x = (m) => L + Math.min(m, end) / end * (W - L - R);
  const icon = { goal: "⚽", owngoal: "⚽", red: "🟥", yellow: "🟨", sub: "🔄" };
  let g = '<line class="lc-axis" x1="' + L + '" y1="' + mid + '" x2="' + (W - R) + '" y2="' + mid + '"/>';
  g += '<line class="lc-ht" x1="' + x(45) + '" y1="' + (mid - 6) + '" x2="' + x(45) + '" y2="' + (mid + 6) + '"/>';
  if (now) g += '<rect class="lc-played" x="' + L + '" y="' + (mid - 2) + '" width="' + (x(now) - L) + '" height="4" rx="2"/>';
  [0, 45, 90].forEach((m) => { g += '<text class="lc-tick" x="' + x(m) + '" y="' + (mid + 4) + '" dy="14" text-anchor="middle">' + m + "'</text>"; });
  const stack = {};
  events.forEach((e) => {
    if (!e.side) return;
    const key = e.side + Math.round(e.minute / 4), n = stack[key] = (stack[key] || 0) + 1;
    const y = e.side === "home" ? mid - 6 - n * 14 : mid + 20 + n * 14;
    g += '<text class="lc-ev ' + e.kind + '" x="' + x(e.minute) + '" y="' + y + '" text-anchor="middle"><title>' +
      esc(e.minute + "' " + (e.player || "") + " (" + (e.side === "home" ? home : away) + ")") + "</title>" + icon[e.kind] + "</text>";
  });
  return '<svg class="lc-timeline" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Linea del tempo: in alto ' + esc(home) + ", in basso " + esc(away) + '">' + g + "</svg>";
}
function lcProbSvg(pts, end) {
  const W = 340, H = 150, L = 30, R = 8, T = 8, B = 22, span = Math.max(90, end);
  const x = (m) => L + m / span * (W - L - R), y = (v) => T + (1 - v) * (H - T - B);
  const area = (lo, hi) => {
    const top = pts.map((p) => x(p.m).toFixed(1) + "," + y(hi(p)).toFixed(1));
    const bot = pts.slice().reverse().map((p) => x(p.m).toFixed(1) + "," + y(lo(p)).toFixed(1));
    return top.concat(bot).join(" ");
  };
  let g = '<polygon class="lc-a1" points="' + area(() => 0, (p) => p.p1) + '"/>' +
    '<polygon class="lc-ax" points="' + area((p) => p.p1, (p) => p.p1 + p.px) + '"/>' +
    '<polygon class="lc-a2" points="' + area((p) => p.p1 + p.px, () => 1) + '"/>';
  [0, 0.5, 1].forEach((v) => { g += '<text class="lc-tick" x="' + (L - 4) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + Math.round(v * 100) + "%</text>"; });
  [0, 45, 90].forEach((m) => { g += '<text class="lc-tick" x="' + x(m) + '" y="' + (H - 6) + '" text-anchor="middle">' + m + "'</text>"; });
  g += '<line class="lc-axis" x1="' + x(45) + '" y1="' + T + '" x2="' + x(45) + '" y2="' + (H - B) + '" stroke-dasharray="3 3"/>';
  return '<svg class="lc-prob" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Probabilità di 1, X e 2 minuto per minuto">' + g + "</svg>";
}
const LC_STAT_NAMES = {
  "ball possession": "Possesso palla", "possession": "Possesso palla", "total shots": "Tiri totali", "shots total": "Tiri totali",
  "shots": "Tiri totali", "shots on target": "Tiri in porta", "shots on goal": "Tiri in porta", "corner kicks": "Calci d'angolo", "corners": "Calci d'angolo",
  "fouls": "Falli", "offsides": "Fuorigioco", "yellow cards": "Cartellini gialli", "red cards": "Cartellini rossi", "expected goals": "Gol attesi (xG)",
  "xg": "Gol attesi (xG)", "big chances": "Grandi occasioni", "goalkeeper saves": "Parate", "saves": "Parate", "passes": "Passaggi",
  "dangerous attacks": "Attacchi pericolosi", "attacks": "Attacchi", "shots off target": "Tiri fuori", "shots off goal": "Tiri fuori"
};
export function lcStats(raw) {
  const out = [], seen = {};
  const push = (name, h, a) => {
    const key = lcNorm(name), label = LC_STAT_NAMES[key];
    if (!label || seen[label]) return;
    const hv = parseFloat(String(h).replace(",", ".")), av = parseFloat(String(a).replace(",", "."));
    if (!isFinite(hv) || !isFinite(av)) return;
    seen[label] = true;
    out.push({ label, home: hv, away: av, pct: /%/.test(String(h)) || key.indexOf("possession") >= 0 });
  };
  const walk = (v, depth) => {
    if (depth > 4 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    const name = v.name || v.type || v.label || v.title;
    const h = v.home != null ? v.home : v.home_value != null ? v.home_value : v.homeValue;
    const a = v.away != null ? v.away : v.away_value != null ? v.away_value : v.awayValue;
    if (name && h != null && a != null && typeof h !== "object") push(lcText(name), h, a);
    ["statisticsItems", "items", "stats", "groups", "statistics"].forEach((k) => { if (v[k]) walk(v[k], depth + 1); });
  };
  walk(raw, 0);
  if (!out.length && raw && raw.home && raw.away && typeof raw.home === "object" && !Array.isArray(raw.home)) {
    Object.keys(raw.home).forEach((k) => { if (raw.away[k] != null) push(k.replace(/_/g, " "), raw.home[k], raw.away[k]); });
  }
  return out;
}
function lcStatsHtml(stats) {
  if (!stats.length) return "";
  return '<h5>Statistiche</h5><div class="lc-stats">' + stats.map((s) => {
    const tot = (s.home + s.away) || 1, fmt = (v) => (s.pct ? Math.round(v) + "%" : String(Math.round(v * 100) / 100).replace(".", ","));
    return '<div class="lc-stat"><div class="lc-stat-head"><b>' + fmt(s.home) + "</b><span>" + esc(s.label) + "</span><b>" + fmt(s.away) + "</b></div>" +
      '<div class="lc-stat-bar"><i class="h" style="width:' + Math.round(s.home / tot * 100) + '%"></i><i class="a" style="width:' + Math.round(s.away / tot * 100) + '%"></i></div></div>';
  }).join("") + "</div>";
}
/* Risposta di api/widget/match: {match: {...}} oppure varianti con data/result. */
export function lcMatchFromPayload(payload) {
  let match = payload && (payload.match || payload.data || payload.result || payload);
  if (match && match.match && typeof match.match === "object") match = match.match;
  return match && typeof match === "object" ? match : {};
}
export function lcTimelineOf(match) {
  let t = match && (match.timeline || match.events || match.incidents || match.match_events || match.fixture_events);
  if (t && !Array.isArray(t)) t = t.events || t.items || t.data || [];
  return Array.isArray(t) ? t : [];
}
/* Minuto dal dettaglio (più recente della lista); se manca, lo stato della scheda. */
export function lcMinuteOf(match, fallback) {
  const st = lcNorm(match && match.status);
  if (/^(finished|ended|ft)$/.test(st)) return "FT";
  const m = match && (match.live_minute != null && match.live_minute !== "" ? match.live_minute : match.minute != null ? match.minute : match.elapsed);
  if (m != null && m !== "") return String(m);
  if (/half ?time|^ht$/.test(lcNorm(match && match.status_text))) return "HT";
  return fallback || "";
}
/* Indice di pressione cumulato di ogni squadra, dai totali del feed. */
const LC_PRESSURE = { "Attacchi pericolosi": 1, "Tiri in porta": 4, "Tiri fuori": 2, "Calci d'angolo": 2 };
export function lcPressure(stats) {
  let h = 0, a = 0, any = false;
  (stats || []).forEach((s) => { const w = LC_PRESSURE[s.label]; if (w) { h += s.home * w; a += s.away * w; any = true; } });
  return any ? { h, a } : null;
}
/* Aggiunge un campione {m, h, a} alla serie della partita e la ritorna.
   store: { all: {chiave: {t, s:[...]}} } in memoria; il chiamante lo salva nel browser se può.
   Le serie più vecchie di 6 ore vengono scartate. */
export function lcRecordSample(store, key, minute, stats, now = Date.now()) {
  const p = lcPressure(stats);
  if (!key) return [];
  const all = store.all || (store.all = {});
  Object.keys(all).forEach((k) => { if (!all[k] || !Array.isArray(all[k].s) || now - all[k].t > 6 * 3600 * 1000) delete all[k]; });
  const entry = all[key] || { t: now, s: [] };
  const list = entry.s;
  if (minute == null || !p) return list;
  const last = list[list.length - 1];
  if (last && minute <= last.m) {  // stesso minuto, o recupero del 1° tempo seguito dal 46'
    last.h = Math.max(last.h, p.h); last.a = Math.max(last.a, p.a);
  } else {
    list.push({ m: minute, h: p.h, a: p.a });
  }
  if (list.length > 150) list.splice(0, list.length - 150);
  entry.t = now; all[key] = entry;
  return list;
}
/* Barre minuto per minuto: crescita della pressione di casa meno quella ospite. Oltre 5 minuti
   senza campioni (pagina chiusa) non si spalma nulla: quel tratto resta vuoto. */
export function lcMomentumBars(samples) {
  const bars = [];
  for (let i = 1; i < (samples || []).length; i++) {
    const p = samples[i - 1], q = samples[i], span = q.m - p.m;
    if (span < 1 || span > 5) continue;
    const dh = Math.max(0, q.h - p.h) / span, da = Math.max(0, q.a - p.a) / span;
    for (let m = p.m + 1; m <= q.m; m++) bars.push({ m, v: dh - da });
  }
  return bars;
}
function lcMomentumSvg(bars, events, now, first) {
  const W = 340, H = 104, L = 8, R = 8, mid = 52, end = Math.max(90, now || 0), amp = 34;
  const step = (W - L - R) / end, x = (m) => L + Math.min(m, end) / end * (W - L - R);
  const top = Math.max(6, Math.max.apply(null, bars.map((b) => Math.abs(b.v)).concat([0])));
  let g = first > 0 ? '<rect class="lc-gap" x="' + L + '" y="' + (mid - amp) + '" width="' + (x(first) - L).toFixed(1) + '" height="' + (2 * amp) + '" rx="3"/>' : "";
  g += '<line class="lc-axis" x1="' + L + '" y1="' + mid + '" x2="' + (W - R) + '" y2="' + mid + '"/>';
  g += '<line class="lc-ht" x1="' + x(45) + '" y1="' + (mid - amp) + '" x2="' + x(45) + '" y2="' + (mid + amp) + '"/>';
  bars.forEach((b) => {
    if (!b.v) return;
    const h = Math.max(1.5, Math.abs(b.v) / top * amp), w = Math.max(1.2, step * 0.72);
    g += '<rect class="' + (b.v > 0 ? "lc-mh" : "lc-ma") + '" x="' + (x(b.m) - step + (step - w) / 2).toFixed(1) + '" y="' + (b.v > 0 ? mid - h : mid).toFixed(1) +
      '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1"/>';
  });
  events.forEach((e) => {
    if ((e.kind !== "goal" && e.kind !== "owngoal") || !e.side) return;
    g += '<text class="lc-ev" x="' + x(e.minute) + '" y="' + (e.side === "home" ? mid - amp - 4 : mid + amp + 13) + '" text-anchor="middle">⚽</text>';
  });
  [0, 45, 90].forEach((m) => { g += '<text class="lc-tick" x="' + x(m) + '" y="' + (H - 1) + '" text-anchor="middle">' + m + "'</text>"; });
  return '<svg class="lc-momentum" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Momentum stimato: barre in alto per la squadra di casa, in basso per gli ospiti">' + g + "</svg>";
}
/* source: "server" se i campioni vengono dal Worker che registra ogni minuto le partite dei nostri
   campionati, "local" (predefinito) se li ha registrati questo browser da quando la partita è aperta. */
function lcMomentumHtml(samples, events, now, home, away, source) {
  if (!samples || !samples.length) return "";
  const bars = lcMomentumBars(samples), first = samples[0].m, server = source === "server";
  const how = "Stima nostra dai dati SportScore: attacchi pericolosi, tiri e angoli, minuto per minuto. Non è il momentum di Sofascore.";
  if (!bars.length) {
    return '<h5>Momentum (stima)</h5><p class="lc-note">' + (server
      ? "Il nostro server registra la partita dal minuto " + esc(first) + "': il primo tratto compare al prossimo aggiornamento, circa un minuto. "
      : "Il grafico si costruisce da adesso (" + esc(first) + "'): il primo tratto compare dopo il prossimo aggiornamento, circa un minuto, tenendo aperta la partita. ") +
      how + "</p>";
  }
  const since = server
    ? " Registrato dal nostro server ogni minuto" + (first > 0 ? " dal minuto " + esc(first) + "'; la zona grigia è il tempo prima." : ".")
    : (first > 0 ? " Registrato da quando hai aperto la partita (" + esc(first) + "'); la zona grigia è il tempo prima." : "");
  return "<h5>Momentum (stima)</h5>" + lcMomentumSvg(bars, events, now, first) +
    '<div class="lc-legend"><span class="k1">▲ ' + esc(home) + '</span><span class="k2">▼ ' + esc(away) + "</span></div>" +
    '<p class="lc-note">' + how + since + " Si aggiorna ogni minuto finché i dettagli restano aperti.</p>";
}

/* Serie da mostrare: quella del server se ha almeno due campioni (copre anche i minuti prima
   dell'apertura della pagina), altrimenti quella registrata dal browser. */
export function pickMomentum(serverSamples, localSamples) {
  const valid = (Array.isArray(serverSamples) ? serverSamples : []).filter((s) => s && Number.isFinite(s.m) && Number.isFinite(s.h) && Number.isFinite(s.a));
  return valid.length >= 2 ? { samples: valid, source: "server" } : { samples: localSamples || [], source: "local" };
}
/* Blocco completo. o: {home, away, homeId, awayId, homeScore, awayScore, status, events (grezzi), stats (grezze),
   momentum (campioni), momentumSource ("server" | "local"), priors} */
export function liveChartsHtml(o) {
  const events = lcEvents(o.events, o.home, o.away, o.homeId, o.awayId);
  const now = lcNowMinute(o.status, events);
  const gh = parseInt(o.homeScore, 10), ga = parseInt(o.awayScore, 10);
  const parts = [];
  const hasTimeline = events.some((e) => e.side);
  if (hasTimeline) parts.push(lcTimelineSvg(events, now, o.home, o.away) + '<div class="lc-legend"><span>▲ ' + esc(o.home) + "</span><span>▼ " + esc(o.away) + "</span></div>");
  if (isFinite(gh) && isFinite(ga) && now != null && now > 0) {
    const prior = lcPrior(o.priors, o.home, o.away), pts = lcCurve(prior, events, now, gh, ga);
    const note = (prior.model ? "Parte dal pronostico pre-partita del modello" : "Partita fuori dai nostri campionati: parte da medie generali") +
      " e si aggiorna con risultato, minuto ed espulsioni. Non è una quota né un invito a scommettere.";
    if (pts && pts.length > 1) {
      const last = pts[pts.length - 1];
      parts.push("<h5>Chi vince? Probabilità minuto per minuto</h5>" + lcProbSvg(pts, now) +
        '<div class="lc-legend"><span class="k1">■ 1 ' + esc(o.home) + " " + pc(last.p1) + '</span><span class="kx">■ X ' + pc(last.px) +
        '</span><span class="k2">■ 2 ' + esc(o.away) + " " + pc(last.p2) + '</span></div><p class="lc-note">' + note + "</p>");
    } else {
      const rest = Math.max(0, (90 - Math.min(now, 90)) / 90), p = lcProb(prior.lh * rest, prior.la * rest, gh, ga);
      parts.push('<h5>Chi vince adesso?</h5><div class="lc-legend"><span class="k1">1 ' + pc(p.p1) + '</span><span class="kx">X ' + pc(p.px) +
        '</span><span class="k2">2 ' + pc(p.p2) + '</span></div><p class="lc-note">' + note +
        " Gli eventi del feed non spiegano tutto il risultato, quindi mostriamo solo la stima attuale.</p>");
    }
  }
  const momentumHtml = lcMomentumHtml(o.momentum, events, now, o.home, o.away, o.momentumSource);
  if (momentumHtml) parts.splice(hasTimeline ? 1 : 0, 0, momentumHtml);  // subito dopo la linea del tempo
  const statsHtml = lcStatsHtml(lcStats(o.stats));
  if (statsHtml) parts.push(statsHtml);
  return parts.length ? '<section class="live-charts"><h4>Andamento della partita</h4>' + parts.join("") + "</section>" : "";
}
