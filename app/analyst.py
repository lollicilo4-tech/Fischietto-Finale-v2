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
    return json.loads(text[a:b + 1])


async def _ask_groq(client, fx: dict, base: dict) -> dict:
    kickoff = fx.get("kickoff") or "prossimo turno"
    user = (
        f"Partita: {fx['home']} (casa) contro {fx['away']} (trasferta), {kickoff}.\n"
        f"Numeri del modello statistico: gol attesi {d1(base['lh'])} - {d1(base['la'])}; "
        f"1 {pc(base['p1'])}, X {pc(base['px'])}, 2 {pc(base['p2'])}.\n\n"
        "Fai una ricerca web mirata alle ultime 72 ore su infortuni, squalifiche, "
        "probabili formazioni, turnover, cambi di allenatore e impegni ravvicinati. "
        "Dai priorità a fonti affidabili e recenti. Non inventare assenze. "
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

    import re
    for url in re.findall(r'https?://[^\s\]\)\}>,]+', text):
        add_url(url)
    try:
        # executed_tools può essere esposto sul messaggio oppure sulla
        # risposta completa, a seconda della versione del client Groq.
        raw_response = resp.model_dump() if hasattr(resp, "model_dump") else {}
        raw_message = message.model_dump() if hasattr(message, "model_dump") else {}
        executed = []
        for container in (raw_response, raw_message):
            if isinstance(container, dict):
                executed.extend(container.get("executed_tools") or [])

        # Alcune versioni annidano i risultati sotto search_results, altre
        # sotto results. Leggiamo solo URL realmente restituiti dal tool.
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

    data = _parse_json(text)
    return {
        "ai": True, "text": str(data.get("spiegazione", "")).strip(),
        "factor_home": _clip(data.get("fattore_gol_casa")), "factor_away": _clip(data.get("fattore_gol_trasferta")),
        "absences_home": [str(x) for x in data.get("assenze_casa", [])][:5],
        "absences_away": [str(x) for x in data.get("assenze_trasferta", [])][:5],
        "sources": sources[:5],
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


async def analyze_all(items: list[dict], teams: dict, use_ai: bool) -> list[dict]:
    """items: [{"fx": fixture, "base": {lh, la, p1, px, p2, ...}}]"""
    if not use_ai:
        return [fallback_analysis(i["fx"], i["base"], teams) for i in items]
    if not os.getenv("GROQ_API_KEY"):
        why = "Chiave GROQ_API_KEY non trovata: l'analisi AI viene sostituita dal fallback statistico."
        return [fallback_analysis(i["fx"], i["base"], teams, why) for i in items]

    _load_persistent_cache()
    from groq import AsyncGroq
    client = AsyncGroq()
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
            if cached_sources:
                return hit[1]
        if rate_limited.is_set():
            return fallback_analysis(fx, item["base"], teams, rate_limit_message)
        async with sem:
            # Un'altra richiesta potrebbe aver già rilevato il limite mentre questa attendeva.
            if rate_limited.is_set():
                return fallback_analysis(fx, item["base"], teams, rate_limit_message)
            try:
                out = None
                for attempt in range(3):
                    try:
                        out = await _ask_groq(client, fx, item["base"])
                        break
                    except Exception as exc:
                        msg = str(exc).lower()
                        transient_tpm = ("429" in msg or "rate limit" in msg) and (
                            "tokens per minute" in msg or "tpm" in msg or "try again in" in msg
                        )
                        if transient_tpm and attempt < 2:
                            # Il 429 TPM è normalmente temporaneo: attendi e riprova.
                            await asyncio.sleep(5 * (attempt + 1))
                            continue
                        raise
                if out is None:
                    raise RuntimeError("Groq non ha restituito un'analisi")
            except Exception as exc:  # rete, JSON non valido, limiti: fallback controllato
                print(f"[analyst] {fx['home']}-{fx['away']}: {exc!r}")
                msg = str(exc).lower()
                if "tokens per day" in msg or "daily" in msg or ("429" in msg and not ("tokens per minute" in msg or "tpm" in msg or "try again in" in msg)):
                    rate_limited.set()
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
