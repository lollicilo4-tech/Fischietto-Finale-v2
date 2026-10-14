import unittest
from unittest.mock import patch

from app import store


class RecentPredictionsTests(unittest.TestCase):
    def test_recent_shows_up_to_18_matches_by_default(self):
        rows = []
        for i in range(20):
            prediction = {
                "home": f"Home {i}", "away": f"Away {i}",
                "kickoff": f"2026-10-{20 - i // 2:02d}T{i % 24:02d}:00:00Z",
                "p1": 0.5, "px": 0.25, "p2": 0.25,
                "pick": "1", "pick_p": 0.5,
            }
            result = {"hg": 1, "ag": 0}
            rows.append((str(i), prediction, result))

        with patch("app.store._joined", return_value=rows):
            actual = store.recent([])

        self.assertEqual(len(actual), 18)
        self.assertEqual(actual[0]["id"], "0")
        self.assertEqual(actual[-1]["id"], "17")


class HistoryPerformanceStatusTests(unittest.TestCase):
    @staticmethod
    def sample_rows(count):
        rows, finished = [], []
        for i in range(count):
            mid = str(i)
            prediction = {
                "home": f"Casa {i}", "away": f"Trasferta {i}",
                "kickoff": f"2026-10-{(i % 28) + 1:02d}T12:00:00Z",
                "p1": 0.6, "px": 0.2, "p2": 0.2,
                "pick": "1", "pick_p": 0.6,
            }
            result = {"id": mid, "hg": 1, "ag": 0}
            rows.append((mid, prediction, result))
            finished.append(result)
        return rows, finished

    def test_ten_results_are_still_a_developing_sample(self):
        rows, finished = self.sample_rows(10)
        with patch("app.store._joined", return_value=rows):
            actual = store.history(finished)
        self.assertEqual(actual["performance"]["status"], "in_attesa")
        self.assertEqual(actual["performance"]["label"], "Campione in costruzione")

    def test_thirty_results_allow_a_performance_label(self):
        rows, finished = self.sample_rows(30)
        with patch("app.store._joined", return_value=rows):
            actual = store.history(finished)
        self.assertEqual(actual["performance"]["status"], "stabile")
        self.assertEqual(actual["performance"]["label"], "Modello stabile")


class MarketReadinessTests(unittest.TestCase):
    def test_market_calibration_requires_thirty_observations(self):
        for count, expected_ready in ((10, False), (30, True)):
            with self.subTest(count=count):
                rows, finished = HistoryPerformanceStatusTests.sample_rows(count)
                for _, prediction, _ in rows:
                    prediction["market_predictions"] = [{"code": "1", "p": 0.6}]
                    prediction["recommendation"] = {"code": "1", "p": 0.6}

                with patch("app.store._joined", return_value=rows):
                    actual = store.history(finished)

                self.assertEqual(actual["market_performance"]["1X2"]["ready"], expected_ready)
                self.assertEqual(actual["market_performance"]["1X2"]["matches"], count)
                self.assertEqual(actual["recommendation_performance"]["ready"], expected_ready)

    def test_many_selections_from_few_matches_are_not_ready(self):
        rows, finished = HistoryPerformanceStatusTests.sample_rows(10)
        for _, prediction, _ in rows:
            prediction["market_predictions"] = [{"code": "1", "p": 0.6} for _ in range(4)]
            prediction["recommendation"] = {"code": "1", "p": 0.6}

        with patch("app.store._joined", return_value=rows):
            actual = store.history(finished)

        metric = actual["market_performance"]["1X2"]
        self.assertEqual(metric["n"], 40)
        self.assertEqual(metric["matches"], 10)
        self.assertFalse(metric["ready"])
        self.assertFalse(actual["recommendation_performance"]["ready"])


if __name__ == "__main__":
    unittest.main()
