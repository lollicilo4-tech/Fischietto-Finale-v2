"""Fonte dati: football-data.org (piano gratuito, Serie A = "SA").

Senza chiave FOOTBALL_DATA_KEY parte la modalità demo con dati inventati.
"""
import asyncio
import csv
import io
import os
import time

import httpx

BASE = "https://api.football-data.org/v4"
COMPETITION = os.getenv("COMPETITION", "SA")
_cache: dict = {}
CACHE_SECONDS = 30 * 60  # il piano gratuito ha 10 richieste al minuto
MIN_REQUEST_INTERVAL = 6.2  # margine di sicurezza sotto le 10 richieste/minuto
_last_request_at = 0.0

# --- Demo ------------------------------------------------------------------
DEMO_TEAMS = {
    "Inter": dict(hgf=2.3, hga=0.7, agf=1.9, aga=0.9, form="VVVNV", abs=[]),
    "Napoli": dict(hgf=1.9, hga=0.8, agf=1.5, aga=1.0, form="VVNVV", abs=["def"]),
    "Milan": dict(hgf=1.7, hga=0.9, agf=1.4, aga=1.0, form="VNVVP", abs=[]),
    "Juventus": dict(hgf=1.6, hga=0.8, agf=1.3, aga=0.9, form="NVNVV", abs=["att"]),
    "Atalanta": dict(hgf=2.0, hga=1.0, agf=1.7, aga=1.2, form="VVPVN", abs=[]),
    "Roma": dict(hgf=1.5, hga=0.8, agf=1.2, aga=1.0, form="VNVPV", abs=[]),
    "Lazio": dict(hgf=1.5, hga=1.1, agf=1.2, aga=1.3, form="PVNVP", abs=[]),
    "Fiorentina": dict(hgf=1.4, hga=1.1, agf=1.1, aga=1.3, form="NPVNN", abs=[]),
    "Bologna": dict(hgf=1.4, hga=1.0, agf=1.1, aga=1.2, form="VPNVN", abs=["att"]),
    "Torino": dict(hgf=1.2, hga=1.1, agf=0.9, aga=1.4, form="NPNVP", abs=[]),
    "Genoa": dict(hgf=1.1, hga=1.2, agf=0.9, aga=1.5, form="PNPNV", abs=[]),
    "Udinese": dict(hgf=1.2, hga=1.3, agf=0.8, aga=1.5, form="PPNVP", abs=[]),
    "Como": dict(hgf=1.5, hga=1.2, agf=1.2, aga=1.4, form="VNPVN", abs=[]),
    "Cagliari": dict(hgf=1.1, hga=1.3, agf=0.8, aga=1.6, form="PPNPV", abs=[]),
    "Parma": dict(hgf=1.2, hga=1.3, agf=0.9, aga=1.6, form="NPPVN", abs=[]),
    "Lecce": dict(hgf=1.0, hga=1.2, agf=0.7, aga=1.5, form="NPNPP", abs=["att"]),
    "Verona": dict(hgf=1.1, hga=1.5, agf=0.8, aga=1.8, form="PPPNP", abs=[]),
    "Sassuolo": dict(hgf=1.4, hga=1.6, agf=1.1, aga=1.7, form="VPPVN", abs=[]),
    "Pisa": dict(hgf=1.0, hga=1.4, agf=0.7, aga=1.7, form="PNPPN", abs=[]),
    "Cremonese": dict(hgf=1.0, hga=1.3, agf=0.8, aga=1.6, form="NPPNP", abs=["def"]),
}
DEMO_FIXTURES = [
    ("Inter", "Genoa", "Sab 15:00"), ("Napoli", "Torino", "Sab 18:00"), ("Milan", "Udinese", "Sab 20:45"),
    ("Juventus", "Fiorentina", "Dom 12:30"), ("Atalanta", "Cagliari", "Dom 15:00"), ("Roma", "Bologna", "Dom 18:00"),
    ("Lazio", "Como", "Dom 20:45"), ("Parma", "Lecce", "Dom 15:00"), ("Verona", "Sassuolo", "Dom 15:00"),
    ("Pisa", "Cremonese", "Dom 15:00"),
]


def demo_context() -> dict:
    n = len(DEMO_TEAMS)
    return {
        "demo": True,
        "teams": DEMO_TEAMS,
        "avg_h": sum(t["hgf"] for t in DEMO_TEAMS.values()) / n,
        "avg_a": sum(t["agf"] for t in DEMO_TEAMS.values()) / n,
        "fixtures": [
            {"id": f"demo-{i}", "home": h, "away": a, "kickoff": None, "label": w}
            for i, (h, a, w) in enumerate(DEMO_FIXTURES)
        ],
        "finished": [],
    }


# --- Dati reali ------------------------------------------------------------
def has_key() -> bool:
    return bool(os.getenv("FOOTBALL_DATA_KEY"))


