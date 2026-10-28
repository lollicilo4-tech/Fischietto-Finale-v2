"""Copia nel repository i dati prodotti dal job "genera", con controlli di sicurezza.

Lo usa il job "pubblica" di .github/workflows/update.yml, che ha il permesso di scrittura.
Il job "genera" lavora con dati esterni (API, pagine web, AI): qui ci si fida solo di file JSON
validi, con nomi attesi e dimensione ragionevole. Codice, pagine e workflow non passano mai.

Regola dello storico: un pronostico salvato non viene mai riscritto né cancellato. Se i dati
generati tolgono o cambiano un pronostico già pubblicato, la pubblicazione viene rifiutata.
(Il 18/10/2026 due esecuzioni sovrapposte avevano cancellato 9 pronostici di Ligue 1, poi
ripristinati a mano: con questo controllo non può più succedere in silenzio.)

Stemmi delle squadre (app/crests.py): docs/crests.json e i file in docs/crests/ passano solo con nomi
fissi (16 cifre esadecimali + .png o .svg), dimensione limitata e contenuto controllato: PNG veri, SVG
senza script, gestori di eventi, link esterni o contenuti incorporati. Uno stemma che non passa viene
scartato con un avviso, senza fermare i pronostici. Il sito non li pubblica mai così come sono: al
build diventano PNG (web/src/pages/stemmi/).

Uso: python3 .github/scripts/apply_generated.py <cartella artifact> <radice repo>
"""
import json
import re
import sys
from pathlib import Path

MAX_BYTES = 20 * 1024 * 1024
DOCS_NAME = re.compile(r"^(?:league-[A-Z0-9]{2,5}-)?(?:turno|storico|classifica)\.json$")
DATA_NAMES = {"predictions.json", "ai_cache.json"}
FROZEN_FIELDS = ("home", "away", "kickoff", "p1", "px", "p2", "pick", "pick_p")
CREST_NAME = re.compile(r"^[0-9a-f]{16}\.(?:png|svg)$")
CREST_MAX_BYTES = 300_000
LEAGUE_CODE = re.compile(r"^[A-Z0-9]{2,5}$")
# Nei SVG non deve esserci nulla che esegua codice o carichi altro.
SVG_FORBIDDEN = re.compile(rb"<script|<foreignobject|<iframe|<embed|<object|javascript:|\son[a-z]+\s*=|"
                           rb"(?:xlink:)?href\s*=\s*[\"'](?!#)|@import|url\(\s*['\"]?(?!#)", re.IGNORECASE)


class Rejected(Exception):
    pass


