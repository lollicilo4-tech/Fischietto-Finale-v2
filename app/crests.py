"""Stemmi delle squadre, serviti dal sito stesso.

football-data.org dà per ogni squadra l'indirizzo dello stemma (crests.football-data.org). Durante
"Aggiorna pronostici" gli stemmi che mancano vengono scaricati in docs/crests/ e l'elenco
squadra -> file va in docs/crests.json; il sito (web/) li trasforma in piccoli PNG al build e li
pubblica come immagini proprie. Così i visitatori non contattano football-data.org e un file
scaricato non viene mai mostrato così com'è (anche gli SVG diventano PNG).

Regole di sicurezza: solo https sul dominio crests.football-data.org, niente reindirizzamenti,
al massimo 300 KB, solo PNG o SVG controllati dai primi byte, nome del file ricavato dall'indirizzo
(hash), mai dal contenuto. Gli errori non fermano l'aggiornamento: lo stemma manca e basta.
"""
import asyncio
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from . import strength

CREST_HOST = "crests.football-data.org"
MAX_BYTES = 300_000
MAX_DOWNLOADS = 250        # per esecuzione: il resto alla prossima
CONCURRENCY = 6
EXTENSIONS = (".png", ".svg")


def allowed_url(url) -> bool:
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return (parts.scheme == "https" and parts.hostname == CREST_HOST and parts.port is None
            and not parts.username and not parts.password and parts.path.lower().endswith(EXTENSIONS))


def file_stem(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


# Stesse regole del job "pubblica" (.github/scripts/apply_generated.py): niente che esegua codice o carichi altro.
SVG_FORBIDDEN = re.compile(rb"<script|<foreignobject|<iframe|<embed|<object|javascript:|\son[a-z]+\s*=|"
                           rb"(?:xlink:)?href\s*=\s*[\"'](?!#)|@import|url\(\s*['\"]?(?!#)", re.IGNORECASE)


def kind_of(content: bytes, content_type: str) -> str | None:
    """".png" o ".svg" se il contenuto è davvero un'immagine di quel tipo, altrimenti None."""
    ctype = (content_type or "").split(";")[0].strip().lower()
    if content.startswith(b"\x89PNG\r\n\x1a\n") and ctype in ("image/png", ""):
        return ".png"
    head = content[:4096].lstrip().lower()
    if ctype in ("image/svg+xml", "") and (head.startswith(b"<?xml") or head.startswith(b"<svg") or head.startswith(b"<!--")) \
            and b"<svg" in head and not SVG_FORBIDDEN.search(content):
        try:
            content.decode("utf-8")
        except UnicodeDecodeError:
            return None
        return ".svg"
    return None


def team_names(payloads: dict) -> dict:
    """{campionato: squadre mostrate dal sito} da turno (partite e prossime giornate), classifica e marcatori."""
    out = {}
    for code, (turno, _storico, classifica) in payloads.items():
        names = set()
        for m in (turno or {}).get("matches") or []:
            names.update((m.get("home"), m.get("away")))
        for r in (turno or {}).get("next_rounds") or []:
            for m in r.get("matches") or []:
                names.update((m.get("home"), m.get("away")))
        for row in (classifica or {}).get("table") or []:
            names.add(row.get("team"))
        for s in (classifica or {}).get("scorers") or []:
            names.add(s.get("team"))
        out[code] = {n for n in names if isinstance(n, str) and n}
    return out


def assign(names: dict, contexts: dict) -> dict:
    """{campionato: {squadra: indirizzo}}. Prima lo stemma del campionato stesso, poi (coppe con dati
    da CSV) la stessa squadra in un altro campionato, con le regole prudenti di strength.match_team."""
    pool = {}
    for ctx in (contexts or {}).values():
        for name, url in ((ctx or {}).get("crests") or {}).items():
            if allowed_url(url):
                pool.setdefault(strength._norm(name), {"name": name, "crest": url})
    out = {}
    for code, teams in names.items():
        own = ((contexts or {}).get(code) or {}).get("crests") or {}
        found = {}
        for name in sorted(teams):
            url = own.get(name)
            if not allowed_url(url):
                hit = strength.match_team(name, pool)
                url = hit["crest"] if hit else None
            if allowed_url(url):
                found[name] = url
        out[code] = found
    return out


def _existing(folder: Path) -> dict:
    return {p.stem: p.name for p in folder.glob("*") if p.suffix in EXTENSIONS}


async def _download(client: httpx.AsyncClient, url: str, folder: Path) -> str | None:
    try:
        r = await client.get(url)
    except httpx.HTTPError as exc:
        print(f"[crests] {url}: {type(exc).__name__}")
        return None
    if r.status_code != 200 or len(r.content) > MAX_BYTES:
        print(f"[crests] {url}: HTTP {r.status_code}, {len(r.content)} byte")
        return None
    ext = kind_of(r.content, r.headers.get("content-type", ""))
    if not ext:
        print(f"[crests] {url}: non è un PNG o un SVG")
        return None
    name = file_stem(url) + ext
    (folder / name).write_bytes(r.content)
    return name


async def update(out_dir: Path, payloads: dict, contexts: dict, client: httpx.AsyncClient | None = None) -> dict:
    """Scarica gli stemmi che mancano e scrive out_dir/crests.json. Ritorna il riepilogo."""
    folder = Path(out_dir) / "crests"
    folder.mkdir(parents=True, exist_ok=True)
    urls_by_league = assign(team_names(payloads), contexts)
    have = _existing(folder)
    missing = sorted({u for teams in urls_by_league.values() for u in teams.values() if file_stem(u) not in have})
    downloaded = 0
    if missing:
        own_client = client is None
        client = client or httpx.AsyncClient(follow_redirects=False, timeout=10,
                                             headers={"User-Agent": "FischiettoFinale/1.0 (+https://fischiettofinale.com)"})
        sem = asyncio.Semaphore(CONCURRENCY)

        async def one(url):
            async with sem:
                return url, await _download(client, url, folder)
        try:
            for url, name in await asyncio.gather(*(one(u) for u in missing[:MAX_DOWNLOADS])):
                if name:
                    have[file_stem(url)] = name
                    downloaded += 1
        finally:
            if own_client:
                await client.aclose()
    teams = {code: {team: have[file_stem(url)] for team, url in sorted(found.items()) if file_stem(url) in have}
             for code, found in sorted(urls_by_league.items())}
    # Campionati non aggiornati in questa esecuzione: restano gli stemmi pubblicati prima.
    try:
        previous = json.loads((Path(out_dir) / "crests.json").read_text(encoding="utf-8")).get("teams") or {}
    except (OSError, ValueError, AttributeError):
        previous = {}
    for code, found in previous.items():
        if code not in teams and isinstance(found, dict):
            teams[code] = {t: f for t, f in found.items() if isinstance(f, str) and Path(f).stem in have and have[Path(f).stem] == f}
    teams = dict(sorted(teams.items()))
    # Restano nella cartella solo i file usati (gli stemmi cambiano di rado, ma la cartella non deve crescere).
    used = {name for found in teams.values() for name in found.values()}
    if used:
        for p in folder.glob("*"):
            if p.is_file() and p.name not in used:
                p.unlink()
    (Path(out_dir) / "crests.json").write_text(json.dumps({"teams": teams}, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    report = {"teams": sum(len(v) for v in teams.values()), "files": len(used), "downloaded": downloaded,
              "missing": len(missing) - downloaded}
    print(f"[crests] stemmi: {report['teams']} squadre, {report['files']} file, {downloaded} scaricati ora")
    return report
