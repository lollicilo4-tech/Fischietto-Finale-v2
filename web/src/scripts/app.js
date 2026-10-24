/* Comportamenti comuni a tutte le pagine. Le pagine sono già complete in HTML:
   questo script aggiunge solo ciò che dipende dal browser (preferiti salvati sul telefono,
   condivisione, ora attuale, vecchi link) e funziona anche se una parte fallisce. */
import { favStripHtml } from "../lib/render.js";
import { leagueByCode, leagueUrl, INFO_URL, DEFAULT_LEAGUE } from "../lib/core.js";

const $ = (id) => document.getElementById(id);

/* ---------- Vecchi link (?league=PL&tab=partite#m-123) del sito su GitHub Pages ---------- */
function redirectLegacyUrl() {
  if (location.pathname !== "/" && location.pathname !== "/index.html") return false;
  const q = new URLSearchParams(location.search), code = q.get("league"), tab = q.get("tab");
  const hash = location.hash || "";
  if (!code && !tab && hash.indexOf("#m-") !== 0) return false;
  const league = leagueByCode(code) ? code : DEFAULT_LEAGUE;
  const SECTION_OF_TAB = { partite: "partite", sicure: "sicure", schedina: "schedina", classifica: "classifica", storico: "storico" };
  let target = tab === "info" ? INFO_URL : hash.indexOf("#m-") === 0 ? leagueUrl(league, "partite") : leagueUrl(league, SECTION_OF_TAB[tab] || "home");
  if (hash.indexOf("#m-") === 0) target += hash;
  location.replace(target);
  return true;
}

/* ---------- Squadre seguite: salvate solo su questo dispositivo, nessun account ---------- */
const FAV_KEY = "ff-squadre-seguite";
export function getFavs() {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; }
  catch (e) { return []; }
}
function setFavs(list) { try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(-30))); } catch (e) { /* storage non disponibile */ } }
function toggleFav(name) {
  const f = getFavs(), i = f.indexOf(name);
  if (i >= 0) f.splice(i, 1); else f.push(name);
  setFavs(f);
  decorateFavs();
  return i < 0;
}
const starHtml = '<span class="fav-star" aria-label="Squadra seguita">★</span>';
function setStar(container, on) {
  if (!container) return;
  const star = container.querySelector(":scope > .fav-star");
  if (on && !star) container.insertAdjacentHTML("afterbegin", starHtml);
  if (!on && star) star.remove();
}
/* Stelle su partite e classifiche, striscia "Le tue squadre", pulsante Segui. */
function decorateFavs() {
  const favs = new Set(getFavs());
  document.querySelectorAll("details.match[data-home]").forEach((card) => {
    const on = favs.has(card.dataset.home) || favs.has(card.dataset.away);
    card.classList.toggle("fav", on);
    setStar(card.querySelector(".mhead > span"), on);
  });
  document.querySelectorAll("tr[data-team-row]").forEach((row) => setStar(row.cells[row.closest(".season-table") ? 0 : 1], favs.has(row.dataset.teamRow)));
  document.querySelectorAll(".fav-btn[data-fav]").forEach((b) => {
    const on = favs.has(b.dataset.fav);
    b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "★ Seguita" : "☆ Segui";
  });
  const strip = $("fav-strip"), data = $("ff-fav-data");
  if (strip && data) {
    try { strip.innerHTML = favStripHtml(JSON.parse(data.textContent), [...favs]); } catch (e) { strip.innerHTML = ""; }
  }
}

/* ---------- Messaggi brevi ---------- */
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

/* ---------- Condivisione di una partita ---------- */
function shareMatch(btn) {
  const text = btn.dataset.shareText || "", url = location.origin + (btn.dataset.shareUrl || location.pathname);
  const whatsapp = () => window.open("https://wa.me/?text=" + encodeURIComponent(text + " " + url), "_blank", "noopener");
  if (navigator.share) navigator.share({ title: "Fischietto finale", text, url }).catch(() => {});
  else if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text + " " + url).then(() => toast("Link copiato"), whatsapp);
  else whatsapp();
}