def _load(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise Rejected(f"{path.name}: non è un file normale")
    if path.stat().st_size > MAX_BYTES:
        raise Rejected(f"{path.name}: file troppo grande")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Rejected(f"{path.name}: JSON non valido ({exc})") from None
    if not isinstance(data, dict):
        raise Rejected(f"{path.name}: deve essere un oggetto JSON")
    return data


def check_predictions(old: dict, new: dict) -> None:
    """I pronostici già pubblicati restano tutti e restano identici."""
    missing = sorted(set(old) - set(new))
    if missing:
        raise Rejected(f"predictions.json: {len(missing)} pronostici spariti (es. {missing[0]})")
    for match_id, before in old.items():
        after = new[match_id]
        if not isinstance(after, dict):
            raise Rejected(f"predictions.json: voce {match_id} non valida")
        for field in FROZEN_FIELDS:
            if field in before and not _same(before[field], after.get(field)):
                raise Rejected(f"predictions.json: pronostico {match_id} modificato ({field})")


def _same(a, b) -> bool:
    # Tolleranza minima sugli arrotondamenti (es. 0,3016 -> 0,3017 visto il 12/10/2026).
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= 0.0005
    return a == b


def check_crest(path: Path) -> bytes | None:
    """Contenuto del file se è uno stemma accettabile, altrimenti None (e un avviso nel log)."""
    def skip(why):
        print(f"::warning title=Stemma scartato::docs/crests/{path.name}: {why}")
        return None
    if path.is_symlink() or not path.is_file() or not CREST_NAME.match(path.name):
        return skip("nome o tipo di file non previsto")
    data = path.read_bytes()
    if not data or len(data) > CREST_MAX_BYTES:
        return skip("dimensione non valida")
    if path.suffix == ".png":
        return data if data.startswith(b"\x89PNG\r\n\x1a\n") else skip("non è un PNG")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return skip("SVG non in UTF-8")
    if b"<svg" not in data[:4096].lower() or SVG_FORBIDDEN.search(data):
        return skip("SVG con contenuti non accettati")
    return data


def apply_crests(src: Path, repo: Path) -> list[str]:
    """Gli stemmi sono un di più: qualsiasi problema scarta lo stemma (o tutti), mai i pronostici."""
    index = src / "docs" / "crests.json"
    if not index.exists():
        return []
    try:
        data = _load(index)
    except Rejected as exc:
        print(f"::warning title=Stemmi non aggiornati::{exc}")
        return []
    teams = data.get("teams")
    if set(data) != {"teams"} or not isinstance(teams, dict):
        print("::warning title=Stemmi non aggiornati::docs/crests.json con struttura non valida")
        return []
    folder, target = src / "docs" / "crests", repo / "docs" / "crests"
    incoming = {}
    if folder.is_dir():
        for p in sorted(folder.glob("*")):
            content = check_crest(p)
            if content is not None:
                incoming[p.name] = content
    existing = {p.name for p in target.glob("*") if CREST_NAME.match(p.name)} if target.is_dir() else set()
    available = set(incoming) | existing
    clean = {}
    for code, found in teams.items():
        if not LEAGUE_CODE.match(str(code)) or not isinstance(found, dict):
            continue
        clean[code] = {team: name for team, name in found.items()
                       if isinstance(team, str) and 0 < len(team) <= 80 and isinstance(name, str)
                       and CREST_NAME.match(name) and name in available}
    target.mkdir(parents=True, exist_ok=True)
    used = {n for found in clean.values() for n in found.values()}
    written = []
    for name, content in incoming.items():
        if name in used and (not (target / name).exists() or (target / name).read_bytes() != content):
            (target / name).write_bytes(content)
            written.append(f"docs/crests/{name}")
    for p in target.glob("*"):
        if p.is_file() and p.name not in used:
            p.unlink()
    (repo / "docs" / "crests.json").write_text(json.dumps({"teams": clean}, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    return written + ["docs/crests.json"]


def apply(src: Path, repo: Path) -> list[str]:
    sys.path.insert(0, str(repo))
    from app.validation import validate_turno_payload  # codice del main, non dell'artifact

    written = []
    written += apply_crests(src, repo)
    for path in sorted((src / "docs").glob("*")):
        if path.name in ("crests.json", "crests"):
            continue
        if not DOCS_NAME.match(path.name):
            print(f"Ignorato (nome non previsto): docs/{path.name}")
            continue
        data = _load(path)
        if path.name.endswith("turno.json"):
            try:
                validate_turno_payload(data)
            except ValueError as exc:
                raise Rejected(f"docs/{path.name}: {exc}") from None
        (repo / "docs" / path.name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        written.append(f"docs/{path.name}")

    for path in sorted((src / "data").glob("*")):
        if path.name not in DATA_NAMES:
            print(f"Ignorato (nome non previsto): data/{path.name}")
            continue
        data = _load(path)
        target = repo / "data" / path.name
        if path.name == "predictions.json" and target.exists():
            check_predictions(_load(target), data)
        target.parent.mkdir(exist_ok=True)
        # Stesso formato di app/store.py, così i diff restano leggibili.
        indent = 1 if path.name == "predictions.json" else None
        target.write_text(json.dumps(data, ensure_ascii=False, indent=indent, sort_keys=indent is not None),
                          encoding="utf-8")
        written.append(f"data/{path.name}")
    return written


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    try:
        written = apply(Path(argv[1]), Path(argv[2]))
    except Rejected as exc:
        print(f"::error title=Dati generati rifiutati::{exc}")
        return 1
    print(f"File aggiornati: {len(written)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
