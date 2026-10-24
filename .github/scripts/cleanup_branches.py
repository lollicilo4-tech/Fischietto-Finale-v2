"""Pulizia dei branch del repository, avviata a mano dal workflow "Pulizia branch".

Per ogni branch decide:
- tenere: main, monitoraggio, branch con una PR aperta, branch con commit degli ultimi giorni
  (un agente potrebbe starci ancora lavorando);
- eliminare: branch di una PR già unita (fermo al commit unito; si ripristina dalla pagina
  della PR) e branch senza modifiche rispetto a main;
- archiviare: branch con lavoro mai unito. Prima si crea il tag archivio/<nome> sullo stesso
  commit (niente va perso), poi si elimina il branch.

Senza ESEGUI=true mostra solo cosa farebbe. Usa solo la libreria standard e il GITHUB_TOKEN
del workflow: nessuna chiave esterna.
"""
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
KEEP = {"main", "monitoraggio"}
RECENT_DAYS = 2
ARCHIVE_PREFIX = "archivio/"


def decide(name: str, sha: str, committed_at: dt.datetime, prs: list[dict], now: dt.datetime,
           ahead: int | None = None) -> tuple[str, str]:
    """Ritorna (azione, motivo). azione: "keep", "delete", "archive" o "compare" (serve ahead)."""
    if name in KEEP:
        return "keep", "branch fisso"
    open_prs = [p for p in prs if p.get("state") == "open"]
    if open_prs:
        return "keep", f"PR #{open_prs[0]['number']} aperta"
    merged = [p for p in prs if p.get("merged_at") and p.get("head", {}).get("sha") == sha]
    if merged:
        return "delete", f"PR #{merged[0]['number']} già unita"
    if now - committed_at < dt.timedelta(days=RECENT_DAYS):
        return "keep", "lavoro recente (meno di 2 giorni)"
    if ahead is None:
        return "compare", ""
    if ahead == 0:
        return "delete", "nessuna modifica rispetto a main"
    what = "1 commit mai unito: salvato" if ahead == 1 else f"{ahead} commit mai uniti: salvati"
    return "archive", f"{what} nel tag {ARCHIVE_PREFIX}{name}"


class GitHub:
    def __init__(self, repo: str, token: str):
        self.repo, self.token = repo, token

    def call(self, method: str, path: str, body: dict | None = None):
        url = path if path.startswith("http") else f"{API}/repos/{self.repo}{path}"
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                   "User-Agent": "fischietto-pulizia-branch"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None

    def paged(self, path: str) -> list:
        out, page = [], 1
        while True:
            sep = "&" if "?" in path else "?"
            chunk = self.call("GET", f"{path}{sep}per_page=100&page={page}")
            out += chunk
            if len(chunk) < 100:
                return out
            page += 1


def quote(name: str) -> str:
    return urllib.parse.quote(name, safe="")


def main() -> int:
    repo, token = os.environ["REPO"], os.environ["GITHUB_TOKEN"]
    execute = os.getenv("ESEGUI", "false").lower() == "true"
    gh = GitHub(repo, token)
    now = dt.datetime.now(dt.timezone.utc)

    prs_by_branch: dict[str, list] = {}
    for pr in gh.paged("/pulls?state=all"):
        if pr["head"]["repo"] and pr["head"]["repo"]["full_name"] == repo:
            prs_by_branch.setdefault(pr["head"]["ref"], []).append(pr)

    rows = []
    for branch in gh.paged("/branches"):
        name, sha = branch["name"], branch["commit"]["sha"]
        commit = gh.call("GET", f"/commits/{sha}")
        committed_at = dt.datetime.fromisoformat(commit["commit"]["committer"]["date"].replace("Z", "+00:00"))
        prs = prs_by_branch.get(name, [])
        action, reason = decide(name, sha, committed_at, prs, now)
        if action == "compare":
            ahead = gh.call("GET", f"/compare/main...{quote(name)}")["ahead_by"]
            action, reason = decide(name, sha, committed_at, prs, now, ahead)
        rows.append((name, sha, action, reason))

    done = {"keep": 0, "delete": 0, "archive": 0}
    errors = []
    for name, sha, action, reason in rows:
        done[action] += 1
        if not execute or action == "keep":
            continue
        try:
            if action == "archive":
                tag = f"refs/tags/{ARCHIVE_PREFIX}{name}"
                try:
                    gh.call("POST", "/git/refs", {"ref": tag, "sha": sha})
                except urllib.error.HTTPError as exc:
                    if exc.code != 422:  # 422: il tag esiste già
                        raise
                existing = gh.call("GET", f"/git/ref/tags/{urllib.parse.quote(ARCHIVE_PREFIX + name, safe='/')}")
                if existing["object"]["sha"] != sha:
                    raise RuntimeError(f"il tag {tag} punta a un altro commit: branch non eliminato")
            gh.call("DELETE", f"/git/refs/heads/{urllib.parse.quote(name, safe='/')}")
        except (urllib.error.HTTPError, RuntimeError) as exc:
            errors.append(f"{name}: {exc}")

    label = {"keep": "tenuto", "delete": "eliminato", "archive": "archiviato ed eliminato"}
    planned = {"keep": "tenuto", "delete": "da eliminare", "archive": "da archiviare"}
    lines = [f"## Pulizia branch ({'eseguita' if execute else 'prova: nessuna modifica'})", "",
             f"Tenuti {done['keep']} · eliminati {done['delete']} · archiviati {done['archive']}", "",
             "| Branch | Azione | Motivo |", "|---|---|---|"]
    order = {"keep": 0, "archive": 1, "delete": 2}
    for name, _, action, reason in sorted(rows, key=lambda r: (order[r[2]], r[0])):
        lines.append(f"| `{name}` | {(label if execute else planned)[action]} | {reason} |")
    if errors:
        lines += ["", "### Errori", *[f"- {e}" for e in errors]]
    report = "\n".join(lines)
    print(report)
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(report + "\n")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
