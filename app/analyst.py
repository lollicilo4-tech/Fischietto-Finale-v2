"""Livello AI: Groq + GPT-OSS con ricerca web legge le notizie (infortuni, squalifiche,
probabili formazioni) e propone due cose, entrambe tracciate nella risposta:

- un fattore di correzione sui gol attesi di ciascuna squadra, limitato a 0,85-1,15
- una spiegazione in italiano basata solo su ciò che ha trovato

I numeri restano al modello statistico: l'AI non inventa probabilità né quote.
"""
import asyncio
import json
import os
import time
import re
import unicodedata
from pathlib import Path

FACTOR_MIN, FACTOR_MAX = 0.85, 1.15
CACHE_SECONDS = 72 * 3600  # allineata alla finestra delle notizie recenti (72 ore)
_cache: dict = {}
PERSIST_PATH = Path(__file__).resolve().parent.parent / "docs" / "ai_cache.json"
ROLE = {"att": "attaccante titolare", "def": "difensore titolare"}

SYSTEM = """Sei l'analista di un'app che spiega come potrebbe andare una partita di calcio.
Cerca sul web notizie recenti (ultime 72 ore) su queste due squadre: infortuni, squalifiche,
probabili formazioni, turnover, cambi di allenatore, impegni ravvicinati.
Usa solo informazioni verificabili in fonti affidabili e recenti. Verifica che ogni giocatore citato appartenga davvero alla rosa della squadra corretta.
Inserisci in "assenze_casa" e "assenze_trasferta" SOLO giocatori confermati indisponibili o squalificati per questa specifica partita da una fonte attendibile.
NON elencare come assente chi è soltanto in dubbio, in recupero, rientrato in gruppo, dato per probabile disponibile o indicato in una notizia vecchia. Se lo stato non è chiaro, ometti il giocatore dall'array e spiega l'incertezza nel testo.
Non dedurre l'assenza dal solo fatto che un giocatore non compaia in una probabile formazione. Non confondere giocatori di squadre diverse, omonimi o notizie riferite a un'altra partita/stagione.
Se non trovi indisponibilità confermate, restituisci array vuoti e fattori 1.0. Non penalizzare una squadra sulla base di voci non verificate. I fattori devono riflettere solo assenze confermate e rilevanti per il ruolo; se l'impatto non è dimostrabile, usa 1.0.
Non citare quote dei bookmaker e non incoraggiare a scommettere.
Rispondi SOLO con un oggetto JSON, senza altro testo, con questi campi:
{"assenze_casa": [str], "assenze_trasferta": [str],
 "fattore_gol_casa": numero tra 0.85 e 1.15, "fattore_gol_trasferta": numero tra 0.85 e 1.15,
 "spiegazione": "3-4 frasi in italiano, chiare, coerenti con i numeri del modello"}
Il fattore moltiplica i gol attesi della squadra: sotto 1 se un'assenza offensiva confermata ne riduce l'attacco; può aumentare moderatamente se l'avversario perde un difensore titolare confermato indisponibile. Non applicare correzioni simmetriche o automatiche senza una motivazione verificata."""


def _clip(x, default=1.0) -> float:
    try:
        return max(FACTOR_MIN, min(FACTOR_MAX, float(x)))
    except (TypeError, ValueError):
        return default


def _norm(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value).casefold())
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


_TEAM_ALIASES = {
    "como 1907": ("como",), "inter": ("inter", "internazionale"),
    "milan": ("milan",), "roma": ("roma",), "napoli": ("napoli",),
    "fiorentina": ("fiorentina",), "genoa": ("genoa",),
    "juventus": ("juventus",), "cagliari": ("cagliari",),
    "frosinone": ("frosinone",), "parma": ("parma",),
    "lecce": ("lecce",), "bologna": ("bologna",),
    "lazio": ("lazio",), "monza": ("monza",),
    "sassuolo": ("sassuolo",), "atalanta": ("atalanta",),
    "venezia fc": ("venezia",), "torino": ("torino",),
    "udinese": ("udinese",),
}
_CONFIRMED_TERMS = (
    "indisponibile", "indisponibili", "squalificato", "squalificati",
    "squalifica", "salta la partita", "saltera la partita", "out per",
    "non ci sara", "non sara disponibile", "lesione muscolare",
    "frattura", "operato", "operazione", "stop di", "stop per",
    "ruled out", "suspended", "will miss", "out of",
)
_UNCERTAIN_TERMS = (
    "in dubbio", "dubbio", "in recupero", "recupero in corso",
    "pronto a giocare", "pronto per giocare", "rientrato in gruppo",
    "probabile disponibile", "potrebbe giocare", "da valutare",
    "doubtful", "questionable", "expected to return",
)