async def _get(client: httpx.AsyncClient, path: str, params: dict) -> dict:
    global _last_request_at
    wait = MIN_REQUEST_INTERVAL - (time.monotonic() - _last_request_at)
    if wait > 0:
        await asyncio.sleep(wait)
    _last_request_at = time.monotonic()
    r = await client.get(f"{BASE}{path}", params=params,
                         headers={"X-Auth-Token": os.environ["FOOTBALL_DATA_KEY"]}, timeout=20)
    r.raise_for_status()
    return r.json()


def _name(t: dict) -> str:
    return t.get("shortName") or t["name"]


def cached_contexts() -> dict:
    """Contesti di tutti i campionati già scaricati in questa esecuzione (per gli stemmi, app/crests.py)."""
    return {code: entry["v"] for code, entry in _cache.items()}


def _crests(teams: list) -> dict:
    """{nome della squadra: indirizzo dello stemma} dalle squadre di football-data.org (app/crests.py)."""
    out = {}
    for t in teams:
        if isinstance(t, dict) and (t.get("shortName") or t.get("name")) and isinstance(t.get("crest"), str):
            out.setdefault(_name(t), t["crest"])
    return out


def _standings(st: dict) -> list[dict]:
    tables = [t for t in st.get("standings", []) if t.get("type") == "TOTAL"] or st.get("standings", [])
    if not tables:
        return []
    # Mantieni l'ordine della classifica restituita dal provider, ma assegna posizioni
    # sequenziali: nelle competizioni UEFA il rank condiviso può produrre posizioni duplicate
    # e lasciare buchi (es. 20, 20, 22), mentre la tabella pubblicata richiede 36 posizioni.
    return [{"pos": index, "team": _name(r["team"]), "team_id": r["team"].get("id"),
             "pg": r["playedGames"], "w": r["won"], "d": r["draw"], "l": r["lost"],
             "gf": r["goalsFor"], "ga": r["goalsAgainst"], "pts": r["points"]}
            for index, r in enumerate(tables[0]["table"], start=1)]


def _reconcile_standings(standings: list[dict], finished: list[dict]) -> list[dict]:
    """Riconcilia i totali usando gli ID stabili; usa i nomi solo come fallback.

    Si procede solo se ogni partita conclusa si abbina a squadre presenti nella
    classifica e tutte le squadre hanno almeno una partita nel campione. In caso
    di dati incompleti o non coerenti, si conserva la classifica del provider.
    """
    if not standings or not finished:
        return standings

    use_ids = (
        all(row.get("team_id") is not None for row in standings)
        and all(match.get("home_id") is not None and match.get("away_id") is not None
                for match in finished)
    )
    team_keys = [row.get("team_id") if use_ids else row.get("team") for row in standings]
    if not all(key is not None and key != "" for key in team_keys) or len(set(team_keys)) != len(team_keys):
        return standings

    display_names = {
        (row.get("team_id") if use_ids else row.get("team")): row.get("team")
        for row in standings
    }
    stats = {
        key: {"pos": 0, "team": display_names[key],
              **({"team_id": key} if use_ids else {}),
              "pg": 0, "w": 0, "d": 0, "l": 0, "gf": 0, "ga": 0, "pts": 0}
        for key in team_keys
    }

    for match in finished:
        home = match.get("home_id") if use_ids else match.get("home")
        away = match.get("away_id") if use_ids else match.get("away")
        if home not in stats or away not in stats or home == away:
            return standings
        try:
            hg, ag = int(match["hg"]), int(match["ag"])
        except (KeyError, TypeError, ValueError):
            return standings
        if hg < 0 or ag < 0:
            return standings

        h, a = stats[home], stats[away]
        h["pg"] += 1
        a["pg"] += 1
        h["gf"] += hg
        h["ga"] += ag
        a["gf"] += ag
        a["ga"] += hg
        if hg > ag:
            h["w"] += 1
            h["pts"] += 3
            a["l"] += 1
        elif hg < ag:
            a["w"] += 1
            a["pts"] += 3
            h["l"] += 1
        else:
            h["d"] += 1
            a["d"] += 1
            h["pts"] += 1
            a["pts"] += 1

    if any(row["pg"] == 0 for row in stats.values()):
        return standings

    fields = ("pg", "w", "d", "l", "gf", "ga", "pts")
    provider_by_key = {
        (row.get("team_id") if use_ids else row.get("team")): row
        for row in standings
    }
    if all(all(provider_by_key[key].get(field) == stats[key][field] for field in fields)
           for key in team_keys):
        return standings

    # Ordinamento per punti e criteri generali; a parità esatta conserva
    # l'ordine ufficiale del provider, che può riflettere scontri diretti.
    ordered = sorted(
        stats.values(),
        key=lambda row: (-row["pts"], -(row["gf"] - row["ga"]), -row["gf"]),
    )
    for position, row in enumerate(ordered, start=1):
        row["pos"] = position
    return ordered


