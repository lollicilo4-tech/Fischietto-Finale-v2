"""Copia nel repository i dati prodotti dal job "genera", con controlli di sicurezza.

Lo usa il job "pubblica" di .github/workflows/update.yml, che ha il permesso di scrittura.
Il job "genera" lavora con dati esterni (API, pagine web, AI): qui ci si fida solo di file JSON
validi, con nomi attesi e dimensione ragionevole. Codice, pagine e workflow non passano mai.

Regola dello storico: un pronostico salvato non viene mai riscritto né cancellato. Se i dati
generati tolgono o cambiano un pronostico già pubblicato, la pubblicazione viene rifiutata.
(Il 18/10/2026 due esecuzioni sovrapposte avevano cancellato 9 pronostici di Ligue 1, poi
ripristinati a mano: con questo controllo non può più succedere in silenzio.)

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


def apply(src: Path, repo: Path) -> list[str]:
    sys.path.insert(0, str(repo))
    from app.validation import validate_turno_payload  # codice del main, non dell'artifact

    written = []
    for path in sorted((src / "docs").glob("*")):
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