def _relevant_sources(sources: list[dict], fx: dict) -> list[dict]:
    """Mantiene solo fonti che citano almeno una delle squadre della partita."""
    aliases = []
    for team in (fx.get("home", ""), fx.get("away", "")):
        normalized = _norm(team)
        aliases.extend(_TEAM_ALIASES.get(normalized, (normalized,)))
    # Match su parole/frasi normalizzate, evitando che nomi brevi appaiano
    # come sottostringhe casuali dentro parole più lunghe.
    aliases = [a for a in (_norm(x) for x in aliases) if a]
    relevant = []
    seen_urls = set()
    # Pagine utili per verificare notizie; escludi aggregatori e pronostici
    # anche quando citano correttamente entrambe le squadre.
    excluded = (
        "prediction", "pronostico", "pronostici", "forecast", "betting",
        "tipps", "odds", "quote", "live score", "scores today", "h2h",
        "head to head", "predicted lineups", "predicted lineup",
        "prediccion", "confronto diretto", "risultato in diretta",
        "punteggio in diretta", "cronaca e statistiche", "in diretta",
        "lineups", "lineup", "calendario", "risultati",
        "probabili formazioni", "partita calcio risultati", "statistiche",
    )
    # I social e le pagine di soli risultati non sono una base sufficiente
    # per presentare una fonte come notizia verificata.
    low_quality_hosts = (
        "instagram.com", "facebook.com", "m.facebook.com", "tiktok.com",
        "x.com", "twitter.com", "reddit.com", "pinterest.com",
    )
    for source in sources or []:
        url = str(source.get("url", "")).strip()
        raw_title = str(source.get("title") or url)
        title = _norm(raw_title)
        normalized_url = _norm(url)
        evidence = f" {title} {normalized_url} "
        host = url.split("//", 1)[-1].split("/", 1)[0].lower().split(":", 1)[0]
        title_host = raw_title.lower().split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0]
        is_low_quality = any(
            candidate == domain or candidate.endswith("." + domain)
            for candidate in (host, title_host) for domain in low_quality_hosts
        )
        is_generic = any(term in f" {title} {normalized_url} " for term in excluded)
        # Non pretendere che il nome della squadra compaia nel titolo/URL:
        # alcune fonti grounded pertinenti non lo riportano letteralmente.
        if not url.startswith(("https://", "http://")) or url in seen_urls or is_generic or is_low_quality:
            continue
        relevant.append({"title": raw_title, "url": url})
        seen_urls.add(url)
        if len(relevant) >= 4:
            break
    return relevant


def _source_confirms_absence(name: str, team: str, sources: list[dict]) -> bool:
    """Richiede una fonte raccolta che associ esplicitamente giocatore, squadra e indisponibilità."""
    tokens = _norm(name).split()
    # Nelle parentesi spesso c'è solo il motivo, non il nome del calciatore.
    name_tokens = [t for t in tokens if t not in {"infortunio", "lesione", "muscolare", "frattura"}]
    if not name_tokens:
        return False
    player_key = name_tokens[-1]
    team_norm = _norm(team)
    aliases = _TEAM_ALIASES.get(team_norm, (team_norm,))
    for source in sources or []:
        title = _norm(source.get("title", ""))
        url = _norm(source.get("url", ""))
        evidence = f"{title} {url}"
        player_mentioned = player_key in evidence.split()
        team_mentioned = any(alias in evidence for alias in aliases)
        confirmed = any(term in evidence for term in _CONFIRMED_TERMS)
        uncertain = any(term in evidence for term in _UNCERTAIN_TERMS)
        if player_mentioned and team_mentioned and confirmed and not uncertain:
            return True
    return False


