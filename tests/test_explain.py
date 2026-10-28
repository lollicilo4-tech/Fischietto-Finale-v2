"""Spiegazioni, statistiche squadra e prossime giornate (app/explain.py)."""
import unittest

from app import explain, model, pipeline

TEAMS = {"Alfa": {"att": 1.08, "def": 0.92, "form": "VVNVP"},
         "Beta": {"att": 1.0, "def": 1.26, "form": "PPNPV"},
         "Gamma": {"att": 0.9, "def": 1.1, "form": ""},
         "Delta": {"att": 1.2, "def": 0.8, "form": ""}}


class ExplainTests(unittest.TestCase):
    def test_factors_are_sorted_and_in_italian(self):
        e = explain.explain_match(TEAMS, 1.45, 1.15, "Alfa", "Beta", 1.8, 1.1)
        effects = [abs(i["effect"]) for i in e["items"]]
        self.assertEqual(effects, sorted(effects, reverse=True))
        texts = " ".join(i["text"] for i in e["items"])
        self.assertIn("Difesa Beta: subisce il 26% in più della media.", texts)
        self.assertIn("Attacco Alfa: segna l'8% in più della media del campionato.", texts)
        self.assertIn("Attacco Beta: nella media del campionato.", texts)
        self.assertIn("Fattore campo", texts)
        self.assertIn("1,8 gol per Alfa", e["summary"])

    def test_confirmed_absences_are_explained(self):
        e = explain.explain_match(TEAMS, 1.45, 1.15, "Alfa", "Beta", 1.7, 1.2, 0.94, 1.0, 2)
        self.assertTrue(any("Assenze confermate dalle fonti (2)" in i["text"] and "Alfa -6%" in i["text"] for i in e["items"]))

    def test_demo_teams_have_no_explanation(self):
        self.assertIsNone(explain.explain_match({"A": {"hgf": 1}, "B": {"hgf": 1}}, 1.4, 1.1, "A", "B", 1, 1))


class TeamStatsTests(unittest.TestCase):
    def test_home_and_away_stats(self):
        games = [{"home": "Alfa", "away": "Beta", "hg": 2, "ag": 0}, {"home": "Beta", "away": "Alfa", "hg": 1, "ag": 1},
                 {"home": "Alfa", "away": "Gamma", "hg": 0, "ag": 3}]
        st = explain.team_stats(games)
        self.assertEqual(st["Alfa"]["home"], {"pg": 2, "w": 1, "d": 0, "l": 1, "gf": 2, "ga": 3, "clean": 1, "blank": 1, "o25": 1, "btts": 0})
        self.assertEqual(st["Alfa"]["away"]["d"], 1)
        self.assertEqual(st["Alfa"]["away"]["btts"], 1)
        self.assertEqual(st["Gamma"]["away"]["w"], 1)


class UpcomingRoundsTests(unittest.TestCase):
    def test_next_two_rounds_without_current_and_isolated_games(self):
        rem = [
            {"id": "1", "home": "Alfa", "away": "Beta", "kickoff": "2026-10-25T14:00:00Z", "matchday": 9},
            {"id": "2", "home": "Gamma", "away": "Delta", "kickoff": "2026-10-25T17:00:00Z", "matchday": 9},
            {"id": "3", "home": "Beta", "away": "Gamma", "kickoff": "2026-11-01T14:00:00Z", "matchday": 10},
            {"id": "4", "home": "Delta", "away": "Alfa", "kickoff": "2026-11-01T17:00:00Z", "matchday": 10},
            {"id": "5", "home": "Alfa", "away": "Gamma", "kickoff": "2026-11-04T19:00:00Z", "matchday": 6},
            {"id": "6", "home": "Gamma", "away": "Alfa", "kickoff": "2026-11-08T14:00:00Z", "matchday": 11},
            {"id": "7", "home": "Beta", "away": "Delta", "kickoff": "2026-11-08T17:00:00Z", "matchday": 11},
            {"id": "8", "home": "Alfa", "away": "Delta", "kickoff": "2026-11-15T17:00:00Z", "matchday": 12},
            {"id": "9", "home": "Beta", "away": "Gamma", "kickoff": "2026-11-15T19:00:00Z", "matchday": 12},
        ]
        rounds = explain.upcoming_rounds(rem, {"1", "2"}, TEAMS, 1.45, 1.15, -0.05)
        self.assertEqual([r["matchday"] for r in rounds], [10, 11])  # il recupero isolato (6) non conta
        first = rounds[0]["matches"][0]
        self.assertEqual((first["home"], first["away"]), ("Beta", "Gamma"))
        self.assertAlmostEqual(sum(first["prob"].values()), 1.0, places=3)
        lh, la = model.expected_goals(TEAMS, 1.45, 1.15, "Beta", "Gamma")
        self.assertEqual(first["xg"], [round(lh, 2), round(la, 2)])
        # Il sito ne chiede quattro (calendario fantacalcio): qui ce ne sono solo tre.
        four = explain.upcoming_rounds(rem, {"1", "2"}, TEAMS, 1.45, 1.15, -0.05, rounds=pipeline.NEXT_ROUNDS)
        self.assertEqual(pipeline.NEXT_ROUNDS, 4)
        self.assertEqual([r["matchday"] for r in four], [10, 11, 12])


if __name__ == "__main__":
    unittest.main()