def _select_upcoming_round(matches: list[dict], now=None, finished_ids: set[str] | None = None) -> tuple[int | None, list[dict]]:
    """Seleziona il turno corrente/imminente, ignorando gare passate ancora marcate programmate.

    Le API possono restituire insieme gare in corso e gare future di più giornate.
    Prima si dà priorità alla giornata con incontri IN_PLAY/PAUSED; in assenza di
    incontri attivi si considerano solo i kickoff non trascorsi. Questo evita che
    un recupero rinviato con stato obsoleto prevalga sulla prossima giornata.
    """
    from datetime import datetime, timedelta, timezone

    now = now or datetime.now(timezone.utc)
    active_statuses = {"IN_PLAY", "PAUSED"}
    # Un kickoff più vecchio di 4 ore non è più una partita live credibile:
    # alcuni calendari mantengono IN_PLAY/PAUSED anche dopo il fischio finale.
    max_active_age = timedelta(hours=4)

    def kickoff(match: dict) -> datetime:
        return datetime.fromisoformat(match["utcDate"].replace("Z", "+00:00"))

    finished_ids = {str(mid) for mid in (finished_ids or set())}
    # La risposta del calendario può essere temporaneamente incoerente con quella FINISHED.
    # Un ID con risultato finale completo non deve mai tornare tra le partite da giocare.
    eligible = [m for m in matches if str(m.get("id", "")) not in finished_ids]
    ordered = sorted(eligible, key=kickoff)
    if not ordered:
        return None, []

    active = [
        match for match in ordered
        if str(match.get("status", "")).upper() in active_statuses
        and kickoff(match) >= now - max_active_age
    ]
    if active:
        active_rounds = {m["matchday"] for m in active if m.get("matchday") is not None}
        if active_rounds:
            rounds = {
                day: [m for m in ordered if m.get("matchday") == day
                      and (kickoff(m) >= now or (
                          str(m.get("status", "")).upper() in active_statuses
                          and kickoff(m) >= now - max_active_age
                      ))]
                for day in active_rounds
            }
            matchday = min(
                active_rounds,
                key=lambda day: (-sum(1 for m in active if m.get("matchday") == day),
                                 min(kickoff(m) for m in rounds[day])),
            )
            return matchday, sorted(rounds[matchday], key=kickoff)

    upcoming = [m for m in ordered if kickoff(m) >= now]
    if not upcoming:
        return None, []

    first_date = kickoff(upcoming[0])
    cutoff = first_date + timedelta(days=10)
    near = [m for m in upcoming if kickoff(m) <= cutoff]
    near_rounds: dict[int, list[dict]] = {}
    for match in near:
        matchday = match.get("matchday")
        if matchday is not None:
            near_rounds.setdefault(matchday, []).append(match)
    if not near_rounds:
        return None, []

    # Prefer the earliest genuine round (2+ fixtures) over a lone postponed
    # fixture from an older matchday.
    multi_fixture_rounds = {
        day: fixtures for day, fixtures in near_rounds.items() if len(fixtures) >= 2
    }
    candidates = multi_fixture_rounds or near_rounds
    matchday, fixtures = min(
        candidates.items(),
        key=lambda item: min(kickoff(m) for m in item[1]),
    )
    return matchday, sorted(fixtures, key=kickoff)


# Stati di football-data.org con il risultato finale. Durante la partita (IN_PLAY, PAUSED) il campo
# score.fullTime contiene il punteggio del momento, non quello finale.
FINAL_STATUSES = {"FINISHED", "AWARDED"}


def _final_matches(matches: list[dict]) -> list[dict]:
    """Solo le partite davvero finite: il loro punteggio può diventare un risultato dello storico.
    (Fino al 28/10/2026 entravano anche le partite in corso, con il punteggio parziale: per esempio
    PSG-Lione salvata 0-0 invece di 2-0.)"""
    return [m for m in matches if m.get("status") in FINAL_STATUSES]


def _finished_source_matches(*groups: list[dict]) -> list[dict]:
    """Partite già iniziate con un punteggio, dai feed risultati e calendario (ID una volta sola).

    Serve a scegliere il prossimo turno: una partita in corso non è più "in programma". Il punteggio
    di una partita IN_PLAY/PAUSED è parziale: per i risultati si usa _final_matches().
    """
    by_id = {}
    for group in groups:
        for match in group:
            if not isinstance(match, dict) or match.get("id") is None:
                continue
            score = match.get("score")
            full_time = score.get("fullTime") if isinstance(score, dict) else None
            if not isinstance(full_time, dict):
                continue
            if full_time.get("home") is None or full_time.get("away") is None:
                continue
            by_id.setdefault(str(match["id"]), match)
    return list(by_id.values())