def _validate_absences(data: dict, fx: dict, sources: list[dict]) -> dict:
    """Fail closed: se una sola assenza non è corroborata, neutralizza tutti gli aggiustamenti AI."""
    home = data.get("assenze_casa", [])
    away = data.get("assenze_trasferta", [])
    if not isinstance(home, list) or not isinstance(away, list):
        return {"absences_home": [], "absences_away": [], "factor_home": 1.0,
                "factor_away": 1.0, "validation_warning": "Formato assenze non valido; fattori neutrali."}
    candidates = [(str(x), fx["home"]) for x in home] + [(str(x), fx["away"]) for x in away]
    # I termini di incertezza non possono essere promossi a indisponibilità confermata.
    explanation = _norm(data.get("spiegazione", ""))
    has_uncertainty = any(term in explanation for term in _UNCERTAIN_TERMS) or any(
        any(term in _norm(name) for term in _UNCERTAIN_TERMS) for name, _ in candidates
    )
    verified = bool(candidates) and all(_source_confirms_absence(name, team, sources) for name, team in candidates)
    if not candidates:
        return {"absences_home": [], "absences_away": [], "factor_home": 1.0,
                "factor_away": 1.0, "validation_warning": None}
    if has_uncertainty or not verified:
        return {
            "absences_home": [], "absences_away": [],
            "factor_home": 1.0, "factor_away": 1.0,
            "validation_warning": "Assenze non confermate automaticamente: elenchi svuotati e fattori AI neutralizzati.",
        }
    return {
        "absences_home": [str(x) for x in home][:5],
        "absences_away": [str(x) for x in away][:5],
        "factor_home": _clip(data.get("fattore_gol_casa")),
        "factor_away": _clip(data.get("fattore_gol_trasferta")),
        "validation_warning": None,
    }


def pc(p: float) -> str:
    return f"{round(p * 100)}%"


def d1(x: float) -> str:
    return f"{x:.1f}".replace(".", ",")


def fallback_analysis(fx: dict, base: dict, teams: dict, reason: str | None = None) -> dict:
    """Senza AI: assenze dai dati (solo demo) e testo a regole."""
    H, A = teams.get(fx["home"], {}), teams.get(fx["away"], {})
    fh = fa = 1.0
    for x in H.get("abs", []):
        fh *= 0.93 if x == "att" else 1.0
        fa *= 1.06 if x == "def" else 1.0
    for x in A.get("abs", []):
        fa *= 0.93 if x == "att" else 1.0
        fh *= 1.06 if x == "def" else 1.0
    parts = [f"Il modello stima {d1(base['lh'])} gol per {fx['home']} e {d1(base['la'])} per {fx['away']}."]
    if base["p1"] >= 0.5:
        parts.append(f"{fx['home']} parte favorita ({pc(base['p1'])}), anche grazie al fattore campo.")
    elif base["p2"] >= 0.5:
        parts.append(f"{fx['away']} è favorita anche in trasferta ({pc(base['p2'])}).")
    else:
        parts.append("Partita aperta: nessun esito supera il 50%.")
    if base["px"] >= 0.28:
        parts.append(f"Il pareggio resta credibile ({pc(base['px'])}).")
    return {
        "ai": False, "text": " ".join(parts), "factor_home": fh, "factor_away": fa,
        "absences_home": [ROLE[x] for x in H.get("abs", [])],
        "absences_away": [ROLE[x] for x in A.get("abs", [])], "sources": [], "reason": reason,
    }


def _parse_json(text: str) -> dict:
    a, b = text.find("{"), text.rfind("}")
    if a < 0 or b < a:
        raise ValueError("risposta senza JSON")
    data = json.loads(text[a:b + 1])
    if not isinstance(data, dict):
        raise ValueError("la risposta JSON non è un oggetto")
    return data


def _extract_response_text(response) -> str:
    """Recupera testo da response.text o dalle parti candidate dello SDK Gemini."""
    raw_text = getattr(response, "text", None) or ""
    if raw_text:
        return raw_text
    chunks = []
    for candidate in (getattr(response, "candidates", None) or []):
        content = getattr(candidate, "content", None)
        for part in (getattr(content, "parts", None) or []):
            part_text = getattr(part, "text", None)
            if part_text:
                chunks.append(part_text)
    return "\n".join(chunks)



def _read_field(value, *names):
    """Legge campi da oggetti SDK o dizionari, compatibile con versioni diverse."""
    for name in names:
        if isinstance(value, dict) and value.get(name) is not None:
            return value[name]
        result = getattr(value, name, None)
        if result is not None:
            return result
    return None