/* ---------- Aprire una partita della pagina (link #m-123) ---------- */
function openMatch(id, smooth) {
  const el = document.getElementById(id);
  if (!el) return false;
  if (el.tagName === "DETAILS") el.open = true;
  setTimeout(() => el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" }), 40);
  return true;
}
function openFromHash() {
  const h = location.hash || "";
  if (h.indexOf("#m-") !== 0) return;
  try { openMatch(decodeURIComponent(h.slice(1)), false); } catch (e) { /* hash non valido */ }
}

/* ---------- Partite con orario già passato (dipende dall'ora attuale, quindi qui) ---------- */
function markStaleKickoffs() {
  const now = Date.now();
  document.querySelectorAll("details.match[data-kickoff]").forEach((card) => {
    const t = Date.parse(card.dataset.kickoff);
    if (!Number.isFinite(t) || t > now || card.querySelector(".match-stale-note")) return;
    const pick = card.querySelector("summary .match-pick");
    if (pick) pick.insertAdjacentHTML("afterend", '<div class="match-stale-note">Orario trascorso · risultati live non disponibili</div>');
  });
}

/* ---------- Nomi lunghi: rimpiccioliti invece di spezzati a metà ----------
   Su telefoni stretti "FIORENTINA" o "FISCHIETTO" non entrano nella colonna e il CSS
   (overflow-wrap:anywhere, che evita lo scorrimento orizzontale) li spezzava a metà parola.
   Qui si misura la parola più lunga e si riduce il carattere quanto basta (minimo 12px). */
const FIT_SELECTOR = ".top h1, .feature-team b, .mc-team b, .match-team .team-name, .compare-team .name, " +
  ".vs .side .nm, .played .final .nm, .final-hero .outcome, .tile b";
function fitPad(node, stop) {
  let extra = 0;
  for (let n = node.parentElement; n && n !== stop; n = n.parentElement) {
    const c = getComputedStyle(n);
    extra += (parseFloat(c.paddingLeft) || 0) + (parseFloat(c.paddingRight) || 0) + (parseFloat(c.borderLeftWidth) || 0) + (parseFloat(c.borderRightWidth) || 0);
  }
  return extra;
}
function fitNames(root) {
  (root || document).querySelectorAll(FIT_SELECTOR).forEach((el) => {
    el.style.removeProperty("font-size");
    let box = el;
    while (box && getComputedStyle(box).display === "inline") box = box.parentElement;
    if (!box || !box.clientWidth) return;  // nascosto (scheda chiusa): ci pensa la prossima misura
    const bc = getComputedStyle(box);
    const avail = box.getBoundingClientRect().width - (parseFloat(bc.paddingLeft) || 0) - (parseFloat(bc.paddingRight) || 0) -
      (parseFloat(bc.borderLeftWidth) || 0) - (parseFloat(bc.borderRightWidth) || 0);
    const nodes = [el, ...el.querySelectorAll("*")];
    const setWrap = (on) => nodes.forEach((n) => {
      if (on) { n.style.setProperty("overflow-wrap", "normal", "important"); n.style.setProperty("word-break", "keep-all", "important"); }
      else { n.style.removeProperty("overflow-wrap"); n.style.removeProperty("word-break"); }
    });
    setWrap(true);
    let widest = 0, node;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while ((node = walker.nextNode())) {
      const re = /\S+/g; let m, pad = null;
      while ((m = re.exec(node.data))) {
        const r = document.createRange();
        r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length);
        if (pad === null) pad = fitPad(node, box);
        widest = Math.max(widest, r.getBoundingClientRect().width + pad);
      }
    }
    setWrap(false);
    if (widest > avail) {
      const size = parseFloat(getComputedStyle(el).fontSize) || 16;
      el.style.setProperty("font-size", Math.max(12, Math.floor(size * (avail - 1) / widest * 10) / 10) + "px", "important");
    }
  });
}
function watchNames() {
  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fitNames(document); });
  };
  new MutationObserver((records) => {
    if (records.some((r) => r.type === "childList" || r.attributeName !== "style")) schedule();
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open", "class"] });
  window.addEventListener("resize", schedule);
  document.addEventListener("toggle", schedule, true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  schedule();
}

/* ---------- Barra in basso che si nasconde scorrendo verso il basso ---------- */
function navScroll() {
  let lastY = window.scrollY || 0, ticking = false;
  const update = () => {
    const y = window.scrollY || 0, delta = y - lastY;
    if (Math.abs(delta) > 5) {
      if (y > 120 && delta > 0) document.body.classList.add("nav-scrolling-down");
      else if (delta < 0) document.body.classList.remove("nav-scrolling-down");
    }
    if (y < 60) document.body.classList.remove("nav-scrolling-down");
    lastY = y; ticking = false;
  };
  window.addEventListener("scroll", () => { if (!ticking) { requestAnimationFrame(update); ticking = true; } }, { passive: true });
}

function init() {
  if (redirectLegacyUrl()) return;

  // Installabile su iPhone e Android: le pagine già viste restano disponibili anche senza rete.
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
  /* Senza rete la pagina arriva dalla copia salvata: lo si dice, come faceva il sito attuale. */
  const offline = () => {
    const tags = $("tags"), tag = tags && tags.querySelector(".tag.offline");
    if (navigator.onLine === false && tags && !tag) tags.insertAdjacentHTML("afterbegin", '<span class="tag warn offline">Offline · ultimi dati salvati</span>');
    if (navigator.onLine !== false && tag) tag.remove();
  };
  offline(); window.addEventListener("online", offline); window.addEventListener("offline", offline);

  const select = $("league-select");
  if (select) select.addEventListener("change", () => {
    const opt = select.options[select.selectedIndex];
    if (opt && opt.dataset.href) location.href = opt.dataset.href;
  });

  /* Un solo gestore per i clic su preferiti, condivisione e collegamenti alle partite. */
  document.addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("[data-fav],[data-share],[data-goto-match],[data-open]");
    if (!el) return;
    if (el.hasAttribute("data-fav")) {
      const name = el.getAttribute("data-fav"), now = toggleFav(name);
      toast(now ? "Ora segui " + name : "Non segui più " + name);
    } else if (el.hasAttribute("data-share")) {
      e.preventDefault(); shareMatch(el);
    } else if (el.hasAttribute("data-goto-match")) {
      if (openMatch("m-" + el.getAttribute("data-goto-match"), true)) { e.preventDefault(); history.replaceState(null, "", "#m-" + el.getAttribute("data-goto-match")); }
    } else if (el.hasAttribute("data-open")) {
      if (openMatch(el.getAttribute("data-open"), true)) { e.preventDefault(); history.replaceState(null, "", "#" + el.getAttribute("data-open")); }
    }
  });
  window.addEventListener("hashchange", openFromHash);
  /* Loghi esterni che non si caricano: nascosti (al posto dell'attributo onerror, vietato dalla CSP). */
  document.addEventListener("error", (e) => { if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-hide-on-error")) e.target.hidden = true; }, true);

  decorateFavs();
  markStaleKickoffs();
  openFromHash();
  navScroll();
  watchNames();
  window.FFFit = fitNames;
}

init();
