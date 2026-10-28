"""Genera il sito statico nella cartella docs/ (turno.json, storico.json, classifica.json, index.html).

Lo lancia GitHub Actions ogni 4 ore; si può provare anche in locale:
    py generate.py
Le chiavi vengono lette da .env (in locale) o dai Secrets di GitHub (online).
Ogni lega è indipendente: se una fallisce, i suoi file già pubblicati restano intatti
e le altre vengono aggiornate lo stesso.
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

from app import crests, data, pipeline  # noqa: E402
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


def summarize_verification(turno: dict) -> dict:
    """Totali della verifica delle assenze AI per una lega: segnalate, confermate, motivi, pagine."""
    out = {"claimed": 0, "confirmed": 0, "reasons": {}, "pages": {}}
    for match in turno.get("matches", []):
        info = (match.get("analysis") or {}).get("verification") or {}
        out["claimed"] += info.get("claimed", 0)
        out["confirmed"] += info.get("confirmed", 0)
        for reason, count in (info.get("reasons") or {}).items():
            out["reasons"][reason] = out["reasons"].get(reason, 0) + count
        for page in info.get("pages") or []:
            status = page.get("status", "?")
            out["pages"][status] = out["pages"].get(status, 0) + 1
    return out


def _report_verification(payloads: dict) -> None:
    """Riepilogo nel log e nel sommario di Actions: aiuta a capire le assenze non confermate."""
    rows = []
    for code, (turno, _, _) in payloads.items():
        stats = summarize_verification(turno)
        if not stats["claimed"]:
            continue
        label = turno.get("league_name", code)
        reasons = ", ".join(f"{k} {v}" for k, v in sorted(stats["reasons"].items())) or "-"
        pages = ", ".join(f"{k} {v}" for k, v in sorted(stats["pages"].items())) or "-"
        print(f"Assenze AI ({label}): {stats['confirmed']}/{stats['claimed']} confermate; "
              f"motivi: {reasons}; pagine: {pages}.")
        rows.append(f"| {label} | {stats['claimed']} | {stats['confirmed']} | {reasons} | {pages} |")
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path and rows:
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write("\n".join([
                "", "## Verifica assenze AI", "",
                "| Campionato | Segnalate | Confermate | Motivi mancata conferma | Pagine lette |",
                "|---|---:|---:|---|---|", *rows, "",
            ]) + "\n")


def _report_update_failure(code: str, label: str, detail: str) -> None:
    """Registra un errore diagnostico nel log e nel riepilogo GitHub Actions."""
    safe_detail = " ".join(str(detail).replace("\r", " ").replace("\n", " ").split())
    message = f"Aggiornamento fallito per {label} ({code}): {safe_detail}"
    print(message, file=sys.stderr)
    if os.getenv("GITHUB_ACTIONS") == "true":
        print(f"::error title=Aggiornamento fallito::{message}")
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        with Path(summary_path).open("a", encoding="utf-8") as summary:
            summary.write(
                "\n## Esito aggiornamento dati: ERRORE\n\n"
                f"- **Campionato:** {label} ({code})\n"
                f"- **Dettaglio:** {safe_detail}\n"
                "- **Pubblicazione:** lega non aggiornata; i JSON già pubblicati sono preservati. "
                "Le altre leghe vengono pubblicate normalmente.\n"
            )


# I campionati prima delle coppe: le coppe usano la forza delle squadre nei campionati
# già scaricati in questa esecuzione (app/strength.py), senza chiamate API in più.
COMPETITIONS = {
    "SA": "Serie A", "PL": "Premier League", "BL1": "Bundesliga", "PD": "LaLiga", "FL1": "Ligue 1",
    "ELC": "Championship", "DED": "Eredivisie", "PPL": "Liga Portugal", "BSA": "Brasileirão",
    "CL": "Champions League", "EL": "Europa League", "UECL": "Conference League", "CDR": "Copa del Rey",
}
# Senza analisi AI, per contenere le chiamate alla quota gratuita di Groq: le coppe con dati da CSV
# pubblico e i campionati aggiunti il 26/10/2026 (Championship, Eredivisie, Liga Portugal, Brasileirão).
NO_AI = {"EL", "UECL", "CDR", "ELC", "DED", "PPL", "BSA"}

EXIT_OK, EXIT_ALL_FAILED, EXIT_PARTIAL = 0, 1, 2


async def _build_league(code: str, label: str) -> tuple[dict, dict, dict]:
    """Costruisce e valida i tre JSON di una lega. Solleva un'eccezione se qualcosa non va."""
    turno = await pipeline.build_turno(code, use_ai=code not in NO_AI, persist=False)
    if turno["demo"] and os.getenv("CI"):
        raise RuntimeError("dati demo non pubblicabili (chiave FOOTBALL_DATA_KEY mancante?)")
    validate_turno_payload(turno)
    if turno.get("ai_error"):
        print(f"Attenzione ({label}): AI non disponibile ({turno['ai_error']}).")
    turno["ai_error"] = turno.get("ai_error") or None
    turno["ai_status"] = turno.get("ai_status", "attiva" if turno["ai"] else "solo_statistica")
    turno["league"], turno["league_name"] = code, label
    storico = await pipeline.build_storico(code)
    classifica = await pipeline.build_classifica(code)
    # Solo dopo la validazione: un turno scartato non lascia pronostici orfani nello storico.
    pipeline.persist_predictions(turno)
    return turno, storico, classifica


def _publish(payloads: dict) -> None:
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


async def main() -> int:
    """Ogni lega è indipendente: se una fallisce, le altre vengono comunque pubblicate.

    Codici di uscita: 0 tutto aggiornato, 2 aggiornamento parziale, 1 nessuna lega aggiornata.
    """
    payloads, failed = {}, []
    for code, label in COMPETITIONS.items():
        try:
            payloads[code] = await _build_league(code, label)
            turno = payloads[code][0]
            adjusted = sum(1 for m in turno["matches"] if m["analysis"].get("adjusted"))
            print(f"{label}: {len(turno['matches'])} partite, analisi "
                  f"{'AI' if turno['ai'] else 'solo statistica'}, correzioni AI applicate: {adjusted}.")
        except data.NoUpcomingRound:
            if code not in data.KNOCKOUT:
                _report_update_failure(code, label, "Nessuna prossima giornata in calendario")
                failed.append(label)
                continue
            # Coppa a eliminazione diretta tra un turno e l'altro: restano i file pubblicati, niente errore.
            print(f"{label}: nessun turno in calendario (pausa tra un turno e l'altro), file invariati.")
        except Exception as exc:
            # Alcune eccezioni HTTP (es. httpx.HTTPStatusError) hanno str(exc) vuoto:
            # registra tipo e repr senza esporre chiavi o variabili d'ambiente.
            _report_update_failure(code, label, f"{type(exc).__name__}: {exc!r}")
            failed.append(label)
    if not payloads:
        print("Nessuna lega aggiornata: i file pubblicati restano invariati.", file=sys.stderr)
        return EXIT_ALL_FAILED
    _report_source_coverage(payloads)
    _report_verification(payloads)
    _publish(payloads)
    try:  # gli stemmi sono un di più: un errore non deve fermare l'aggiornamento
        await crests.update(OUT, payloads, data.cached_contexts())
    except Exception as exc:
        print(f"Stemmi non aggiornati: {type(exc).__name__}: {exc!r}", file=sys.stderr)
    print(f"Sito aggiornato: {len(payloads)} campionati pubblicati.")
    if failed:
        print(f"Leghe non aggiornate: {', '.join(failed)}.", file=sys.stderr)
        return EXIT_PARTIAL
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
