import unittest

from app import model, store


class ExpandedMarketProbabilityTests(unittest.TestCase):
    def test_total_goal_lines_are_complements(self):
        result = model.summarize(1.35, 0.95)
        markets = result["markets"]
        self.assertAlmostEqual(markets["Over 0,5"] + markets["Under 0,5"], 1.0, places=4)
        self.assertAlmostEqual(result["o15"] + result["u25"], 1.0, places=4)
        self.assertAlmostEqual(markets["Over 3,5"] + result["u35"], 1.0, places=4)

    def test_team_goal_markets_are_monotonic(self):
        markets = model.summarize(1.6, 0.8)["markets"]
        self.assertGreaterEqual(markets["Casa Over 0,5"], markets["Casa Over 1,5"])
        self.assertGreaterEqual(markets["Casa Over 1,5"], markets["Casa Over 2,5"])
        self.assertGreaterEqual(markets["Trasferta Over 0,5"], markets["Trasferta Over 1,5"])
        self.assertGreaterEqual(markets["Trasferta Over 1,5"], markets["Trasferta Over 2,5"])
        for probability in markets.values():
            self.assertGreaterEqual(probability, 0.0)
            self.assertLessEqual(probability, 1.0)

    def test_expanded_market_set_is_scored_correctly(self):
        match = {"hg": 2, "ag": 1}
        self.assertFalse(store._market_hit("Over 3,5", match))
        self.assertTrue(store._market_hit("Over 0,5", match))
        self.assertTrue(store._market_hit("Casa Over 1,5", match))
        self.assertFalse(store._market_hit("Trasferta Over 1,5", match))
        self.assertEqual(store._market_type("Casa Over 1,5"), "Gol squadra")


if __name__ == "__main__":
    unittest.main()
