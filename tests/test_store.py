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


if __name__ == "__main__":
    unittest.main()
