import unittest
from datetime import datetime, timezone

from app.data import _missing_upcoming_matchdays, _recovered_upcoming_round, _select_upcoming_round, _reconcile_standings


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


    def test_excludes_finished_ids_even_if_calendar_still_returns_them(self):
        matches = [
            {"id": "already-finished", "utcDate": "2026-10-14T18:00:00Z",
             "matchday": 6, "status": "IN_PLAY"},
            {"id": "next-a", "utcDate": "2026-10-17T13:00:00Z",
             "matchday": 7, "status": "SCHEDULED"},
            {"id": "next-b", "utcDate": "2026-10-18T16:00:00Z",
             "matchday": 7, "status": "SCHEDULED"},
        ]

        matchday, fixtures = _select_upcoming_round(
            matches, now=self.NOW, finished_ids={"already-finished"}
        )

        self.assertEqual(matchday, 7)
        self.assertEqual([m["id"] for m in fixtures], ["next-a", "next-b"])



    def test_detects_missing_matchday_before_selected_future_round(self):
        finished = [
            {"matchday": 1, "score": {"fullTime": {"home": 1, "away": 0}}},
            {"matchday": 2, "score": {"fullTime": {"home": 2, "away": 2}}},
        ]
        self.assertEqual(_missing_upcoming_matchdays(finished, 4), [3])

    def test_does_not_report_gap_when_next_round_is_selected(self):
        finished = [
            {"matchday": 1, "score": {"fullTime": {"home": 1, "away": 0}}},
            {"matchday": 2, "score": {"fullTime": {"home": 2, "away": 2}}},
        ]
        self.assertEqual(_missing_upcoming_matchdays(finished, 3), [])

    def test_ignores_finished_entries_without_complete_scores(self):
        finished = [
            {"matchday": 2, "score": {"fullTime": {"home": None, "away": None}}},
        ]
        self.assertEqual(_missing_upcoming_matchdays(finished, 4), [])


    def test_does_not_report_gap_after_latest_completed_matchday(self):
        finished = [
            {"matchday": 2, "score": {"fullTime": {"home": 2, "away": 0}}},
            {"matchday": 3, "score": {"fullTime": {"home": 1, "away": 1}}},
        ]
        self.assertEqual(_missing_upcoming_matchdays(finished, 4), [])

    def test_recovered_round_requires_multiple_future_fixtures(self):
        now = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
        one_postponed_fixture = [
            {"id": "postponed", "matchday": 3, "utcDate": "2026-10-21T18:00:00Z", "status": "SCHEDULED"},
        ]
        self.assertEqual(_recovered_upcoming_round(one_postponed_fixture, 3, now=now), [])

    def test_recovered_round_accepts_multiple_future_fixtures_and_excludes_finished(self):
        now = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
        fixtures = [
            {"id": "already-finished", "matchday": 3, "utcDate": "2026-10-20T18:00:00Z", "status": "IN_PLAY"},
            {"id": "later", "matchday": 3, "utcDate": "2026-10-21T19:00:00Z", "status": "SCHEDULED"},
            {"id": "earlier", "matchday": 3, "utcDate": "2026-10-20T18:45:00Z", "status": "SCHEDULED"},
        ]
        recovered = _recovered_upcoming_round(
            fixtures, 3, now=now, finished_ids={"already-finished"}
        )
        self.assertEqual([m["id"] for m in recovered], ["earlier", "later"])


class StandingsReconciliationTests(unittest.TestCase):
    @staticmethod
    def row(pos, team, pg, w, d, l, gf, ga, pts):
        return {"pos": pos, "team": team, "pg": pg, "w": w, "d": d, "l": l,
                "gf": gf, "ga": ga, "pts": pts}

    def test_rebuilds_stale_standings_from_finished_results(self):
        stale = [
            self.row(1, "Alpha", 0, 0, 0, 0, 0, 0, 0),
            self.row(2, "Beta", 0, 0, 0, 0, 0, 0, 0),
        ]
        finished = [{"home": "Alpha", "away": "Beta", "hg": 2, "ag": 0}]

        result = _reconcile_standings(stale, finished)

        self.assertEqual(result[0]["team"], "Alpha")
        self.assertEqual(
            result[0],
            {"pos": 1, "team": "Alpha", "pg": 1, "w": 1, "d": 0,
             "l": 0, "gf": 2, "ga": 0, "pts": 3},
        )
        self.assertEqual(result[1]["pts"], 0)
        self.assertEqual(result[1]["gf"], 0)
        self.assertEqual(result[1]["ga"], 2)

    def test_keeps_provider_order_when_totals_are_consistent(self):
        official = [
            self.row(1, "Beta", 1, 0, 1, 0, 1, 1, 1),
            self.row(2, "Alpha", 1, 0, 1, 0, 1, 1, 1),
        ]
        finished = [{"home": "Alpha", "away": "Beta", "hg": 1, "ag": 1}]

        self.assertEqual(_reconcile_standings(official, finished), official)

    def test_does_not_guess_when_team_names_do_not_match_provider(self):
        official = [
            self.row(1, "Alpha", 1, 1, 0, 0, 1, 0, 3),
            self.row(2, "Beta", 1, 0, 0, 1, 0, 1, 0),
        ]
        finished = [{"home": "Alpha", "away": "Gamma", "hg": 1, "ag": 0}]

        self.assertEqual(_reconcile_standings(official, finished), official)


    def test_reconciles_when_names_differ_but_team_ids_match(self):
        official = [
            {**self.row(1, "Alpha", 0, 0, 0, 0, 0, 0, 0), "team_id": 101},
            {**self.row(2, "Beta", 0, 0, 0, 0, 0, 0, 0), "team_id": 202},
        ]
        finished = [{
            "home": "Alpha FC", "away": "Beta United",
            "home_id": 101, "away_id": 202, "hg": 2, "ag": 0,
        }]

        result = _reconcile_standings(official, finished)

        self.assertEqual(result[0]["team"], "Alpha")
        self.assertEqual(result[0]["team_id"], 101)
        self.assertEqual(
            {key: result[0][key] for key in ("pg", "w", "d", "l", "gf", "ga", "pts")},
            {"pg": 1, "w": 1, "d": 0, "l": 0, "gf": 2, "ga": 0, "pts": 3},
        )
        self.assertEqual(result[1]["pg"], 1)
        self.assertEqual(result[1]["pts"], 0)

    def test_empty_results_leave_provider_standings_untouched(self):
        official = [self.row(1, "Alpha", 1, 1, 0, 0, 1, 0, 3)]
        self.assertEqual(_reconcile_standings(official, []), official)

if __name__ == "__main__":
    unittest.main()
