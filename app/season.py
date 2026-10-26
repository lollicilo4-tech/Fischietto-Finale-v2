"""Probabilità di fine stagione: simula molte volte le partite che restano.

Ogni partita rimanente usa le stesse probabilità dei risultati del modello (gol attesi e
correzione di Dixon-Coles, senza correzioni AI). Partendo dalla classifica attuale si gioca
il resto della stagione SIMULATIONS volte e si conta quante volte ogni squadra finisce in
ogni zona. A parità di punti contano differenza reti e gol fatti; gli scontri diretti non
sono considerati (approssimazione dichiarata nella pagina).

Nessuna chiamata esterna: tutto viene calcolato con i dati già scaricati.
"""
import bisect
import random

from . import model

SIMULATIONS = 5000
SEED = 20261023  # seme fisso: con gli stessi dati, gli stessi numeri a ogni aggiornamento
CUPS = {"CL", "EL", "UECL", "CDR"}
KNOCKOUT = {"CDR"}  # eliminazione diretta: niente simulazione di classifica


def zones(competition: str, n_teams: int) -> list[dict]:
    """Zone di classifica da mostrare. Descrittive, senza promettere qualificazioni che dipendono
    da regolamenti e coefficienti: "prime 4", non "Champions League"."""
    if competition in KNOCKOUT:
        return []
    if competition in CUPS:
        if n_teams < 24:
            return []
        return [
            {"key": "top8", "label": "Prime 8 (agli ottavi)", "from": 1, "to": 8},
            {"key": "playoff", "label": "9ª-24ª (spareggi)", "from": 9, "to": 24},
            {"key": "out", "label": "Eliminata", "from": 25, "to": n_teams},
        ]
    relegated = 3 if n_teams >= 20 else 2
    return [
        {"key": "title", "label": "Primo posto", "from": 1, "to": 1},
        {"key": "top4", "label": "Prime 4", "from": 1, "to": 4},
        {"key": "releg", "label": f"Ultime {relegated}", "from": n_teams - relegated + 1, "to": n_teams},
    ]


def _score_sampler(lh: float, la: float, rho: float):
    """Cumulata della distribuzione dei risultati (stessa matrice di model.summarize)."""
    scores, running, total = [], [], 0.0
    for i in range(model.MAX_GOALS):
        for j in range(model.MAX_GOALS):
            total += model.pois(lh, i) * model.pois(la, j) * max(model.tau(i, j, lh, la, rho), 0.0)
            scores.append((i, j))
            running.append(total)
    return [value / total for value in running], scores


def simulate(standings: list[dict], remaining: list[dict], teams: dict, avg_h: float, avg_a: float,
             rho: float, competition: str, n: int = SIMULATIONS, seed: int = SEED) -> dict | None:
    """Ritorna {"n_sim", "remaining", "zones", "teams": [{team, pos_avg, best, worst, zones...}]}
    oppure None se mancano i dati per simulare."""
    names = [row["team"] for row in standings]
    if len(names) < 4:
        return None
    index = {name: k for k, name in enumerate(names)}
    games = []
    for match in remaining:
        h, a = index.get(match.get("home")), index.get(match.get("away"))
        if h is None or a is None or h == a:
            continue
        lh, la = model.expected_goals(teams, avg_h, avg_a, names[h], names[a])
        cumulative, scores = _score_sampler(lh, la, rho)
        games.append((h, a, cumulative, scores))

    zone_list = zones(competition, len(names))
    base_pts = [row.get("pts", 0) for row in standings]
    base_gd = [row.get("gf", 0) - row.get("ga", 0) for row in standings]
    base_gf = [row.get("gf", 0) for row in standings]
    counts = [[0] * len(names) for _ in names]  # counts[squadra][posizione]
    rng = random.Random(seed)
    for _ in range(n):
        pts, gd, gf = list(base_pts), list(base_gd), list(base_gf)
        for h, a, cumulative, scores in games:
            i, j = scores[min(bisect.bisect_left(cumulative, rng.random()), len(scores) - 1)]
            gf[h] += i; gf[a] += j
            gd[h] += i - j; gd[a] += j - i
            if i > j:
                pts[h] += 3
            elif i < j:
                pts[a] += 3
            else:
                pts[h] += 1; pts[a] += 1
        tie = [rng.random() for _ in names]
        order = sorted(range(len(names)), key=lambda t: (-pts[t], -gd[t], -gf[t], tie[t]))
        for position, team in enumerate(order):
            counts[team][position] += 1

    out = []
    for team, name in enumerate(names):
        dist = counts[team]
        row = {"team": name, "pos_avg": round(sum((p + 1) * c for p, c in enumerate(dist)) / n, 2),
               "best": next(p + 1 for p, c in enumerate(dist) if c),
               "worst": max(p + 1 for p, c in enumerate(dist) if c)}
        for zone in zone_list:
            row[zone["key"]] = round(sum(dist[zone["from"] - 1: zone["to"]]) / n, 4)
        out.append(row)
    out.sort(key=lambda r: r["pos_avg"])
    return {"n_sim": n, "remaining": len(games), "zones": zone_list, "teams": out,
            "tiebreak": "differenza reti e gol fatti"}