def _missing_upcoming_matchdays(finished_matches: list[dict], selected_matchday: int | None) -> list[int]:
    """Individua giornate intermedie mancanti tra l'ultimo turno concluso e quello selezionato.

    Conta una giornata come conclusa solo quando almeno una partita ha un risultato
    completo; se il turno selezionato salta una giornata intermedia, il chiamante
    deve verificarla esplicitamente prima di pubblicare.
    """
    if selected_matchday is None:
        return []

    completed_matchdays = set()
    for match in finished_matches:
        matchday = match.get("matchday")
        score = match.get("score") or {}
        full_time = score.get("fullTime") or {}
        if (
            matchday is not None
            and full_time.get("home") is not None
            and full_time.get("away") is not None
        ):
            completed_matchdays.add(int(matchday))

    if not completed_matchdays:
        return []

    latest_completed = max(completed_matchdays)
    if selected_matchday <= latest_completed + 1:
        return []
    return list(range(latest_completed + 1, int(selected_matchday)))


def _recovered_upcoming_round(
    matches: list[dict],
    matchday: int,
    now=None,
    finished_ids: set[str] | None = None,
) -> list[dict]:
    """Restituisce un turno recuperato solo se contiene almeno due gare ancora pertinenti."""
    from datetime import datetime, timedelta, timezone

    now = now or datetime.now(timezone.utc)
    finished_ids = {str(mid) for mid in (finished_ids or set())}
    active_statuses = {"IN_PLAY", "PAUSED"}
    max_active_age = timedelta(hours=4)
    candidates = []
    for match in matches:
        if match.get("matchday") != matchday or str(match.get("id", "")) in finished_ids:
            continue
        status = str(match.get("status", "")).upper()
        kickoff = datetime.fromisoformat(match["utcDate"].replace("Z", "+00:00"))
        if kickoff >= now or (status in active_statuses and kickoff >= now - max_active_age):
            candidates.append(match)

    # Una singola gara rinviata non deve prevalere su un turno futuro completo.
    if len(candidates) < 2:
        return []
    return sorted(
        candidates,
        key=lambda match: datetime.fromisoformat(match["utcDate"].replace("Z", "+00:00")),
    )



# --- Coppe: forza delle squadre dai campionati nazionali ---------------------
CUPS = {"CL", "EL", "UECL", "CDR"}
# Coppe a eliminazione diretta: niente classifica, niente simulazione di fine stagione.
KNOCKOUT = {"CDR"}


class NoUpcomingRound(RuntimeError):
    """Nessun turno in programma nel calendario. Per una coppa a eliminazione diretta è normale tra
    un turno e il sorteggio del successivo: generate.py la salta senza segnalare un errore."""
POINTS_STAGES = {"REGULAR_SEASON", "LEAGUE_STAGE"}  # fasi che assegnano punti in classifica
LEAGUE_PHASE_MATCHDAYS = {"EL": 8, "UECL": 6}       # giornate della fase a girone unico (CSV)


def _cached_domestic_contexts() -> dict:
    """Contesti dei campionati già scaricati in questa esecuzione (nessuna chiamata in più).
    generate.py elabora i campionati prima delle coppe apposta."""
    from . import strength
    now = time.time()
    return {code: entry["v"] for code, entry in _cache.items()
            if code in strength.DOMESTIC and now - entry["t"] < CACHE_SECONDS}


def _cup_model(finished: list[dict], previous: list[dict], fixtures: list[dict],
               fallback_levels: dict | None = None) -> tuple[dict, float, float, dict]:
    """Modello di una coppa che parte dalla forza nazionale delle squadre (vedi app/strength.py).
    fallback_levels: livello delle squadre fuori dai nostri campionati (Copa del Rey: Segunda e dilettanti)."""
    from . import model, strength
    names = {m[k] for m in finished + previous for k in ("home", "away")} | \
            {f[k] for f in fixtures for k in ("home", "away")}
    priors, report = strength.cup_priors(names, _cached_domestic_contexts(), fallback_levels=fallback_levels)
    teams, avg_h, avg_a = model.build_teams(finished, previous, priors=priors,
                                            prior_k=strength.CUP_PRIOR_K if priors else None)
    for name in names - set(teams):  # squadre senza partite giocate: si parte dal priore
        if priors and name in priors:
            teams[name] = {"att": priors[name]["att"], "def": priors[name]["def"], "form": ""}
    return teams, avg_h, avg_a, report