def _extract_grounding_sources(response) -> list[dict]:
    """Estrae le fonti Google Search da grounding metadata e le deduplica."""
    sources, seen = [], set()
    candidates = _read_field(response, "candidates") or []
    for candidate in candidates:
        metadata = _read_field(candidate, "grounding_metadata", "groundingMetadata")
        chunks = _read_field(metadata, "grounding_chunks", "groundingChunks") or []
        for chunk in chunks:
            web = _read_field(chunk, "web")
            url = _read_field(web, "uri", "url")
            title = _read_field(web, "title")
            if isinstance(url, str) and url.startswith(("https://", "http://")) and url not in seen:
                seen.add(url)
                sources.append({"title": str(title or url), "url": url})
    return sources


def _is_groq_daily_limit(error: Exception) -> bool:
    """Riconosce il limite giornaliero senza confonderlo con un TPM momentaneo."""
    msg = str(error).lower()
    return "tokens per day" in msg or "daily token" in msg


async def _ask_groq(client, fx: dict, base: dict) -> dict:
    kickoff = fx.get("kickoff") or "prossimo turno"
    user = (
        f"Partita: {fx['home']} (casa) contro {fx['away']} (trasferta), {kickoff}.\n"
        f"Numeri del modello statistico: gol attesi {d1(base['lh'])} - {d1(base['la'])}; "
        f"1 {pc(base['p1'])}, X {pc(base['px'])}, 2 {pc(base['p2'])}.\n\n"
        "Fai una ricerca web mirata alle ultime 72 ore su questa partita e queste due squadre. "
        "Usa solo pagine realmente pertinenti a questa partita, preferibilmente fonti ufficiali "
        "dei club/competizioni o testate sportive affidabili. Scarta pagine di risultati generici, "
        "live score, pronostici generici e articoli riferiti a date/stagioni diverse. "
        "Non inventare assenze e non trattare i risultati della ricerca come prova se il titolo "
        "o la pagina non confermano chiaramente la notizia. "
        "Rispondi SOLO con un oggetto JSON valido, senza markdown e senza testo fuori dal JSON. "
        "Campi obbligatori: assenze_casa (array di stringhe), assenze_trasferta (array di stringhe), "
        "fattore_gol_casa (numero 0.85-1.15), fattore_gol_trasferta (numero 0.85-1.15), "
        "spiegazione (3-4 frasi in italiano). Non citare quote bookmaker e non incoraggiare a scommettere. "
        "Il fattore moltiplica i gol attesi: sotto 1 se le assenze riducono l'attacco; "
        "se manca un difensore importante, può aumentare il fattore dell'avversaria. "
        "Se non trovi elementi rilevanti, usa fattore 1.0 e dichiaralo nella spiegazione."
    )
    resp = await client.chat.completions.create(
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user},
        ],
        max_completion_tokens=650,
        temperature=0.2,
        reasoning_effort="low",
        tool_choice="required",
        tools=[{"type": "browser_search"}],
    )
    message = resp.choices[0].message
    text = getattr(message, "content", "") or ""

    # Groq restituisce le fonti della ricerca; raccogliamo gli URL in modo
    # tollerante rispetto alle versioni dell'SDK, senza richiedere structured output.
    sources = []
    seen = set()
    def add_url(url, title=None):
        if not url or url in seen or not str(url).startswith(("http://", "https://")):
            return
        seen.add(url)
        sources.append({"title": title or url, "url": url})

    try:
        # Preferisci i risultati strutturati di browser_search: contengono titoli
        # reali. Estrarre prima gli URL dal testo del modello produceva link senza
        # titolo e poteva riempire il limite prima di leggere le fonti effettive.
        raw_response = resp.model_dump() if hasattr(resp, "model_dump") else {}
        raw_message = message.model_dump() if hasattr(message, "model_dump") else {}
        executed = []
        for container in (raw_response, raw_message):
            if isinstance(container, dict):
                executed.extend(container.get("executed_tools") or [])

        def collect_results(value):
            if isinstance(value, dict):
                url = value.get("url") or value.get("link")
                title = value.get("title") or value.get("name")
                if isinstance(url, str) and url.startswith(("http://", "https://")):
                    add_url(url, title)
                for child in value.values():
                    if isinstance(child, (dict, list)):
                        collect_results(child)
            elif isinstance(value, list):
                for child in value:
                    collect_results(child)

        collect_results(executed)
    except Exception as exc:
        print(f"[analyst] {fx['home']}-{fx['away']}: impossibile leggere le fonti browser_search ({type(exc).__name__})")

    # Solo se l'SDK non espone risultati strutturati, usa i link nel testo.
    if not sources:
        import re
        for url in re.findall(r'https?://[^\s\]\)\}>,]+', text):
            add_url(url)

    # Scarta risultati che non citano nessuna delle due squadre: meglio nessun link
    # che riferimenti di cronaca locale o articoli su eventi non correlati.
    sources = _relevant_sources(sources, fx)
    data = _parse_json(text)
    checked = _validate_absences(data, fx, sources)
    explanation = str(data.get("spiegazione", "")).strip()
    if checked["validation_warning"]:
        # Non aggiungere soltanto un avviso al testo originale: potrebbe
        # continuare ad affermare come certe assenze che la validazione ha
        # appena rifiutato. In caso di mancata conferma, sostituisci l'intera
        # spiegazione con un testo neutro coerente con i fattori effettivi.
        explanation = (
            "Non ho trovato conferme sufficientemente solide sulle indisponibilità "
            "per modificare i gol attesi. Per prudenza, non applico correzioni per assenze: "
            "le probabilità restano quelle del modello statistico. L'analisi delle notizie "
            "non sostituisce i dati statistici e non implica che le squadre siano al completo."
        )
    print(f"[analyst] provider=groq match={fx['home']}-{fx['away']} sources={len(sources)}")
    return {
        "ai": True, "text": explanation,
        "factor_home": checked["factor_home"], "factor_away": checked["factor_away"],
        "absences_home": checked["absences_home"],
        "absences_away": checked["absences_away"],
        "sources": sources, "provider": "groq",
        "validation_version": 4,
    }


