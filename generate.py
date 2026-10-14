"""Genera il sito statico nella cartella docs/ (turno.json, storico.json, classifica.json, index.html).

Lo lancia GitHub Actions due volte al giorno; si può provare anche in locale:
    py generate.py
Le chiavi vengono lette da .env (in locale) o dai Secrets di GitHub (online).
Se qualcosa va storto non tocca i file già pubblicati.
"""
import asyncio
import json
import os
import shutil
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from app import pipeline  # noqa: E402
from app.validation import validate_turno_payload  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs"


async def main() -> int:
    competitions = {"SA": "Serie A", "PL": "Premier League", "CL": "Champions League", "BL1": "Bundesliga", "PD": "LaLiga", "FL1": "Ligue 1"}
    payloads = {}
    for code, label in competitions.items():
        try:
            turno = await pipeline.build_turno(code, use_ai=True)
            validate_turno_payload(turno)
            if turno["demo"] and os.getenv("CI"):
                print(f"Errore ({label}): dati demo non pubblicabili; annullo l'aggiornamento completo per evitare un sito con leghe non aggiornate.")
                return 1
            if turno.get("ai_error"):
                print(f"Attenzione ({label}): AI non disponibile ({turno['ai_error']}).")
            turno["ai_error"] = turno.get("ai_error") or None
            turno["ai_status"] = turno.get("ai_status", "attiva" if turno["ai"] else "solo_statistica")
            turno["league"], turno["league_name"] = code, label
            payloads[code] = (turno, await pipeline.build_storico(code), await pipeline.build_classifica(code))
            print(f"{label}: {len(turno['matches'])} partite, analisi {'AI' if turno['ai'] else 'solo statistica'}.")
        except Exception as exc:
            if code == "SA":
                print(f"Nessun aggiornamento Serie A: {exc}")
                return 1
            print(f"Aggiornamento annullato ({label}): {exc}. Nessun JSON verrà pubblicato per mantenere coerenti tutte le leghe.")
            return 1
    if "SA" not in payloads:
        print("Nessun aggiornamento: dati Serie A non disponibili.")
        return 0
    OUT.mkdir(exist_ok=True)
    (OUT / ".nojekyll").touch()
    for code, (turno, storico, classifica) in payloads.items():
        prefix = "" if code == "SA" else f"league-{code}-"
        for suffix, payload in (("turno.json", turno), ("storico.json", storico), ("classifica.json", classifica)):
            (OUT / f"{prefix}{suffix}").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    html = html.replace("/api/turno", "turno.json").replace("/api/storico", "storico.json")
    html = html.replace("/api/classifica", "classifica.json")
    (OUT / "index.html").write_text(html, encoding="utf-8")
    for f in (ROOT / "static").iterdir():
        if f.is_file() and f.name != "index.html":
            shutil.copy2(f, OUT / f.name)
    print(f"Sito aggiornato: {len(payloads)} campionati pubblicati.")
    return 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
