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
from app.validation import summarize_source_coverage, validate_turno_payload  # noqa: E402

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "docs"
SOURCE_COVERAGE_WARNING_THRESHOLD = 0.50  # Soglia monitorata nel test operativo di copertura fonti.


def _report_source_coverage(payloads: dict) -> None:
    """Mostra la copertura delle fonti prima di pubblicare i JSON."""
    rows = []
    total_ai = total_with_sources = 0
    for code, (turno, _, _) in payloads.items():
        label = turno.get("league_name", code)
        stats = summarize_source_coverage(turno)
        total_ai += stats["ai_matches"]
        total_with_sources += stats["with_sources"]
        percent = round(stats["coverage"] * 100)
        rows.append((label, stats, percent))
        print(
            f"Fonti AI ({label}): {stats['with_sources']}/{stats['ai_matches']} "
            f"partite con almeno una fonte utilizzabile ({percent}%)."
        )
        if stats["ai_matches"] and stats["coverage"] < SOURCE_COVERAGE_WARNING_THRESHOLD:
            warning = (
                f"{label}: fonti utilizzabili solo in {stats['with_sources']}/"
                f"{stats['ai_matches']} analisi ({percent}%). Pubblicazione consentita, "
                "ma la copertura AI richiede attenzione."
            )
            if os.getenv("GITHUB_ACTIONS") == "true":
                print(f"::warning title=Copertura fonti AI::{warning}")
            else:
                print(f"ATTENZIONE: {warning}")
    overall = total_with_sources / total_ai if total_ai else 0.0
    print(
        f"Copertura fonti AI complessiva: {total_with_sources}/{total_ai} "
        f"({round(overall * 100)}%)."
    )
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        lines = [
            "## Controllo copertura fonti AI",
            "",
            "| Campionato | Analisi AI | Con fonti | Copertura |",
            "|---|---:|---:|---:|",
        ]
        lines.extend(
            f"| {label} | {stats['ai_matches']} | {stats['with_sources']} | {percent}% |"
            for label, stats, percent in rows
        )
        lines.extend([
            "",
            f"**Totale:** {total_with_sources}/{total_ai} analisi con fonti ({round(overall * 100)}%).",
            "",
            "Sotto il 50% viene generato un avviso; la pubblicazione non viene bloccata per non lasciare dati sportivi obsoleti.",
        ])
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write("\n".join(lines) + "\n")


async def main() -> int:
    competitions = {"SA": "Serie A", "PL": "Premier League", "CL": "Champions League", "BL1": "Bundesliga", "PD": "LaLiga", "FL1": "Ligue 1", "EL": "Europa League", "UECL": "Conference League"}
    payloads = {}
    for code, label in competitions.items():
        try:
            turno = await pipeline.build_turno(code, use_ai=code not in {"EL", "UECL"})
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
            # Alcune eccezioni HTTP (es. httpx.HTTPStatusError) hanno str(exc) vuoto.
            # Registra sempre tipo e repr per rendere diagnosticabili i fallimenti senza
            # esporre chiavi o variabili d'ambiente.
            detail = f"{type(exc).__name__}: {exc!r}"
            if code == "SA":
                print(f"Nessun aggiornamento Serie A ({detail})")
                return 1
            print(
                f"Aggiornamento annullato ({label}) ({detail}). "
                "Nessun JSON verrà pubblicato per mantenere coerenti tutte le leghe."
            )
            return 1
    if "SA" not in payloads:
        print("Nessun aggiornamento: dati Serie A non disponibili.")
        return 0
    _report_source_coverage(payloads)
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
