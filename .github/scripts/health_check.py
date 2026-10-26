"""Controllo di salute del sito, condiviso da Claude e Codex (vedi AGENTS.md, "Monitoraggio").

Controlla, senza chiavi e senza installare nulla (solo libreria standard):
- dati pubblicati in docs/: presenti, validi, non demo, aggiornati di recente, turno non scaduto;
- storico (data/predictions.json): nessun pronostico sparito o modificato nelle ultime 24 ore;
- workflow su main (API pubblica di GitHub): ultimo "Aggiorna pronostici", errori recenti;
- PR aperte: controlli falliti.

Uso (dalla radice di un clone con almeno 2 giorni di storia):
    python3 .github/scripts/health_check.py            # testo leggibile
    python3 .github/scripts/health_check.py --json     # per gli script
Uscita: 0 nessun errore (possono esserci avvisi), 1 almeno un errore.
"""
import argparse
import importlib.util
import json
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = "lollicilo4-tech/Fischietto-Finale-v2"
LEAGUES = {"SA": "Serie A", "PL": "Premier League", "BL1": "Bundesliga", "PD": "LaLiga", "FL1": "Ligue 1",
           "ELC": "Championship", "DED": "Eredivisie", "PPL": "Liga Portugal", "BSA": "Brasileirão",
           "CL": "Champions League", "EL": "Europa League", "UECL": "Conference League"}
# L'aggiornamento parte ogni 4 ore e GitHub lo avvia spesso con 20-40 minuti di ritardo.
WARN_AGE = timedelta(hours=5, minutes=30)
ERROR_AGE = timedelta(hours=9)          # due aggiornamenti saltati di fila
STALE_ROUND = timedelta(hours=12)       # tutte le partite del turno iniziate da più di 12 ore
STALE_FIXTURE = timedelta(hours=4)      # una singola partita non può restare nel turno dopo 4 ore
WATCHED_WORKFLOWS = ("Aggiorna pronostici", "Test Fischietto Finale", "Pubblica interfaccia statica",
                     "pages build and deployment", "Security audit")
RECENT = timedelta(hours=6)