async def _ask_gemini(fx: dict, base: dict) -> dict:
    """Provider di riserva: Gemini con ricerca Google."""
    from google import genai
    from google.genai import types

    kickoff = fx.get("kickoff") or "prossimo turno"
    prompt = (
        f"Partita: {fx['home']} (casa) contro {fx['away']} (trasferta), {kickoff}.\n"
        f"Gol attesi {d1(base['lh'])}-{d1(base['la'])}; 1 {pc(base['p1'])}, "
        f"X {pc(base['px'])}, 2 {pc(base['p2'])}.\n"
        "Cerca notizie recenti e attendibili sulle due squadre, soprattutto indisponibilità "
        "confermate e squalifiche. Scarta pronostici, quote e risultati generici. Non inventare "
        "assenze. Se non trovi conferme, usa array vuoti e fattori 1.0. I fattori devono essere "
        "tra 0.85 e 1.15 e giustificati da assenze confermate. Rispondi solo con JSON valido: "
        "assenze_casa (array), assenze_trasferta (array), fattore_gol_casa (numero), "
        "fattore_gol_trasferta (numero), spiegazione (3-4 frasi in italiano)."
    )
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    response = await client.aio.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM,
            temperature=0.2,
            max_output_tokens=650,
            # Evita la modalità JSON vincolata: in questa configurazione impediva
            # di ricevere i grounding_metadata necessari a mostrare fonti verificabili.
            tools=[types.Tool(google_search=types.GoogleSearch())],
        ),
    )
    # Alcune risposte con grounding espongono il testo solo nelle parti candidate.
    data = _parse_json(_extract_response_text(response))
    raw_sources = _extract_grounding_sources(response)
    sources = _relevant_sources(raw_sources, fx)
    candidates = _read_field(response, "candidates") or []
    metadata = _read_field(candidates[0], "grounding_metadata", "groundingMetadata") if candidates else None
    queries = _read_field(metadata, "web_search_queries", "webSearchQueries") or []
    print("[analyst] Gemini grounding match=" + fx["home"] + "-" + fx["away"]
          + " metadata=" + ("yes" if metadata is not None else "no")
          + " raw_sources=" + str(len(raw_sources))
          + " relevant_sources=" + str(len(sources))
          + " search_queries=" + str(len(queries)))
    checked = _validate_absences(data, fx, sources)
    explanation = str(data.get("spiegazione", "")).strip()
    if checked["validation_warning"]:
        explanation = (
            "Non ho trovato conferme sufficientemente solide sulle indisponibilità "
            "per modificare i gol attesi. Per prudenza, non applico correzioni per assenze: "
            "le probabilità restano quelle del modello statistico. L'analisi delle notizie "
            "non sostituisce i dati statistici e non implica che le squadre siano al completo."
        )
    print(f"[analyst] provider=gemini match={fx['home']}-{fx['away']} sources={len(sources)}")
    return {
        "ai": True, "text": explanation,
        "factor_home": checked["factor_home"], "factor_away": checked["factor_away"],
        "absences_home": checked["absences_home"], "absences_away": checked["absences_away"],
        "sources": sources, "provider": "gemini", "validation_version": 8,
    }


