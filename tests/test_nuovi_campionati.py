"""Campionati aggiunti il 26/10/2026 dal piano gratuito di football-data.org: Championship, Eredivisie,
Liga Portugal e Brasileirão. Nessuna chiamata di rete."""
import unittest

import generate
from app import season, strength

NEW = {"ELC": "Championship", "DED": "Eredivisie", "PPL": "Liga Portugal", "BSA": "Brasileirão"}


class NewLeaguesTests(unittest.TestCase):
    def test_generated_without_ai(self):
        for code, label in NEW.items():
            self.assertEqual(generate.COMPETITIONS[code], label)
            self.assertIn(code, generate.NO_AI, "niente chiamate AI in più sulla quota gratuita")
        # I campionati principali restano con l'AI.
        for code in ("SA", "PL", "PD", "BL1", "FL1", "CL"):
            self.assertNotIn(code, generate.NO_AI)

    def test_dutch_and_portuguese_teams_get_their_league_strength_in_the_cups(self):
        for code in ("DED", "PPL"):
            self.assertIn(code, strength.DOMESTIC)
            self.assertEqual(strength.LEAGUE_LEVEL[code], strength.OTHER_LEVEL)
        ratings = strength.domestic_ratings({"PPL": {"teams": {"FC Porto": {"att": 1.5, "def": 0.6}}}})
        self.assertEqual(strength.match_team("Porto", ratings)["league"], "PPL")
        # Championship e Brasileirão non giocano le coppe europee: nessun livello.
        self.assertNotIn("ELC", strength.LEAGUE_LEVEL)
        self.assertNotIn("BSA", strength.LEAGUE_LEVEL)

    def test_zones(self):
        self.assertEqual([(z["key"], z["from"], z["to"]) for z in season.zones("ELC", 24)],
                         [("title", 1, 1), ("top2", 1, 2), ("top6", 1, 6), ("releg", 22, 24)])
        self.assertEqual(season.zones("BSA", 20)[-1], {"key": "releg", "label": "Ultime 4", "from": 17, "to": 20})
        self.assertEqual(season.zones("DED", 18)[-1]["label"], "Ultime 2")
        self.assertEqual(season.zones("PPL", 18)[-1]["label"], "Ultime 2")
        # Gli altri campionati non cambiano.
        self.assertEqual([z["label"] for z in season.zones("SA", 20)], ["Primo posto", "Prime 4", "Ultime 3"])


if __name__ == "__main__":
    unittest.main()
