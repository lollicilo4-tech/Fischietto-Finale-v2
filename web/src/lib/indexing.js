/* Quali pagine chiediamo a Google di indicizzare (30/10/2026, dopo il rifiuto di AdSense per contenuti di
   scarso valore). Le pagine restano tutte raggiungibili dal menu; quelle con poco testo proprio o che sono
   solo strumenti interattivi hanno <meta name="robots" content="noindex"> e non stanno nella sitemap:
   - Più probabili e Le scelte del modello: calcolatori interattivi, poco testo;
   - Live Center e I miei pronostici: si riempiono solo nel browser;
   - Classifica senza tabella (coppe a eliminazione diretta) e Storico con meno di MIN_HISTORY risultati;
   - pagine squadra delle squadre che non sono in una classifica (solo coppa, pochi dati).
   Usate dalle pagine (prop noindex di Base.astro) e dalla sitemap: le due cose non possono divergere. */
export const MIN_HISTORY = 10;
export const NOINDEX_SECTIONS = new Set(["sicure", "schedina"]);

/* data: { turno, storico, classifica } di leagueData(). */
export function sectionIndexable(section, data) {
  if (NOINDEX_SECTIONS.has(section)) return false;
  if (section === "classifica") return !!(data && data.classifica && Array.isArray(data.classifica.table) && data.classifica.table.length);
  if (section === "storico") return !!(data && data.storico && (data.storico.n || 0) >= MIN_HISTORY);
  return true;
}

export function teamIndexable(team, data) {
  const table = (data && data.classifica && data.classifica.table) || [];
  return table.some((r) => r && r.team === team);
}