OK, WARN, ERROR = "OK", "AVVISO", "ERRORE"


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        t = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _age(delta: timedelta) -> str:
    hours = int(delta.total_seconds() // 3600)
    minutes = int(delta.total_seconds() % 3600 // 60)
    return f"{hours} h {minutes:02d} min"


def check_published(root: Path, now: datetime) -> list[tuple[str, str]]:
    sys.path.insert(0, str(root))
    from app.validation import validate_turno_payload

    out = []
    for code, label in LEAGUES.items():
        prefix = "" if code == "SA" else f"league-{code}-"
        files = {kind: root / "docs" / f"{prefix}{kind}.json" for kind in ("turno", "storico", "classifica")}
        missing = [k for k, p in files.items() if not p.is_file()]
        if missing:
            out.append((ERROR, f"{label}: file mancanti ({', '.join(missing)})"))
            continue
        try:
            turno = json.loads(files["turno"].read_text(encoding="utf-8"))
            for kind in ("storico", "classifica"):
                if json.loads(files[kind].read_text(encoding="utf-8")).get("demo"):
                    out.append((ERROR, f"{label}: {kind} con dati di esempio"))
        except (OSError, json.JSONDecodeError) as exc:
            out.append((ERROR, f"{label}: JSON illeggibile ({exc})"))
            continue
        if turno.get("demo"):
            out.append((ERROR, f"{label}: turno con dati di esempio"))
        try:
            validate_turno_payload(turno)
        except ValueError as exc:
            out.append((ERROR, f"{label}: turno non valido ({exc})"))
            continue
        generated = _parse_time(turno.get("generated_at"))
        if generated is None:
            out.append((ERROR, f"{label}: data di aggiornamento mancante"))
        else:
            age = now - generated
            level = ERROR if age > ERROR_AGE else WARN if age > WARN_AGE else OK
            if level != OK:
                out.append((level, f"{label}: dati fermi da {_age(age)}"))
        stale_fixtures = [
            m for m in turno["matches"]
            if (kickoff := _parse_time(m.get("kickoff"))) is not None
            and kickoff < now - STALE_FIXTURE
        ]
        if stale_fixtures:
            examples = ", ".join(f"{m.get('home', '?')}–{m.get('away', '?')}" for m in stale_fixtures[:3])
            out.append((ERROR, f"{label}: {len(stale_fixtures)} partite con kickoff passato da oltre 4 ore ancora nel turno ({examples})"))
        kickoffs = [_parse_time(m.get("kickoff")) for m in turno["matches"]]
        kickoffs = [k for k in kickoffs if k]
        if kickoffs and max(kickoffs) < now - STALE_ROUND:
            out.append((ERROR, f"{label}: il turno pubblicato è già finito (ultima partita {max(kickoffs):%d/%m %H:%M} UTC)"))
        status = turno.get("ai_status")
        if status == "non_disponibile":
            out.append((WARN, f"{label}: AI non disponibile ({turno.get('ai_error') or 'motivo non indicato'})"))
    if not out:
        out.append((OK, f"Dati pubblicati: {len(LEAGUES)} campionati validi e aggiornati"))
    return out


def _git(root: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True).stdout


def check_history(root: Path, now: datetime) -> list[tuple[str, str]]:
    """Confronta lo storico attuale con quello di 24 ore fa: nessun pronostico perso o cambiato."""
    script = root / ".github" / "scripts" / "apply_generated.py"
    if not script.is_file():
        return [(WARN, "Storico: controllo non disponibile (manca apply_generated.py)")]
    spec = importlib.util.spec_from_file_location("apply_generated", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        since = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ref = _git(root, "rev-list", "-1", f"--before={since}", "HEAD", "--", "data/predictions.json").strip()
        if not ref:
            return [(WARN, "Storico: storia git troppo corta per il confronto (clonare con --shallow-since)")]
        old = json.loads(_git(root, "show", f"{ref}:data/predictions.json"))
        new = json.loads((root / "data" / "predictions.json").read_text(encoding="utf-8"))
    except (subprocess.CalledProcessError, OSError, json.JSONDecodeError) as exc:
        return [(WARN, f"Storico: confronto non riuscito ({exc})")]
    try:
        module.check_predictions(old, new)
    except module.Rejected as exc:
        return [(ERROR, f"Storico: {exc} rispetto a 24 ore fa")]
    added = len(set(new) - set(old))
    return [(OK, f"Storico integro: {len(new)} pronostici, {added} nuovi nelle ultime 24 ore")]


def _api(path: str):
    request = urllib.request.Request(f"https://api.github.com/repos/{REPO}{path}",
                                     headers={"Accept": "application/vnd.github+json",
                                              "User-Agent": "fischietto-health-check"})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def check_workflows(now: datetime) -> list[tuple[str, str]]:
    try:
        runs = _api("/actions/runs?branch=main&per_page=50").get("workflow_runs", [])
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return [(WARN, f"Workflow: API di GitHub non raggiungibile ({exc})")]
    out = []
    update = [r for r in runs if r.get("name") == "Aggiorna pronostici" and r.get("status") == "completed"]
    if update:
        last = update[0]
        when = _parse_time(last.get("created_at"))
        if last.get("conclusion") != "success":
            out.append((ERROR, f"Aggiorna pronostici: ultima esecuzione '{last.get('conclusion')}' "
                               f"({when:%d/%m %H:%M} UTC) {last.get('html_url', '')}"))
        if when and now - when > ERROR_AGE:
            out.append((ERROR, f"Aggiorna pronostici: nessuna esecuzione da {_age(now - when)}"))
    else:
        out.append((WARN, "Aggiorna pronostici: nessuna esecuzione recente trovata"))
    seen = set()
    for run in runs:
        name, when = run.get("name"), _parse_time(run.get("created_at"))
        if name not in WATCHED_WORKFLOWS or name in seen or run.get("status") != "completed":
            continue
        seen.add(name)  # conta solo l'esecuzione più recente di ogni workflow
        if when and now - when <= RECENT and run.get("conclusion") not in ("success", "skipped", "neutral"):
            if name != "Aggiorna pronostici":
                out.append((ERROR, f"{name}: '{run.get('conclusion')}' ({when:%d/%m %H:%M} UTC) {run.get('html_url', '')}"))
    in_progress = [r for r in runs if r.get("status") in ("in_progress", "queued")]
    if in_progress:
        out.append((OK, f"Workflow in corso: {', '.join(sorted({r.get('name', '?') for r in in_progress}))}"))
    if not any(level == ERROR for level, _ in out):
        out.append((OK, "Workflow su main: nessun errore recente"))
    return out


def check_pull_requests() -> list[tuple[str, str]]:
    try:
        pulls = _api("/pulls?state=open&per_page=30")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return [(WARN, f"PR: API di GitHub non raggiungibile ({exc})")]
    out = []
    for pr in pulls:
        try:
            runs = _api(f"/commits/{pr['head']['sha']}/check-runs?per_page=50").get("check_runs", [])
        except (urllib.error.URLError, OSError, ValueError, KeyError):
            continue
        failed = sorted({r["name"] for r in runs if r.get("conclusion") in ("failure", "timed_out", "cancelled")})
        if failed:
            out.append((WARN, f"PR #{pr['number']} ({pr['head']['ref']}): controlli falliti {', '.join(failed)}"))
    if not out:
        out.append((OK, f"PR aperte: {len(pulls)}, nessun controllo fallito"))
    return out


def run(root: Path, now: datetime | None = None, online: bool = True) -> list[tuple[str, str]]:
    now = now or datetime.now(timezone.utc)
    results = check_published(root, now) + check_history(root, now)
    if online:
        results += check_workflows(now) + check_pull_requests()
    return results


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=".", help="radice del clone (default: cartella corrente)")
    parser.add_argument("--json", action="store_true", help="output JSON")
    parser.add_argument("--offline", action="store_true", help="salta le chiamate all'API di GitHub")
    args = parser.parse_args(argv)
    now = datetime.now(timezone.utc)
    results = run(Path(args.root).resolve(), now, online=not args.offline)
    errors = sum(1 for level, _ in results if level == ERROR)
    warnings = sum(1 for level, _ in results if level == WARN)
    if args.json:
        print(json.dumps({"checked_at": now.isoformat(timespec="minutes"), "errors": errors, "warnings": warnings,
                          "results": [{"level": l, "message": m} for l, m in results]}, ensure_ascii=False))
    else:
        print(f"Controllo del {now:%d/%m/%Y %H:%M} UTC: {errors} errori, {warnings} avvisi")
        for level, message in sorted(results, key=lambda r: (OK, WARN, ERROR).index(r[0]), reverse=True):
            print(f"[{level}] {message}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