def _knockout_model(finished: list[dict], fixtures: list[dict], fallback_levels: dict | None) -> tuple[dict, float, float, dict]:
    """Coppa nazionale a eliminazione diretta (Copa del Rey): ogni squadra gioca una partita per turno e
    i primi turni sono tra dilettanti. Stimare la forza da quelle partite riporterebbe i dilettanti alla
    media (1,0) e li metterebbe alla pari con LaLiga, quindi qui la forza è solo il punto di partenza:
    LaLiga dal campionato, Segunda e dilettanti da livelli fissi (app/strength.py). Gol medi di LaLiga."""
    from . import model, strength
    names = {f[k] for f in fixtures for k in ("home", "away")}
    domestic = _cached_domestic_contexts()
    priors, report = strength.cup_priors(names, domestic, fallback_levels=fallback_levels or {})
    forms = model.build_teams(finished)[0] if finished else {}
    ratings = strength.domestic_ratings(domestic)
    teams = {}
    for name in names:
        p = (priors or {}).get(name) or {"att": strength.AMATEUR_LEVEL, "def": 1 / strength.AMATEUR_LEVEL}
        # known: la forza viene da un nostro campionato (LaLiga); altrimenti è un livello fisso stimato.
        teams[name] = {"att": p["att"], "def": p["def"], "form": (forms.get(name) or {}).get("form", ""),
                       "known": strength.match_team(name, ratings) is not None}
    pd_ctx = domestic.get("PD") or {}
    avg_h = pd_ctx.get("avg_h") or (sum(m["hg"] for m in finished) / len(finished) if finished else 1.5)
    avg_a = pd_ctx.get("avg_a") or (sum(m["ag"] for m in finished) / len(finished) if finished else 1.2)
    report["knockout"] = True
    return teams, avg_h, avg_a, report


# --- Competizioni UEFA senza copertura nel piano gratuito football-data.org ---
OPEN_MATCHDAY_LEAGUES = {
    "EL": ("UEFA_1_europa-league", "UEFA Europa League"),
    "UECL": ("UEFA_1_conference-league", "UEFA Conference League"),
    "CDR": ("ESP_CUP_copa-del-rey", "Copa del Rey"),
}
# Copa del Rey: le squadre di Segunda (dal CSV della Segunda División) partono più forti dei dilettanti.
SEGUNDA_FOLDER = "ESP_2_segunda-division"


def _same_team(a: set[str], b: set[str]) -> bool:
    """Stessa squadra se le parole distintive del nome più corto stanno tutte nell'altro
    ("paso" in "paso"; "rayo vallecano" non è "rayo majadahonda")."""
    return bool(a and b) and (a <= b or b <= a)


def _dedupe_cup_fixtures(rows: list[dict]) -> list[dict]:
    """Il CSV della Copa del Rey a volte ha la stessa partita due volte, da due fonti con nomi diversi
    ("Atl. Paso - Cordoba" senza orario e "Atlético Paso - Córdoba" alle 21:00). Una squadra gioca una
    sola volta al giorno: due righe dello stesso giorno con la stessa squadra nella stessa posizione
    (casa con casa, o trasferta con trasferta) sono la stessa partita, e resta quella con l'orario.
    Parole comuni come "Atlético" o "Real" non contano."""
    from . import strength
    generic = {"atletico", "real", "sporting", "club", "deportivo", "ciudad", "union", "racing", "cultural",
               "gimnastica", "sociedad", "academy", "recreativo", "unionistas", "juventud", "balompie"}

    def words(name: str) -> set[str]:
        return {w for w in strength._norm(name).split() if len(w) >= 4 and w not in generic}

    kept: list[dict] = []
    for row in sorted(rows, key=lambda r: (not (r.get("time") or "").strip())):
        home, away = words(row.get("home", "")), words(row.get("away", ""))
        if any(k.get("date") == row.get("date") and (_same_team(words(k.get("home", "")), home) or _same_team(words(k.get("away", "")), away))
               for k in kept):
            continue
        kept.append(row)
    return kept
OPEN_MATCHDAY_BASE = "https://raw.githubusercontent.com/oladeeayo/open-matchday/master/data"


async def _open_matchday_csv(client: httpx.AsyncClient, path: str) -> str:
    response = await client.get(path, timeout=20)
    response.raise_for_status()
    return response.text


