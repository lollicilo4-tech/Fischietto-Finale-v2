import unittest

from app.data import _select_upcoming_round


class UpcomingRoundSelectionTests(unittest.TestCase):
    def test_skips_postponed_fixture_from_older_matchday(self):
        matches = [
            {"id": "postponed", "utcDate": "2026-10-21T18:00:00Z", "matchday": 6},
            {"id": "round-9-a", "utcDate": "2026-10-24T13:00:00Z", "matchday": 9},
            {"id": "round-9-b", "utcDate": "2026-10-25T16:00:00Z", "matchday": 9},
            {"id": "round-10", "utcDate": "2026-11-01T16:00:00Z", "matchday": 10},
        ]

        matchday, fixtures = _select_upcoming_round(matches)

        self.assertEqual(matchday, 9)
        self.assertEqual([m["id"] for m in fixtures], ["round-9-a", "round-9-b"])

    def test_sorts_fixtures_and_selects_earliest_upcoming_round(self):
        matches = [
            {"id": "later", "utcDate": "2026-10-18T16:00:00Z", "matchday": 7},
            {"id": "earlier", "utcDate": "2026-10-17T13:00:00Z", "matchday": 7},
            {"id": "next", "utcDate": "2026-10-24T13:00:00Z", "matchday": 8},
        ]

        matchday, fixtures = _select_upcoming_round(matches)

        self.assertEqual(matchday, 7)
        self.assertEqual([m["id"] for m in fixtures], ["earlier", "later"])

    def test_empty_schedule_returns_no_round(self):
        self.assertEqual(_select_upcoming_round([]), (None, []))


if __name__ == "__main__":
    unittest.main()