def _load_persistent_cache() -> None:
    try:
        raw = json.loads(PERSIST_PATH.read_text(encoding="utf-8"))
        now = time.time()
        for key, value in raw.items():
            if isinstance(value, dict) and now - float(value.get("saved_at", 0)) < CACHE_SECONDS:
                _cache[key] = (float(value["saved_at"]), value["analysis"])
    except (OSError, ValueError, TypeError, KeyError):
        pass


def _save_persistent_cache() -> None:
    try:
        PERSIST_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            key: {"saved_at": stamp, "analysis": value}
            for key, (stamp, value) in _cache.items()
            if time.time() - stamp < CACHE_SECONDS
        }
        PERSIST_PATH.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _normalized_provider(analysis: dict) -> str | None:
    """Recupera il provider da cache legacy che salvavano la versione ma non il nome."""
    if not isinstance(analysis, dict):
        return None
    provider = analysis.get("provider")
    if provider in ("groq", "gemini"):
        return provider
    version = analysis.get("validation_version")
    if version == 8:
        return "gemini"
    if version in (1, 2, 3, 4, 5, 6):
        return "groq"
    return None


def _cache_is_compatible(analysis: dict) -> bool:
    """Accetta le versioni validate e riconosce le cache legacy prive del provider."""
    if not isinstance(analysis, dict):
        return False
    version = analysis.get("validation_version")
    provider = _normalized_provider(analysis)
    if provider == "gemini":
        return version == 8
    if provider == "groq":
        return version in (1, 2, 3, 4, 5, 6)
    return False


def _cache_needs_source_refresh(analysis: dict) -> bool:
    """Rinnova le vecchie cache prive di fonti, ma conserva la cache Gemini v8 corrente."""
    if not isinstance(analysis, dict):
        return True
    if analysis.get("sources"):
        return False
    return not (
        analysis.get("provider") == "gemini"
        and analysis.get("validation_version") == 8
    )


