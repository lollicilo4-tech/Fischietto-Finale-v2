"""Scarica il testo delle pagine trovate dall'AI, per verificare le assenze sul contenuto.

Prima la verifica guardava solo titolo e URL delle fonti: quasi nessun titolo contiene insieme
giocatore, squadra e "indisponibile", quindi le correzioni AI venivano sempre annullate.
Qui si legge il testo dell'articolo; il confronto vero e proprio è in analyst.py.

Le pagine vengono scaricate solo quando l'AI segnala almeno un'assenza, con limiti stretti
su numero di pagine, tempo e dimensione.
"""
import asyncio
from html.parser import HTMLParser

import httpx

FETCH_TIMEOUT = 8.0          # secondi per pagina
MAX_BYTES = 800_000          # basta per il corpo di un articolo; il resto viene ignorato
MAX_PAGES = 6                # pagine per partita
MAX_TEXT_CHARS = 80_000      # testo conservato per pagina
USER_AGENT = (
    "Mozilla/5.0 (compatible; FischiettoFinale/2.0; "
    "+https://github.com/lollicilo4-tech/Fischietto-Finale-v2)"
)
_SKIP_TAGS = {"script", "style", "noscript", "svg", "template", "iframe", "head"}
_BLOCK_TAGS = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6",
               "section", "article", "tr", "td", "th", "table", "header", "footer"}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title_parts: list[str] = []
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
        elif tag in _SKIP_TAGS:
            self._skip += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append(" \n ")

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in _SKIP_TAGS and self._skip:
            self._skip -= 1
        elif tag in _BLOCK_TAGS:
            self.parts.append(" \n ")

    def handle_data(self, data):
        if self._in_title:
            self.title_parts.append(data)
        elif not self._skip:
            self.parts.append(data)


def html_to_text(html: str) -> tuple[str, str]:
    """Restituisce (titolo, testo visibile) di una pagina HTML, senza script e stili."""
    parser = _TextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # HTML malformato: tieni quello che è stato letto
        pass
    title = " ".join("".join(parser.title_parts).split())
    # Una riga per blocco (paragrafo, voce di elenco, titoletto): serve a ragionare per frase.
    lines = (" ".join(line.split()) for line in "".join(parser.parts).split("\n"))
    text = "\n".join(line for line in lines if line)
    return title, text[:MAX_TEXT_CHARS]


async def _fetch_one(client: httpx.AsyncClient, url: str) -> dict | None:
    try:
        async with client.stream("GET", url, timeout=FETCH_TIMEOUT) as response:
            if response.status_code != 200:
                return None
            ctype = response.headers.get("content-type", "").lower()
            if ctype and "html" not in ctype and "text" not in ctype:
                return None
            chunks, size = [], 0
            async for chunk in response.aiter_bytes():
                chunks.append(chunk)
                size += len(chunk)
                if size >= MAX_BYTES:
                    break
            raw = b"".join(chunks)[:MAX_BYTES]
            encoding = response.encoding or "utf-8"
            final_url = str(response.url)
    except (httpx.HTTPError, ValueError, OSError):
        return None
    try:
        html = raw.decode(encoding, errors="replace")
    except LookupError:
        html = raw.decode("utf-8", errors="replace")
    title, text = html_to_text(html)
    if not text:
        return None
    return {"url": url, "final_url": final_url, "title": title, "text": text}


async def fetch_pages(sources: list[dict], limit: int = MAX_PAGES) -> list[dict]:
    """Scarica in parallelo il testo di al massimo `limit` fonti http(s).

    Ritorna [{url, final_url, title, text, source_title}] solo per le pagine lette con successo.
    I redirect (es. i link di Google Search grounding) vengono seguiti fino all'articolo vero.
    """
    picked, seen = [], set()
    for source in sources or []:
        url = str(source.get("url", "")).strip()
        if url.startswith(("https://", "http://")) and url not in seen:
            seen.add(url)
            picked.append(source)
        if len(picked) >= limit:
            break
    if not picked:
        return []
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"}
    async with httpx.AsyncClient(follow_redirects=True, headers=headers, max_redirects=5) as client:
        results = await asyncio.gather(*(_fetch_one(client, s["url"]) for s in picked))
    pages = []
    for source, page in zip(picked, results):
        if page:
            page["source_title"] = str(source.get("title") or "")
            pages.append(page)
    return pages
