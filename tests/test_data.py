import unittest
from datetime import datetime, timezone

from app.data import _select_upcoming_round


class UpcomingRoundSelectionTests(unittest.TestCase):
    NOW = datetime(2026, 10, 14, 12, 30, tzinfo=timezone.utc)

    def test_skips_postponed_fixture_from_older_matchday(self):
        matches = [
            {"id": "postponed", "utcDate": "2026-10-21T18:00:00Z", "matchday": 6},
            {"id": "round-9-a", "utcDate": "2026-10-24T13:00:00Z", "matchday": 9},
            {"id": "round-9-b", "utcDate": "2026-10-25T16:00:00Z", "matchday": 9},
            {"id": "round-10", "utcDate": "2026-11-01T16:00:00Z", "matchday": 10},
        ]

        matchday, fixtures = _select_upcoming_round(matches, now=self.NOW)

        self.assertEqual(matchday, 9)
        self.assertEqual([m["id"] for m in fixtures], ["round-9-a", "round-9-b"])

    def test_sorts_fixtures_and_selects_earliest_upcoming_round(self):
        matches = [
            {"id": "later", "utcDate": "2026-10-18T16:00:00Z", "matchday": 7},
            {"id": "earlier", "utcDate": "2026-10-17T13:00:00Z", "matchday": 7},
            {"id": "next", "utcDate": "2026-10-24T13:00:00Z", "matchday": 8},
        ]

        matchday, fixtures = _select_upcoming_round(matches, now=self.NOW)

        self.assertEqual(matchday, 7)
        self.assertEqual([m["id"] for m in fixtures], ["earlier", "later"])

    def test_ignores_past_scheduled_fixtures(self):
        matches = [
            {"id": "stale-a", "utcDate": "2026-10-11T13:00:00Z", "matchday": 6, "status": "SCHEDULED"},
            {"id": "stale-b", "utcDate": "2026-10-11T15:00:00Z", "matchday": 6, "status": "TIMED"},
            {"id": "next-a", "utcDate": "2026-10-17T13:00:00Z", "matchday": 7, "status": "SCHEDULED"},
            {"id": "next-b", "utcDate": "2026-10-18T16:00:00Z", "matchday": 7, "status": "SCHEDULED"},
            *[
                {"id": f"later-{i}", "utcDate": f"2026-10-{24 + (i // 5)}T13:00:00Z",
                 "matchday": 8, "status": "SCHEDULED"}
                for i in range(10)
            ],
        ]

        matchday, fixtures = _select_upcoming_round(matches, now=self.NOW)

        self.assertEqual(matchday, 7)
        self.assertEqual([m["id"] for m in fixtures], ["next-a", "next-b"])

    def test_empty_schedule_returns_no_round(self):
        self.assertEqual(_select_upcoming_round([], now=self.NOW), (None, []))

    def test_active_matchday_beats_larger_next_matchday(self):
        matches = [
            {"id": "today-live", "utcDate": "2026-10-14T18:00:00Z", "matchday": 2, "status": "IN_PLAY"},
            {"id": "today-later", "utcDate": "2026-10-14T19:00:00Z", "matchday": 2, "status": "TIMED"},
            {"id": "today-paused", "utcDate": "2026-10-14T18:15:00Z", "matchday": 2, "status": "PAUSED"},
            *[
                {"id": f"next-{i}", "utcDate": f"2026-10-{20 + (i // 9)}T19:00:00Z",
                 "matchday": 3, "status": "SCHEDULED"}
                for i in range(18)
            ],
        ]

        matchday, fixtures = _select_upcoming_round(matches, now=self.NOW)

        self.assertEqual(matchday, 2)
        self.assertEqual({m["id"] for m in fixtures}, {"today-live", "today-later", "today-paused"})

    def test_earliest_multi_fixture_round_beats_larger_later_round(self):
        matches = [
            {"id": "postponed", "utcDate": "2026-10-14T12:00:00Z", "matchday": 1, "status": "TIMED"},
            {"id": "today-a", "utcDate": "2026-10-14T18:45:00Z", "matchday": 2, "status": "TIMED"},
            {"id": "today-b", "utcDate": "2026-10-14T19:00:00Z", "matchday": 2, "status": "SCHEDULED"},
            *[
                {"id": f"next-{i}", "utcDate": f"2026-10-{20 + (i // 9)}T19:00:00Z",
                 "matchday": 3, "status": "SCHEDULED"}
                for i in range(18)
            ],
        ]

        matchday, fixtures = _select_upcoming_round(matches, now=self.NOW)

        self.assertEqual(matchday, 2)
        self.assertEqual([m["id"] for m in fixtures], ["today-a", "today-b"])


if __name__ == "__main__":
    unittest.main()