async def analyze_all(items: list[dict], teams: dict, use_ai: bool) -> list[dict]:
    """items: [{"fx": fixture, "base": {lh, la, p1, px, p2, ...}}]"""
    if not use_ai:
        return [fallback_analysis(i["fx"], i["base"], teams) for i in items]
    if not os.getenv("GROQ_API_KEY") and not os.getenv("GEMINI_API_KEY"):
        why = "Nessun provider AI configurato: analisi statistica disponibile."
        return [fallback_analysis(i["fx"], i["base"], teams, why) for i in items]

    _load_persistent_cache()
    from groq import AsyncGroq
    client = AsyncGroq() if os.getenv('GROQ_API_KEY') else None
    # Limita il carico simultaneo per evitare picchi TPM sul piano on-demand.
    sem = asyncio.Semaphore(2)
    rate_limited = asyncio.Event()
    rate_limit_message = "Limite Groq temporaneamente raggiunto. L’analisi statistica resta disponibile; l’AI riproverà al prossimo aggiornamento."

    async def one(item):
        fx = item["fx"]
        hit = _cache.get(fx["id"])
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            # Le vecchie cache senza fonti non devono impedire una nuova
            # ricerca web dopo la correzione dell'estrazione.
            cached_sources = hit[1].get("sources") if isinstance(hit[1], dict) else None
            # Conserva le analisi validate per provider: Gemini v8 e le versioni
            # Groq storiche compatibili. Evita nuove chiamate AI non necessarie.
            cache_compatible = _cache_is_compatible(hit[1])
            refresh_sources = _cache_needs_source_refresh(hit[1])
            if isinstance(hit[1], dict) and cache_compatible and not refresh_sources:
                cached = dict(hit[1])
                filtered_sources = _relevant_sources(cached.get("sources") or [], fx)
                # Filtra la cache localmente: non richiede nuove chiamate a Groq.
                # Se nessuna fonte supera i criteri, mostra l'analisi senza link.
                cached["sources"] = filtered_sources
                cached["provider"] = _normalized_provider(cached)
                if "Assenze non confermate automaticamente" in str(cached.get("text", "")):
                    cached["text"] = (
                        "Non ho trovato conferme sufficientemente solide sulle indisponibilità "
                        "per modificare i gol attesi. Per prudenza, non applico correzioni per assenze: "
                        "le probabilità restano quelle del modello statistico. L'analisi delle notizie "
                        "non sostituisce i dati statistici e non implica che le squadre siano al completo."
                    )
                    cached["absences_home"] = []
                    cached["absences_away"] = []
                    cached["factor_home"] = 1.0
                    cached["factor_away"] = 1.0
                cached["validation_version"] = 8 if cached.get("provider") == "gemini" else 4
                _cache[fx["id"]] = (hit[0], cached)
                return cached
        if rate_limited.is_set():
            if os.getenv("GEMINI_API_KEY"):
                try:
                    out = await _ask_gemini(fx, item["base"])
                    _cache[fx["id"]] = (time.time(), out)
                    return out
                except Exception as exc:
                    print(f"[analyst] Gemini fallback {fx['home']}-{fx['away']}: {exc!r}")
            return fallback_analysis(fx, item["base"], teams, rate_limit_message)
        async with sem:
            # Un'altra richiesta potrebbe aver già rilevato il limite mentre questa attende.
            if rate_limited.is_set():
                if os.getenv("GEMINI_API_KEY"):
                    try:
                        out = await _ask_gemini(fx, item["base"])
                        _cache[fx["id"]] = (time.time(), out)
                        return out
                    except Exception as exc:
                        print(f"[analyst] Gemini fallback {fx['home']}-{fx['away']}: {exc!r}")
                return fallback_analysis(fx, item["base"], teams, rate_limit_message)
            try:
                out = None
                if client is not None and not rate_limited.is_set():
                    for attempt in range(3):
                        try:
                            out = await _ask_groq(client, fx, item["base"])
                            break
                        except Exception as exc:
                            msg = str(exc).lower()
                            daily_quota = _is_groq_daily_limit(exc)
                            transient_tpm = not daily_quota and ("429" in msg or "rate limit" in msg) and (
                                "tokens per minute" in msg or "tpm" in msg or "try again in" in msg
                            )
                            if transient_tpm and attempt < 2:
                                await asyncio.sleep(5 * (attempt + 1))
                                continue
                            raise
                if out is None and os.getenv("GEMINI_API_KEY"):
                    out = await _ask_gemini(fx, item["base"])
                if out is None:
                    raise RuntimeError("Nessun provider AI disponibile")
            except Exception as exc:  # errore Groq: prova Gemini prima del fallback statistico
                print(f"[analyst] {fx['home']}-{fx['away']}: {exc!r}")
                # Segnala subito il limite giornaliero: le richieste in coda saltano Groq.
                daily_limit = _is_groq_daily_limit(exc) or (
                    "429" in str(exc) and not any(t in str(exc).lower() for t in ("tokens per minute", "tpm", "try again in"))
                )
                if daily_limit:
                    rate_limited.set()
                if client is not None and os.getenv("GEMINI_API_KEY"):
                    try:
                        out = await _ask_gemini(fx, item["base"])
                        _cache[fx["id"]] = (time.time(), out)
                        return out
                    except Exception as gemini_exc:
                        print(f"[analyst] Gemini fallback {fx['home']}-{fx['away']}: {gemini_exc!r}")
                msg = str(exc).lower()
                if daily_limit:
                    why = rate_limit_message
                elif "429" in msg or "rate limit" in msg:
                    why = "Limite temporaneo Groq dopo i tentativi. L’analisi statistica resta disponibile."
                else:
                    why = f"Errore AI ({type(exc).__name__}). L’analisi statistica resta disponibile."
                return fallback_analysis(fx, item["base"], teams, why)
        _cache[fx["id"]] = (time.time(), out)
        return out

    results = await asyncio.gather(*(one(i) for i in items))
    _save_persistent_cache()
    return results
