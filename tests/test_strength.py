"""Coppe: forza delle squadre dai campionati nazionali."""
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import generate
from app import data, model, strength

NOW = datetime(2026, 10, 22, tzinfo=timezone.utc)


def domestic(code: str, teams: dict) -> dict:
    return {"demo": False, "teams": {n: {"att": a, "def": d, "form": ""} for n, (a, d) in teams.items()}}


CONTEXTS = {
    "SA": domestic("SA", {"Inter": (1.5, 0.7), "Monza": (0.8, 1.3)}),
    "PL": domestic("PL", {"Arsenal": (1.4, 0.7), "Brighton Hove": (1.0, 1.0)}),
    "FL1": domestic("FL1", {"Olympique Lyon": (1.1, 0.9), "Stade Rennais": (1.0, 1.0)}),
}


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.ratings = strength.domestic_ratings(CONTEXTS)

    def test_exact_alias_and_unique_containment(self):
        self.assertEqual(strength.match_team("Inter", self.ratings)["league"], "SA")
        self.assertEqual(strength.match_team("Rennes", self.ratings)["name"], "Stade Rennais")
        self.assertEqual(strength.match_team("Lyon", self.ratings)["name"], "Olympique Lyon")
        self.assertEqual(strength.match_team("Brighton", self.ratings)["name"], "Brighton Hove")

    def test_no_false_matches(self):
        for name in ("Inter Escaldes", "Celtic", "Sporting CP", "PSV"):
            with self.subTest(name=name):
                self.assertIsNone(strength.match_team(name, self.ratings))

    def test_league_level_and_tempered_domestic_rating(self):
        inter = strength.match_team("Inter", self.ratings)
        self.assertAlmostEqual(inter["att"], strength.LEAGUE_LEVEL["SA"] * 1.5 ** strength.DOMESTIC_WEIGHT)
        self.assertAlmostEqual(inter["def"], 0.7 ** strength.DOMESTIC_WEIGHT / strength.LEAGUE_LEVEL["SA"])
        # Una squadra media di Premier parte più forte di una squadra di un campionato non coperto.
        self.assertGreater(strength.match_team("Brighton", self.ratings)["att"], strength.OTHER_LEVEL)


class CupPriorTests(unittest.TestCase):
    def test_priors_and_report(self):
        priors, report = strength.cup_priors(["Inter", "PSV", "Arsenal", "Inter"], CONTEXTS)
        self.assertEqual(report["matched"], 2)
        self.assertEqual(report["total"], 3)
        self.assertEqual(priors["PSV"], {"att": strength.OTHER_LEVEL, "def": 1 / strength.OTHER_LEVEL})

    def test_without_domestic_data_there_are_no_priors(self):
        priors, report = strength.cup_priors(["Inter", "PSV"], {})
        self.assertIsNone(priors)
        self.assertEqual(report["matched"], 0)

    def test_priors_steer_teams_with_few_games(self):
        # Una sola partita, finita 1-1: senza priori le due squadre restano uguali.
        games = [{"date": (NOW - timedelta(days=7)).isoformat(), "home": "Inter", "away": "PSV", "hg": 1, "ag": 1}]
        plain, _, _ = model.build_teams(games, [], now=NOW)
        self.assertAlmostEqual(plain["Inter"]["att"], plain["PSV"]["att"], places=6)
        priors, _ = strength.cup_priors(["Inter", "PSV"], CONTEXTS)
        teams, _, _ = model.build_teams(games, [], now=NOW, priors=priors, prior_k=strength.CUP_PRIOR_K)
        self.assertGreater(teams["Inter"]["att"], teams["PSV"]["att"])
        self.assertLess(teams["Inter"]["def"], teams["PSV"]["def"])


class DataIntegrationTests(unittest.TestCase):
    def test_cup_model_uses_cached_domestic_contexts(self):
        cache = {code: {"t": time.time(), "v": ctx} for code, ctx in CONTEXTS.items()}
        games = [{"date": (NOW - timedelta(days=7)).isoformat(), "home": "Inter", "away": "PSV", "hg": 1, "ag": 1}]
        fixtures = [{"home": "Arsenal", "away": "Sporting CP"}]
        with patch.object(data, "_cache", cache):
            teams, _, _, report = data._cup_model(games, [], fixtures)
        self.assertEqual(report["matched"], 2)  # Inter e Arsenal
        self.assertIn("Arsenal", teams, "le squadre senza partite partono dal priore")
        self.assertGreater(teams["Arsenal"]["att"], teams["Sporting CP"]["att"])

    def test_expired_cache_is_ignored(self):
        cache = {"SA": {"t": time.time() - 2 * data.CACHE_SECONDS, "v": CONTEXTS["SA"]}}
        with patch.object(data, "_cache", cache):
            self.assertEqual(data._cached_domestic_contexts(), {})

    def test_generator_builds_leagues_before_cups(self):
        order = list(generate.COMPETITIONS)
        last_league = max(order.index(code) for code in strength.DOMESTIC)
        first_cup = min(order.index(code) for code in data.CUPS)
        self.assertLess(last_league, first_cup)


if __name__ == "__main__":
    unittest.main()