def _parse_open_matchday_rows(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def _open_match_id(competition: str, row: dict) -> str:
    return "-".join((competition, str(row.get("gw", "")), str(row.get("date", "")),
                     str(row.get("home", "")), str(row.get("away", ""))))


def _open_matchday_standings(finished: list[dict]) -> list[dict]:
    teams = {}
    for match in finished:
        for name in (match["home"], match["away"]):
            teams.setdefault(name, {"pos": 0, "team": name, "pg": 0, "w": 0, "d": 0,
                                    "l": 0, "gf": 0, "ga": 0, "pts": 0})
    return _reconcile_standings(list(teams.values()), finished)


async def _open_matchday_context(competition: str) -> dict:
    """Load UEFA league-phase results and fixtures from the free, keyless CSV mirror.

    This is deliberately separate from football-data.org: EL/UECL are not included
    in that provider's free-tier coverage. If either CSV is unavailable or malformed,
    raise and let the generator keep the previously published payloads intact.
    """
    folder, _label = OPEN_MATCHDAY_LEAGUES[competition]
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)

    def _kickoff_utc(date: str, time: str | None) -> str:
        # Il CSV usa orari CET fissi (UTC+1), non UTC e non l'ora legale locale.
        raw = datetime.fromisoformat(f"{date}T{time or '00:00'}:00")
        cet = timezone(timedelta(hours=1))
        return raw.replace(tzinfo=cet).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    season_start = now.year if now.month >= 7 else now.year - 1
    season_tag = f"{season_start % 100:02d}{(season_start + 1) % 100:02d}"
    base = f"{OPEN_MATCHDAY_BASE}/{folder}"
    async with httpx.AsyncClient(follow_redirects=True) as client:
        results_text, fixtures_text = await asyncio.gather(
            _open_matchday_csv(client, f"{base}/results_{season_tag}.csv"),
            _open_matchday_csv(client, f"{base}/fixtures_{season_tag}.csv"),
        )

    result_rows = _parse_open_matchday_rows(results_text)
    fixture_rows = _parse_open_matchday_rows(fixtures_text)
    fallback_levels = None
    if competition in KNOCKOUT:
        fixture_rows = _dedupe_cup_fixtures(fixture_rows)
        fallback_levels = await _segunda_levels(base.rsplit("/", 1)[0], season_tag)
    if competition in KNOCKOUT and result_rows and not fixture_rows:
        raise NoUpcomingRound(f"Nessuna partita in calendario per {competition}.")
    if not result_rows or not fixture_rows:
        raise RuntimeError(f"Dataset vuoto per {competition}; aggiornamento annullato.")

    finished = []
    for row in result_rows:
        try:
            hg, ag = int(row["ft_home"]), int(row["ft_away"])
            date = row["date"]
            home, away = row["home"].strip(), row["away"].strip()
            if not home or not away:
                continue
            kickoff = _kickoff_utc(date, row.get("time"))
            datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
            finished.append({"id": _open_match_id(competition, row), "date": kickoff,
                             "home": home, "away": away, "hg": hg, "ag": ag})
        except (KeyError, TypeError, ValueError):
            continue
    if not finished:
        raise RuntimeError(f"Nessun risultato UEFA valido per {competition}; aggiornamento annullato.")

    upcoming = []
    for row in fixture_rows:
        try:
            home, away = row["home"].strip(), row["away"].strip()
            date = row["date"]
            kickoff = _kickoff_utc(date, row.get("time"))
            parsed = datetime.fromisoformat(kickoff.replace("Z", "+00:00"))
            if not home or not away or parsed < now:
                continue
            upcoming.append({"id": _open_match_id(competition, row), "utcDate": kickoff,
                             # Coppa a eliminazione diretta: il turno è quello dei prossimi 10 giorni,
                             # il numero "gw" del CSV non è affidabile (righe dello stesso turno con 1 e 4).
                             "matchday": 1 if competition in KNOCKOUT else int(row["gw"]), "status": "SCHEDULED",
                             "homeTeam": {"name": home, "shortName": home},
                             "awayTeam": {"name": away, "shortName": away}})
        except (KeyError, TypeError, ValueError):
            continue
    finished_ids = {match["id"] for match in finished}
    matchday, next_round = _select_upcoming_round(upcoming, now=now, finished_ids=finished_ids)
    if not next_round:
        raise NoUpcomingRound(f"Nessuna prossima giornata valida per {competition}; aggiornamento annullato.")

    fixtures = [{"id": match["id"], "home": _name(match["homeTeam"]),
                 "away": _name(match["awayTeam"]), "kickoff": match["utcDate"], "label": None}
                for match in next_round]
    from . import model
    if competition in KNOCKOUT:
        teams, avg_h, avg_a, cup_prior = _knockout_model(finished, fixtures, fallback_levels)
    else:
        teams, avg_h, avg_a, cup_prior = _cup_model(finished, [], fixtures, fallback_levels)
    if competition in KNOCKOUT:
        # Eliminazione diretta: niente classifica né partite "rimanenti" da simulare.
        standings, remaining = [], []
    else:
        standings = _open_matchday_standings(finished)
        # Solo le giornate della fase a girone unico (le eventuali righe successive sono eliminazione diretta).
        remaining = [{"id": m["id"], "home": _name(m["homeTeam"]), "away": _name(m["awayTeam"]),
                      "kickoff": m["utcDate"], "matchday": m["matchday"]} for m in upcoming
                     if m["matchday"] <= LEAGUE_PHASE_MATCHDAYS.get(competition, 8)]
    # Il modello della prima versione (solo confronto) non ha senso con i soli turni tra dilettanti.
    simple = None if competition in KNOCKOUT else model.build_teams_simple(finished)
    return {"demo": False, "teams_simple": simple, "remaining": remaining,
            "teams": teams, "avg_h": avg_h, "avg_a": avg_a, "cup_prior": cup_prior,
            "rho": model.fit_rho(finished, [], teams, avg_h, avg_a), "fixtures": fixtures,
            "finished": finished, "matchday": matchday, "previous": [],
            "standings": standings}


