"""Probabilità di fine stagione e riepilogo dell'ultima giornata."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app import pipeline, season, store

TEAMS = ["Alfa", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"]


def table(points):
    return [{"pos": i + 1, "team": t, "pts": p, "gf": 10, "ga": 10, "pg": 10} for i, (t, p) in enumerate(zip(TEAMS, points))]


def ratings(strong="Alfa"):
    return {t: {"att": 1.6 if t == strong else 1.0, "def": 0.6 if t == strong else 1.0, "form": ""} for t in TEAMS}


def round_robin():
    return [{"home": h, "away": a} for h in TEAMS for a in TEAMS if h != a]


class ZoneTests(unittest.TestCase):
    def test_league_zones(self):
        self.assertEqual([z["label"] for z in season.zones("SA", 20)], ["Primo posto", "Prime 4", "Ultime 3"])
        self.assertEqual(season.zones("BL1", 18)[-1], {"key": "releg", "label": "Ultime 2", "from": 17, "to": 18})

    def test_cup_zones(self):
        keys = [(z["from"], z["to"]) for z in season.zones("CL", 36)]
        self.assertEqual(keys, [(1, 8), (9, 24), (25, 36)])


class SimulationTests(unittest.TestCase):
    def test_probabilities_sum_to_number_of_places(self):
        res = season.simulate(table([20, 18, 15, 12, 10, 8]), round_robin(), ratings(), 1.4, 1.1, -0.05, "SA", n=800)
        self.assertAlmostEqual(sum(r["title"] for r in res["teams"]), 1.0, places=3)
        self.assertAlmostEqual(sum(r["top4"] for r in res["teams"]), 4.0, places=3)
        self.assertAlmostEqual(sum(r["releg"] for r in res["teams"]), 2.0, places=3)  # 6 squadre: ultime 2
        self.assertEqual(res["remaining"], 30)

    def test_strongest_team_is_favourite(self):
        res = season.simulate(table([10] * 6), round_robin(), ratings("Gamma"), 1.4, 1.1, -0.05, "SA", n=800)
        self.assertEqual(res["teams"][0]["team"], "Gamma")
        self.assertGreater(res["teams"][0]["title"], 0.4)

    def test_same_inputs_same_numbers(self):
        args = (table([20, 18, 15, 12, 10, 8]), round_robin(), ratings(), 1.4, 1.1, -0.05, "SA")
        self.assertEqual(season.simulate(*args, n=300), season.simulate(*args, n=300))

    def test_finished_season_keeps_the_table(self):
        res = season.simulate(table([20, 18, 15, 12, 10, 8]), [], ratings(), 1.4, 1.1, -0.05, "SA", n=200)
        self.assertEqual(res["remaining"], 0)
        self.assertEqual([r["team"] for r in res["teams"]], TEAMS)
        self.assertEqual(res["teams"][0]["title"], 1.0)

    def test_unknown_teams_and_tiny_tables_are_skipped(self):
        res = season.simulate(table([1] * 6), [{"home": "Alfa", "away": "Sconosciuta"}], ratings(), 1.4, 1.1, -0.05, "SA", n=100)
        self.assertEqual(res["remaining"], 0)
        self.assertIsNone(season.simulate(table([1, 1, 1]), [], ratings(), 1.4, 1.1, -0.05, "SA"))


class ClassificaPayloadTests(unittest.TestCase):
    def test_classifica_has_ratings_and_season(self):
        ctx = {"demo": False, "standings": table([20, 18, 15, 12, 10, 8]), "teams": ratings(), "avg_h": 1.4,
               "avg_a": 1.1, "rho": -0.05, "remaining": round_robin()[:10]}
        with patch.object(pipeline.data, "has_key", return_value=True), \
                patch.object(pipeline.data, "get_context", AsyncMock(return_value=ctx)):
            out = asyncio.run(pipeline.build_classifica("SA"))
        self.assertEqual(out["ratings"]["Alfa"]["att"], 1.6)
        self.assertEqual(out["season"]["remaining"], 10)

    def test_simulation_errors_do_not_break_the_table(self):
        ctx = {"demo": False, "standings": table([1] * 6), "teams": {}, "avg_h": 1.4, "avg_a": 1.1}
        with patch.object(pipeline.data, "has_key", return_value=True), \
                patch.object(pipeline.data, "get_context", AsyncMock(return_value=ctx)), \
                patch.object(pipeline.season, "simulate", side_effect=RuntimeError("boom")):
            out = asyncio.run(pipeline.build_classifica("SA"))
        self.assertIsNone(out["season"])
        self.assertEqual(len(out["table"]), 6)


class RecapTests(unittest.TestCase):
    def row(self, mid, kickoff, home, away, p, hg, ag, top=None):
        pick = max((("1", p[0]), ("X", p[1]), ("2", p[2])), key=lambda x: x[1])
        pred = {"home": home, "away": away, "kickoff": kickoff, "p1": p[0], "px": p[1], "p2": p[2],
                "pick": pick[0], "pick_p": pick[1], "top": top or [1, 0]}
        return (mid, pred, {"id": mid, "hg": hg, "ag": ag})

    def test_last_round_only(self):
        rows = [
            self.row("old", "2026-10-05T15:00:00Z", "A", "B", (0.6, 0.25, 0.15), 1, 0),
            self.row("1", "2026-10-17T15:00:00Z", "C", "D", (0.7, 0.2, 0.1), 2, 0),
            self.row("2", "2026-10-18T15:00:00Z", "E", "F", (0.6, 0.25, 0.15), 0, 1, top=[0, 1]),
            self.row("3", "2026-10-19T19:00:00Z", "G", "H", (0.45, 0.3, 0.25), 1, 0, top=[1, 0]),
        ]
        r = store.round_recap(rows)
        self.assertEqual((r["from"], r["to"], r["n"], r["hit"], r["exact"]), ("2026-10-17", "2026-10-19", 3, 2, 2))
        self.assertEqual([x["match"] for x in r["surprises"]], ["E – F"])
        self.assertAlmostEqual(r["surprises"][0]["p_actual"], 0.15)
        self.assertEqual(r["best"][0]["match"], "C – D")

    def test_empty(self):
        self.assertEqual(store.round_recap([]), {})


if __name__ == "__main__":
    unittest.main()


class RemainingFixturesTests(unittest.TestCase):
    """real_context deve passare alla simulazione solo le partite che assegnano punti."""

    def test_only_point_earning_matches_are_kept(self):
        import os
        from datetime import datetime, timedelta, timezone
        from app import data

        now = datetime.now(timezone.utc)

        def match(mid, home, away, days, stage="REGULAR_SEASON", status="SCHEDULED", score=None):
            return {"id": mid, "utcDate": (now + timedelta(days=days)).isoformat().replace("+00:00", "Z"),
                    "matchday": 9 if days > 0 else 8, "status": status, "stage": stage,
                    "homeTeam": {"id": hash(home) % 1000, "name": home, "shortName": home} if home else {"id": None, "name": None},
                    "awayTeam": {"id": hash(away) % 1000, "name": away, "shortName": away} if away else {"id": None, "name": None},
                    "score": {"fullTime": {"home": score[0] if score else None, "away": score[1] if score else None}}}

        finished = [match(1, "Alfa", "Beta", -7, status="FINISHED", score=(1, 0)),
                    match(2, "Gamma", "Delta", -7, status="FINISHED", score=(2, 2))]
        scheduled = [match(3, "Alfa", "Gamma", 2), match(4, "Beta", "Delta", 3),
                     match(5, "Alfa", "Delta", 40, stage="PLAYOFFS"), match(6, None, None, 60, stage="FINAL")]

        async def fake_get(client, path, params):
            if path.endswith("/standings"):
                return {"standings": []}
            if params.get("status") == "FINISHED" and "season" not in params:
                return {"matches": finished}
            if "season" in params:
                return {"matches": []}
            return {"matches": scheduled}

        with patch.object(data, "_get", fake_get), patch.dict(os.environ, {"FOOTBALL_DATA_KEY": "test"}):
            ctx = asyncio.run(data.real_context("SA"))
        self.assertEqual([(r["home"], r["away"]) for r in ctx["remaining"]], [("Alfa", "Gamma"), ("Beta", "Delta")])
        self.assertEqual([r["id"] for r in ctx["remaining"]], ["3", "4"])
        self.assertTrue(all(r["kickoff"] and r["matchday"] == 9 for r in ctx["remaining"]))
