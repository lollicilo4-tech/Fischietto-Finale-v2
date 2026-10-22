import math
import random
import unittest
from datetime import datetime, timedelta, timezone

from app import model

NOW = datetime(2026, 10, 22, tzinfo=timezone.utc)


def _poisson(rng: random.Random, lam: float) -> int:
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p < limit:
            return k
        k += 1


def synthetic_league(rho: float, n: int = 2400, seed: int = 7) -> tuple[list[dict], dict]:
    """Partite tra squadre identiche generate con una vera dipendenza di Dixon-Coles."""
    rng = random.Random(seed)
    lh, la = 1.5, 1.15
    teams = {t: {"att": 1.0, "def": 1.0, "form": ""} for t in ("A", "B")}
    games = []
    while len(games) < n:
        h, a = _poisson(rng, lh), _poisson(rng, la)
        # accettazione/rifiuto: riproduce la distribuzione con il fattore tau
        if rng.random() * 1.3 > model.tau(h, a, lh, la, rho):
            continue
        date = (NOW - timedelta(days=rng.randint(0, 60))).isoformat()
        games.append({"date": date, "home": "A", "away": "B", "hg": h, "ag": a})
    return games, teams


class DixonColesTests(unittest.TestCase):
    def test_tau_preserves_total_probability(self):
        lh, la, rho = 1.7, 0.9, -0.12
        total = sum(model.pois(lh, i) * model.pois(la, j) * model.tau(i, j, lh, la, rho)
                    for i in range(15) for j in range(15))
        self.assertAlmostEqual(total, 1.0, places=6)

    def test_negative_rho_makes_low_draws_more_likely(self):
        plain = model.summarize(1.4, 1.1, rho=0.0)
        dc = model.summarize(1.4, 1.1, rho=-0.1)
        self.assertGreater(dc["px"], plain["px"])
        self.assertAlmostEqual(dc["p1"] + dc["px"] + dc["p2"], 1.0, places=6)

    def test_fit_rho_recovers_sign_and_size(self):
        for true_rho in (-0.12, 0.05):
            with self.subTest(rho=true_rho):
                games, teams = synthetic_league(true_rho)
                fitted = model.fit_rho(games, [], teams, 1.5, 1.15, now=NOW)
                self.assertAlmostEqual(fitted, true_rho, delta=0.05)

    def test_few_matches_use_default(self):
        games, teams = synthetic_league(-0.2, n=20)
        self.assertEqual(model.fit_rho(games, [], teams, 1.5, 1.15, now=NOW), model.DEFAULT_RHO)

    def test_unknown_teams_are_ignored(self):
        self.assertEqual(model.fit_rho([{"date": NOW.isoformat(), "home": "X", "away": "Y", "hg": 0, "ag": 0}],
                                       [], {}, 1.5, 1.1, now=NOW), model.DEFAULT_RHO)


if __name__ == "__main__":
    unittest.main()
