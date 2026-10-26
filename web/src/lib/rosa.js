/* "La mia rosa" del fantacalcio: chi visita inserisce i suoi giocatori (ruolo, squadra di Serie A, nome)
   e la pagina Fantacalcio gli dice, per ogni ruolo, chi ha la partita più favorevole e chi mettere capitano.
   Il modello conosce le squadre, non i giocatori: il consiglio di ogni giocatore è quello della sua squadra
   (porta inviolata per portieri e difensori, gol attesi per centrocampisti e attaccanti).
   Tutto resta nel browser (localStorage, chiave ROSA_KEY): nessun account, niente arriva al server.
   Funzioni pure, provate in Node; il DOM è in scripts/rosa.js. Ogni dato nell'HTML passa da esc(). */
import { esc, pc, d2 } from "./core.js";
import { csTier } from "./fanta.js";

export const ROSA_KEY = "ff-fanta-rosa-v1";
export const MAX_PLAYERS = 40;
export const MAX_NAME = 40;
export const ROLES = ["P", "D", "C", "A"];
export const ROLE_NAME = { P: "Portieri", D: "Difensori", C: "Centrocampisti", A: "Attaccanti" };
export const ROLE_ONE = { P: "Portiere", D: "Difensore", C: "Centrocampista", A: "Attaccante" };

export function emptyRosa() { return { v: 1, players: [] }; }
export function parseRosa(text) {
  try {
    const s = JSON.parse(text || "");
    if (s && s.v === 1 && Array.isArray(s.players)) {
      const players = s.players.filter((p) => p && ROLES.includes(p.role) && typeof p.name === "string" && typeof p.team === "string" && p.id != null)
        .slice(0, MAX_PLAYERS).map((p) => ({ id: String(p.id), role: p.role, team: p.team, name: p.name.slice(0, MAX_NAME) }));
      return { v: 1, players };
    }
  } catch (e) { /* dato rovinato: si riparte da zero */ }
  return emptyRosa();
}

const cleanName = (name) => String(name || "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);

/* Aggiunge un giocatore. Ritorna { rosa, error }: error è il motivo in italiano se non si può aggiungere. */
export function addPlayer(rosa, { role, team, name }, teams, now = Date.now()) {
  const n = cleanName(name);
  if (!ROLES.includes(role)) return { rosa, error: "Scegli il ruolo." };
  if (!teams.includes(team)) return { rosa, error: "Scegli la squadra." };
  if (!n) return { rosa, error: "Scrivi il nome del giocatore." };
  if (rosa.players.length >= MAX_PLAYERS) return { rosa, error: "La rosa ha già " + MAX_PLAYERS + " giocatori." };
  const same = rosa.players.find((p) => p.team === team && p.name.toLowerCase() === n.toLowerCase());
  if (same) return { rosa, error: same.name + " è già nella rosa." };
  const id = String(now) + "-" + rosa.players.length;
  return { rosa: { v: 1, players: rosa.players.concat({ id, role, team, name: n }) }, error: null };
}
export const removePlayer = (rosa, id) => ({ v: 1, players: rosa.players.filter((p) => p.id !== String(id)) });

/* Valore di un giocatore nella giornata: porta inviolata (P, D) o gol attesi della squadra (C, A).
   row: la riga della sua squadra in fantaRows(), null se la squadra non gioca più in questo turno. */
const ATTACK_TIER = (x) => (x >= 1.5 ? "easy" : x >= 1.1 ? "mid" : "hard");
export function playerAdvice(p, row) {
  if (!row) return { ...p, row: null, score: -1, tier: "none" };
  const defence = p.role === "P" || p.role === "D";
  return { ...p, row, score: defence ? row.cs : row.xgFor, tier: defence ? csTier(row.cs) : ATTACK_TIER(row.xgFor) };
}

/* Consigli per la rosa: giocatori divisi per ruolo, dal più favorevole; capitano tra centrocampisti e
   attaccanti con più gol attesi (a parità l'attaccante). */
export function rosaAdvice(rosa, rows) {
  const byTeam = new Map((rows || []).map((r) => [r.team, r]));
  const all = rosa.players.map((p) => playerAdvice(p, byTeam.get(p.team) || null));
  const groups = ROLES.map((role) => ({
    role, players: all.filter((p) => p.role === role).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  })).filter((g) => g.players.length);
  const captain = all.filter((p) => (p.role === "A" || p.role === "C") && p.row)
    .sort((a, b) => b.score - a.score || (a.role === "A" ? -1 : 0) - (b.role === "A" ? -1 : 0) || a.name.localeCompare(b.name))[0] || null;
  return { groups, captain, total: all.length };
}

/* ---------- HTML ---------- */
const TIER_TEXT = { easy: "favorevole", mid: "equilibrata", hard: "difficile", none: "non gioca in questo turno" };
function playerRow(p) {
  const r = p.row;
  const detail = r ? (r.home ? "in casa con " : "in trasferta con ") + esc(r.opp) : "partita già iniziata o non in programma";
  const value = !r ? "–" : p.role === "P" || p.role === "D" ? pc(r.cs) + "<small>porta inviolata</small>" : d2(r.xgFor) + "<small>gol attesi</small>";
  return '<li class="rosa-player ' + p.tier + '"><span><b>' + esc(p.name) + '</b><small>' + esc(p.team) + " · " + detail + " · " + TIER_TEXT[p.tier] +
    '</small></span><span class="rosa-value">' + value + '</span><button type="button" class="rosa-remove" data-id="' + esc(p.id) + '" aria-label="' + esc("Togli " + p.name + " dalla rosa") + '">×</button></li>';
}

export function rosaHtml(rosa, rows) {
  const a = rosaAdvice(rosa, rows);
  if (!a.total) return '<p class="lead" style="margin:0">La tua rosa è vuota. Aggiungi i tuoi giocatori qui sotto: per ogni ruolo vedrai chi ha la partita più favorevole in questa giornata.</p>';
  const cap = a.captain
    ? '<div class="rosa-captain"><span>Capitano consigliato</span><b>' + esc(a.captain.name) + "</b><small>" + esc(a.captain.team) + " · " + d2(a.captain.row.xgFor) + " gol attesi</small></div>"
    : "";
  return cap + '<p class="lead" style="margin:0">In ogni ruolo i giocatori sono in ordine di partita più favorevole: schiera partendo dall\'alto.</p>' +
    a.groups.map((g) => '<div class="rosa-group"><h3>' + ROLE_NAME[g.role] + " <small>" + g.players.length + '</small></h3><ul class="rosa-list">' + g.players.map(playerRow).join("") + "</ul></div>").join("") +
    '<p class="rosa-foot"><span>' + a.total + " giocatori · salvati solo su questo dispositivo</span>" + '<button type="button" id="rosa-clear">Svuota rosa</button></p>';
}