async def _segunda_levels(base: str, season_tag: str) -> dict:
    """{nome normalizzato: livello} per le squadre di Segunda División (dal suo CSV dei risultati).
    Se il file non si legge, nessun livello in più: tutte le squadre fuori da LaLiga partono come dilettanti."""
    from . import strength
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            text = await _open_matchday_csv(client, f"{base}/{SEGUNDA_FOLDER}/results_{season_tag}.csv")
    except httpx.HTTPError:
        return {}
    names = {r.get(k, "").strip() for r in _parse_open_matchday_rows(text) for k in ("home", "away")}
    return {strength._norm(name): strength.SEGUNDA_LEVEL for name in names if name}


async def real_context(competition: str | None = None) -> dict:
    from . import model
    competition = competition or COMPETITION
    if competition in OPEN_MATCHDAY_LEAGUES:
        return await _open_matchday_context(competition)

    async with httpx.AsyncClient() as client:
        fin = await _get(client, f"/competitions/{competition}/matches", {"status": "FINISHED"})
        sch = await _get(client, f"/competitions/{competition}/matches", {"status": "SCHEDULED,TIMED,IN_PLAY,PAUSED"})
        previous = []
        try:  # stagione scorsa: serve a non partire da zero nelle prime giornate
            first = min(m["utcDate"] for m in sch["matches"]) if sch["matches"] else None
            if first:
                y = int(first[:4]) - (1 if int(first[5:7]) < 7 else 0)
                prev = await _get(client, f"/competitions/{competition}/matches", {"season": y - 1, "status": "FINISHED"})
                previous = [{"id": str(m["id"]), "date": m["utcDate"], "home": _name(m["homeTeam"]),
                             "away": _name(m["awayTeam"]), "hg": m["score"]["fullTime"]["home"],
                             "ag": m["score"]["fullTime"]["away"]}
                            for m in prev["matches"] if m["score"]["fullTime"]["home"] is not None]
        except (httpx.HTTPError, KeyError, ValueError):
            previous = []
        try:  # la classifica è un di più: se manca, il resto funziona lo stesso
            st = await _get(client, f"/competitions/{competition}/standings", {})
        except httpx.HTTPError:
            st = {}

        # Non pubblicare un turno futuro se tra gli ultimi risultati e il turno
        # selezionato manca una giornata intermedia: recuperala esplicitamente
        # dall'API e interrompi la generazione se non è possibile verificarla.
        # Il feed calendario può contenere già il risultato finale prima che il feed
        # FINISHED lo includa. Usalo per escludere ID conclusi e aggiornare storico/classifica.
        finished_raw = _finished_source_matches(fin.get("matches", []), sch.get("matches", []))
        finished_ids_for_selection = {str(m["id"]) for m in finished_raw}
        matchday, next_round = _select_upcoming_round(
            sch.get("matches", []), finished_ids=finished_ids_for_selection
        )
        missing_matchdays = _missing_upcoming_matchdays(finished_raw, matchday)
        for missing_day in missing_matchdays:
            try:
                recovered_response = await _get(
                    client,
                    f"/competitions/{competition}/matches",
                    {"matchday": missing_day, "status": "SCHEDULED,TIMED,IN_PLAY,PAUSED"},
                )
            except httpx.HTTPError as exc:
                raise RuntimeError(
                    f"Impossibile verificare la giornata {missing_day} di {competition}; "
                    "aggiornamento annullato per evitare di pubblicare un turno successivo errato."
                ) from exc

            recovered = _recovered_upcoming_round(
                recovered_response.get("matches", []),
                missing_day,
                finished_ids=finished_ids_for_selection,
            )
            if not recovered:
                raise RuntimeError(
                    f"La giornata {missing_day} di {competition} risulta mancante, ma l'API "
                    "non ha restituito almeno due partite future valide; aggiornamento annullato."
                )
            next_round = recovered
            matchday = missing_day
            break

    finished = [
        {"id": str(m["id"]), "date": m["utcDate"], "home": _name(m["homeTeam"]), "away": _name(m["awayTeam"]),
         "home_id": m["homeTeam"].get("id"), "away_id": m["awayTeam"].get("id"),
         "hg": m["score"]["fullTime"]["home"], "ag": m["score"]["fullTime"]["away"]}
        for m in _final_matches(finished_raw)
    ]
    if not finished:
        raise RuntimeError("Nessuna partita giocata: il modello ha bisogno di almeno qualche giornata.")
    if not next_round:
        raise RuntimeError("Nessuna partita in programma.")
    fixtures = [
        {"id": str(m["id"]), "home": _name(m["homeTeam"]), "away": _name(m["awayTeam"]),
         "kickoff": m["utcDate"], "label": None}
        for m in next_round
    ]
    cup_prior = None
    if competition in CUPS:
        teams, avg_h, avg_a, cup_prior = _cup_model(finished, previous, fixtures)
    else:
        teams, avg_h, avg_a = model.build_teams(finished, previous)
    simple = model.build_teams_simple(finished)
    # Tutte le partite ancora da giocare (per la simulazione di fine stagione). Le gare a
    # eliminazione con squadre non ancora note non hanno nome e vengono escluse.
    # Solo stagione regolare / fase a girone unico: spareggi e eliminazione diretta non danno punti.
    remaining = [
        {"id": str(m.get("id", "")), "home": _name(m["homeTeam"]), "away": _name(m["awayTeam"]),
         "kickoff": m.get("utcDate"), "matchday": m.get("matchday")}
        for m in sch.get("matches", [])
        if str(m.get("id", "")) not in finished_ids_for_selection
        and m.get("stage", "REGULAR_SEASON") in POINTS_STAGES
        and (m.get("homeTeam") or {}).get("name") and (m.get("awayTeam") or {}).get("name")
    ]
    crests = _crests([m.get(k) for m in fin.get("matches", []) + sch.get("matches", []) for k in ("homeTeam", "awayTeam")] +
                     [r.get("team") for t in st.get("standings", []) for r in t.get("table", [])])
    return {"demo": False, "teams_simple": simple, "teams": teams, "avg_h": avg_h, "avg_a": avg_a,
            "cup_prior": cup_prior, "remaining": remaining, "crests": crests,
            "rho": model.fit_rho(finished, previous, teams, avg_h, avg_a), "fixtures": fixtures, "finished": finished, "matchday": matchday,
            "previous": previous,
            "standings": _reconcile_standings(_standings(st), finished)}


