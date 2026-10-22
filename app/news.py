"""Ricerca gratuita di notizie su una partita, per quando Groq non è disponibile.

Il piano gratuito di Gemini non include la ricerca Google: senza articoli Gemini risponde a
memoria e le assenze non sono verificabili. Qui l'app cerca le notizie da sola, con due
fornitori gratuiti, e Gemini si limita a leggere il testo degli articoli trovati.

Ordine: SearXNG (gratuito e illimitato, avviato come container nel workflow; variabile
SEARXNG_URL) e poi Tavily (1.000 ricerche gratis al mese, senza carta; variabile
TAVILY_API_KEY). Se nessuno dei due è configurato non viene cercato nulla.
"""
import os

import httpx

TAVILY_URL = "https://api.tavily.com/search"
TIMEOUT = 15.0
MAX_RESULTS = 6

# Lingua delle ricerche: la Serie A trova più notizie in italiano, il resto in inglese.
_ITALIAN_LEAGUES = {"SA"}


def search_query(fx: dict, league: str | None = None) -> str:
    if league in _ITALIAN_LEAGUES:
        return f"{fx['home']} {fx['away']} indisponibili infortunati squalificati"
    return f"{fx['home']} vs {fx['away']} team news injuries suspensions"


def configured() -> bool:
    return bool(os.getenv("SEARXNG_URL") or os.getenv("TAVILY_API_KEY"))


def _clean(results: list, url_key: str = "url") -> list[dict]:
    out, seen = [], set()
    for item in results or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get(url_key) or "").strip()
        if not url.startswith(("https://", "http://")) or url in seen:
            continue
        seen.add(url)
        out.append({"title": str(item.get("title") or url), "url": url})
        if len(out) >= MAX_RESULTS:
            break
    return out


async def _searxng(client: httpx.AsyncClient, query: str, base_url: str) -> list[dict]:
    params = {"q": query, "format": "json", "categories": "news", "time_range": "week"}
    response = await client.get(base_url.rstrip("/") + "/search", params=params, timeout=TIMEOUT)
    response.raise_for_status()
    results = _clean(response.json().get("results"))
    if len(results) < 2:  # la categoria notizie a volte è vuota: riprova sul web generale
        params.pop("categories")
        response = await client.get(base_url.rstrip("/") + "/search", params=params, timeout=TIMEOUT)
        response.raise_for_status()
        results = _clean(response.json().get("results"))
    return results


async def _tavily(client: httpx.AsyncClient, query: str, key: str) -> list[dict]:
    """Ricerca base (1 credito). Se le notizie degli ultimi giorni sono vuote, un secondo
    tentativo sul web generale dell'ultima settimana (1 credito in più)."""
    headers = {"Authorization": f"Bearer {key}"}
    for body in ({"topic": "news", "days": 3}, {"topic": "general", "time_range": "week"}):
        payload = {"query": query, "search_depth": "basic", "max_results": MAX_RESULTS, **body}
        response = await client.post(TAVILY_URL, json=payload, headers=headers, timeout=TIMEOUT)
        response.raise_for_status()
        results = _clean(response.json().get("results"))
        if results:
            return results
    return []


async def search_news(fx: dict, league: str | None = None,
                      transport: httpx.AsyncBaseTransport | None = None) -> tuple[list[dict], str | None]:
    """Cerca notizie sulla partita. Ritorna (fonti [{title, url}], nome del fornitore usato).

    Non solleva eccezioni: un fornitore che non risponde viene saltato.
    """
    query = search_query(fx, league)
    searxng_url, tavily_key = os.getenv("SEARXNG_URL"), os.getenv("TAVILY_API_KEY")
    async with httpx.AsyncClient(transport=transport) as client:  # transport: solo per i test
        if searxng_url:
            try:
                results = await _searxng(client, query, searxng_url)
                if len(results) >= 2:
                    return results, "searxng"
            except (httpx.HTTPError, ValueError) as exc:
                print(f"[news] SearXNG {fx['home']}-{fx['away']}: {type(exc).__name__}")
        if tavily_key:
            try:
                results = await _tavily(client, query, tavily_key)
                if results:
                    return results, "tavily"
            except (httpx.HTTPError, ValueError) as exc:
                print(f"[news] Tavily {fx['home']}-{fx['away']}: {type(exc).__name__}")
    return [], None
