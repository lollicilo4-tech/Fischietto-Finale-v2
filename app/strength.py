"""Forza delle squadre nelle coppe europee a partire dai campionati nazionali.

Nelle coppe ogni squadra gioca poche partite: stimare attacco e difesa solo da quelle dà
numeri molto incerti. Qui si usa la valutazione che la squadra ha nel proprio campionato,
corretta per il livello del campionato, come punto di partenza ("priore") del modello delle
coppe. Le partite europee poi spostano la stima, come accade già nei campionati.

Il livello dei campionati è fisso e prudente, ispirato al ranking UEFA per nazioni: le
differenze reali tra Premier League e Ligue 1 ci sono, ma con poche partite tra leghe diverse
non si possono stimare in modo affidabile dai dati del sito.
"""
import re
import unicodedata

DOMESTIC = ("SA", "PL", "BL1", "PD", "FL1")
# Livello del campionato: moltiplica l'attacco e divide la difesa della squadra.
LEAGUE_LEVEL = {"PL": 1.10, "PD": 1.06, "SA": 1.05, "BL1": 1.04, "FL1": 0.98}
OTHER_LEVEL = 0.92  # squadre di campionati non coperti (Portogallo, Olanda, Turchia...)
# Copa del Rey: squadre spagnole fuori da LaLiga. Segunda División un gradino sotto, poi tutte le
# categorie dilettanti insieme (Primera e Segunda RFEF, Tercera, regionali): non sappiamo distinguerle.
SEGUNDA_LEVEL = 0.78
AMATEUR_LEVEL = 0.50
# Quanto conta la forza della squadra nel suo campionato, oltre al livello del campionato:
# 0 = solo il livello della lega, 1 = valutazione nazionale piena. Tarato il 22/10/2026 sulle
# 30 partite di Champions già concluse: il livello della lega porta quasi tutto il segnale
# (Brier 0,596 -> 0,545), la valutazione nazionale piena lo peggiorava. Da ricontrollare
# quando lo storico delle coppe sarà più ampio.
DOMESTIC_WEIGHT = 0.3
CUP_PRIOR_K = 16.0  # peso del priore nelle coppe (nei campionati è model.PRIOR_K = 8)

# Nomi diversi tra football-data.org e il CSV di Europa/Conference League.
ALIASES = {
    "lyon": "olympique lyon",
    "rennes": "stade rennais",
    "brighton": "brighton hove",
    "atletico madrid": "atleti",
    "barcelona": "barca",
    "sevilla": "sevilla fc",
    "athletic club": "athletic",
    "athletic bilbao": "athletic",
    "inter milan": "inter",
    "internazionale": "inter",
    "ac milan": "milan",
    "as roma": "roma",
    "paris saint germain": "psg",
    "bayern munich": "bayern",
    "bayern munchen": "bayern",
    "borussia dortmund": "dortmund",
    "bayer leverkusen": "leverkusen",
    "eintracht frankfurt": "frankfurt",
    "manchester city": "man city",
    "manchester united": "man united",
    "tottenham hotspur": "tottenham",
    "newcastle united": "newcastle",
    "nottingham forest": "nottingham",
    "lens": "rc lens",
    # Copa del Rey (nomi del CSV ESPN)
    "celta vigo": "celta",
    "racing santander": "santander",
    "dep a coruna": "deportivo",
    "deportivo la coruna": "deportivo",
    "real oviedo": "oviedo",
    "real mallorca": "mallorca",
}


def _norm(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value).casefold())
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def domestic_ratings(contexts: dict) -> dict:
    """{nome normalizzato: {"name", "att", "def", "league"}} dai contesti dei campionati.

    `contexts` è {codice lega: contesto di data.get_context}. Le valutazioni di ogni campionato
    hanno media 1 al suo interno; qui vengono portate su una scala comune col livello della lega.
    """
    out = {}
    for code, ctx in (contexts or {}).items():
        level = LEAGUE_LEVEL.get(code)
        if not level or not ctx or ctx.get("demo"):
            continue
        for name, rating in (ctx.get("teams") or {}).items():
            if "att" not in rating:
                continue
            out[_norm(name)] = {"name": name, "att": level * rating["att"] ** DOMESTIC_WEIGHT,
                                "def": rating["def"] ** DOMESTIC_WEIGHT / level, "league": code}
    return out


def match_team(name: str, ratings: dict) -> dict | None:
    """Trova la squadra tra i campionati: nome uguale, alias noto, oppure nome contenuto in
    un solo nome di campionato ("Brighton" -> "Brighton Hove"). Meglio nessun abbinamento
    che uno sbagliato."""
    key = _norm(name)
    if key in ratings:
        return ratings[key]
    alias = ALIASES.get(key)
    if alias and alias in ratings:
        return ratings[alias]
    if len(key) >= 4:
        hits = [r for k, r in ratings.items() if f" {key} " in f" {k} "]
        if len(hits) == 1:
            return hits[0]
    return None


def cup_priors(team_names, contexts: dict, fallback_levels: dict | None = None) -> tuple[dict | None, dict]:
    """Priori di attacco e difesa per le squadre di una coppa.

    fallback_levels: per le coppe nazionali ({nome normalizzato con _norm: livello} delle squadre di categorie inferiori note);
    con fallback_levels presente, chi non è né nei nostri campionati né nell'elenco parte da AMATEUR_LEVEL.
    Ritorna (priori o None se non ci sono campionati disponibili, resoconto
    {"matched": n, "total": m, "leagues": [...]}) da pubblicare nel turno.
    """
    names = sorted(set(team_names))
    ratings = domestic_ratings(contexts)
    report = {"matched": 0, "total": len(names), "leagues": sorted({r["league"] for r in ratings.values()})}
    if not ratings:
        return None, report
    priors = {}
    for name in names:
        hit = match_team(name, ratings)
        if hit:
            priors[name] = {"att": hit["att"], "def": hit["def"]}
            report["matched"] += 1
        else:
            level = OTHER_LEVEL if fallback_levels is None else fallback_levels.get(_norm(name), AMATEUR_LEVEL)
            priors[name] = {"att": level, "def": 1 / level}
    return priors, report