# 100 marcatori invece di 20 (29/10/2026): servono al fantacalcio, che stima per ogni giocatore la
# probabilità di segnare; con 20 nomi metà delle squadre restava senza giocatori. È sempre una sola
# richiesta. Il sito ne mostra 20 nella classifica marcatori.
SCORERS_LIMIT = 100

# Ruolo del giocatore secondo football-data.org (player.section o player.position, in inglese):
# P portiere, D difensore, C centrocampista, A attaccante. Ruolo sconosciuto: None.
_ROLE_WORDS = (("goalkeeper", "P"), ("keeper", "P"), ("defence", "D"), ("defender", "D"), ("back", "D"),
               ("midfield", "C"), ("offence", "A"), ("attack", "A"), ("forward", "A"), ("striker", "A"),
               ("winger", "A"), ("wing", "A"))


def _role(player: dict) -> str | None:
    for key in ("section", "position"):
        text = str(player.get(key) or "").lower()
        for word, role in _ROLE_WORDS:
            if word in text:
                return role
    return None


def _scorers(payload: dict) -> list[dict]:
    """Capocannonieri di football-data.org: solo i campi mostrati dal sito, numeri interi o None."""
    def num(v):
        return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
    out = []
    for s in (payload or {}).get("scorers") or []:
        player, team = s.get("player") or {}, s.get("team") or {}
        goals = num(s.get("goals"))
        if not player.get("name") or not (team.get("shortName") or team.get("name")) or goals is None:
            continue
        out.append({"player": str(player["name"]), "team": _name(team), "goals": goals,
                    "assists": num(s.get("assists")), "penalties": num(s.get("penalties")),
                    "played": num(s.get("playedMatches")), "role": _role(player)})
    return sorted(out, key=lambda x: (-x["goals"], -(x["assists"] or 0), x["played"] or 0, x["player"]))[:SCORERS_LIMIT]


async def get_scorers(competition: str) -> list[dict]:
    """Classifica marcatori (una richiesta, piano gratuito di football-data.org). Le coppe con dati da
    CSV non ce l'hanno; se la richiesta fallisce la classifica marcatori resta vuota, il resto no."""
    if competition in OPEN_MATCHDAY_LEAGUES or not has_key():
        return []
    try:
        async with httpx.AsyncClient() as client:
            payload = await _get(client, f"/competitions/{competition}/scorers", {"limit": SCORERS_LIMIT})
    except Exception as exc:  # i marcatori sono un di più: un errore non deve fermare la classifica
        print(f"[scorers] {competition}: non disponibile ({type(exc).__name__})")
        return []
    return _scorers(payload)


async def get_context(competition: str | None = None) -> dict:
    competition = competition or COMPETITION
    if competition in OPEN_MATCHDAY_LEAGUES:
        cached = _cache.get(competition)
        if cached and time.time() - cached["t"] < CACHE_SECONDS:
            return cached["v"]
        ctx = await _open_matchday_context(competition)
        _cache[competition] = {"t": time.time(), "v": ctx}
        return ctx
    if not has_key():
        return demo_context()
    cached = _cache.get(competition)
    if cached and time.time() - cached["t"] < CACHE_SECONDS:
        return cached["v"]
    ctx = await real_context(competition)
    _cache[competition] = {"t": time.time(), "v": ctx}
    return ctx
