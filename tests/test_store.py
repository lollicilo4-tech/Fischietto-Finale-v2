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




class ArchivedResultsTests(unittest.TestCase):
    @staticmethod
    def prediction():
        return {
            "home": "Casa", "away": "Trasferta",
            "kickoff": "2026-10-17T18:00:00Z",
            "p1": 0.6, "px": 0.2, "p2": 0.2,
            "pick": "1", "pick_p": 0.6,
        }

    def test_joined_archives_a_new_result_and_keeps_it_after_feed_window(self):
        predictions = {"42": self.prediction()}
        finished = [{"id": 42, "hg": 2, "ag": 1, "date": "2026-10-17"}]

        with patch("app.store._load", return_value=predictions), patch("app.store._write") as write:
            rows = store._joined(finished)
            self.assertEqual(predictions["42"]["result"], {
                "hg": 2, "ag": 1, "date": "2026-10-17"
            })
            self.assertEqual(rows[0][2]["hg"], 2)
            write.assert_called_once_with(predictions)

            # Il provider non restituisce più la partita: lo storico deve conservarla.
            rows_after = store._joined([])
            self.assertEqual(len(rows_after), 1)
            self.assertEqual((rows_after[0][2]["hg"], rows_after[0][2]["ag"]), (2, 1))
            write.assert_called_once_with(predictions)

    def test_joined_does_not_overwrite_an_archived_result(self):
        prediction = self.prediction()
        prediction["result"] = {"hg": 1, "ag": 0, "date": "2026-10-17"}
        predictions = {"42": prediction}
        changed_provider_result = [{"id": "42", "hg": 0, "ag": 3, "date": "2026-10-17"}]

        with patch("app.store._load", return_value=predictions), patch("app.store._write") as write:
            rows = store._joined(changed_provider_result)

        self.assertEqual((rows[0][2]["hg"], rows[0][2]["ag"]), (1, 0))
        write.assert_not_called()

    def test_history_baseline_uses_archived_outcomes_when_feed_is_empty(self):
        rows = [
            ("1", self.prediction(), {"id": "1", "hg": 2, "ag": 0}),
            ("2", self.prediction(), {"id": "2", "hg": 0, "ag": 2}),
        ]

        with patch("app.store._joined", return_value=rows):
            actual = store.history([])

        self.assertEqual(actual["n"], 2)
        self.assertEqual(actual["base_rates"], {"1": 0.5, "X": 0.0, "2": 0.5})


if __name__ == "__main__":
    unittest.main()
