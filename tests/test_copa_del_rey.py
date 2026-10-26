"""Copa del Rey: dati dal CSV pubblico open-matchday, coppa a eliminazione diretta (offline, niente API)."""
import asyncio
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import generate
from app import data, model, pipeline, season, strength

TOMORROW = (datetime.now(timezone.utc) + timedelta(days=1)).date().isoformat()
NEXT_WEEK = (datetime.now(timezone.utc) + timedelta(days=20)).date().isoformat()
RESULTS = (
    "gw,date,time,home,away,ft_home,ft_away,ft_result\n"
    "1,2026-09-26,17:00,Anaitasuna,CD Tedeón,5,0,H\n"
    "1,2026-09-26,17:00,Ribadesella,SD Noja,1,0,H\n"
)
FIXTURES = (
    "gw,date,time,home,away\n"
    f"1,{TOMORROW},,Atl. Paso,Cordoba\n"
    f"4,{TOMORROW},21:00,Atlético Paso,Córdoba\n"
    f"1,{TOMORROW},21:00,Manacor,Villarreal\n"
    f"1,{TOMORROW},20:00,Ciudad De Lucena,Rayo Majadahonda\n"
    f"1,{TOMORROW},21:00,Recreativo Huelva,Rayo Vallecano\n"
    f"1,{TOMORROW},19:00,Anaitasuna,CD Tarancon\n"
    f"1,{NEXT_WEEK},21:00,Villarreal,Sevilla\n"
)
SEGUNDA = "gw,date,time,home,away,ft_home,ft_away,ft_result\n1,2026-08-15,19:00,Cordoba,Almería,1,1,D\n"
PD = {"teams": {"Villarreal": {"att": 1.3, "def": 0.8, "form": ""}, "Rayo Vallecano": {"att": 1.0, "def": 1.0, "form": ""},
                "Sevilla FC": {"att": 1.1, "def": 0.9, "form": ""}},
      "demo": False, "avg_h": 1.5, "avg_a": 1.15}


async def fake_csv(client, path):
    if "segunda" in path:
        return SEGUNDA
    return RESULTS if "results_" in path else FIXTURES


def context():
    with patch.object(data, "_open_matchday_csv", fake_csv), patch.object(data, "_cache", {"PD": {"t": time.time(), "v": PD}}):
        return asyncio.run(data._open_matchday_context("CDR"))


class CopaDelReyTests(unittest.TestCase):
    def test_registered_like_the_other_csv_cups_and_without_ai(self):
        self.assertEqual(generate.COMPETITIONS["CDR"], "Copa del Rey")
        self.assertIn("CDR", generate.NO_AI)
        self.assertEqual(data.OPEN_MATCHDAY_LEAGUES["CDR"][0], "ESP_CUP_copa-del-rey")
        self.assertIn("CDR", data.KNOCKOUT)
        self.assertEqual(season.zones("CDR", 64), [])

    def test_duplicate_rows_from_two_sources_become_one_match(self):
        rows = [
            {"date": "d", "time": "", "home": "Atl. Paso", "away": "Cordoba"},
            {"date": "d", "time": "21:00", "home": "Atlético Paso", "away": "Córdoba"},
            {"date": "d", "time": "20:00", "home": "Ciudad De Lucena", "away": "Rayo Majadahonda"},
            {"date": "d", "time": "21:00", "home": "Recreativo Huelva", "away": "Rayo Vallecano"},
            {"date": "d", "time": "19:00", "home": "Atlético Pinatarense", "away": "Elche"},
            {"date": "d", "time": "20:00", "home": "Atlético Tordesillas", "away": "Mirandés"},
            {"date": "e", "time": "", "home": "Auriense", "away": "Dep. A Coruna"},
            {"date": "e", "time": "21:00", "home": "Auriense Cented Academy", "away": "Deportivo"},
        ]
        kept = data._dedupe_cup_fixtures(rows)
        self.assertEqual(len(kept), 6, "8 righe, 2 doppioni")
        self.assertIn({"date": "d", "time": "21:00", "home": "Atlético Paso", "away": "Córdoba"}, kept, "resta la riga con l'orario")
        self.assertTrue(any(r["away"] == "Rayo Vallecano" for r in kept), "Rayo Vallecano non è Rayo Majadahonda")

    def test_next_round_ignores_gw_and_has_no_table(self):
        ctx = context()
        self.assertEqual(len(ctx["fixtures"]), 5, "doppione tolto, partita della settimana dopo esclusa")
        self.assertEqual(ctx["standings"], [])
        self.assertEqual(ctx["remaining"], [])
        self.assertTrue(ctx["cup_prior"]["knockout"])

    def test_laliga_clearly_favourite_against_amateurs_segunda_in_between(self):
        ctx = context()
        teams = ctx["teams"]
        self.assertAlmostEqual(teams["Córdoba"]["att"], strength.SEGUNDA_LEVEL)
        self.assertAlmostEqual(teams["Manacor"]["att"], strength.AMATEUR_LEVEL)
        lh, la = model.expected_goals(teams, ctx["avg_h"], ctx["avg_a"], "Manacor", "Villarreal")
        p = model.summarize(lh, la)
        self.assertGreater(p["p2"], 0.65, "Villarreal favorito in casa del Manacor")
        # I dilettanti che hanno giocato i turni preliminari non diventano forti come LaLiga.
        self.assertLess(teams["Anaitasuna"]["att"], teams["Villarreal"]["att"])
        self.assertEqual(teams["Anaitasuna"]["form"], "V")

    def test_matches_with_estimated_teams_have_low_reliability(self):
        ctx = context()
        with patch.object(data, "get_context", new=AsyncMock(return_value=ctx)):
            turno = asyncio.run(pipeline.build_turno("CDR", use_ai=False, persist=False))
        manacor = next(m for m in turno["matches"] if m["away"] == "Villarreal")
        self.assertEqual(manacor["conf"], "bassa")
        self.assertIn("forza di base prudente", manacor["analysis"]["text"])
        self.assertGreater(manacor["prob"]["p2"], 0.65)

    def test_classifica_has_no_season_simulation(self):
        ctx = context()
        with patch.object(data, "has_key", return_value=True), patch.object(data, "get_context", new=AsyncMock(return_value=ctx)):
            out = asyncio.run(pipeline.build_classifica("CDR"))
        self.assertEqual(out["table"], [])
        self.assertIsNone(out["season"])


    def test_pause_between_rounds_is_not_a_failure(self):
        async def failing_build(code, label):
            raise data.NoUpcomingRound("niente in calendario")
        with patch.object(generate, "COMPETITIONS", {"CDR": "Copa del Rey"}), patch.object(generate, "_build_league", failing_build), \
             patch.object(generate, "_report_update_failure") as report:
            self.assertEqual(asyncio.run(generate.main()), generate.EXIT_ALL_FAILED, "nessuna lega pubblicata in questa prova")
        report.assert_not_called()

    def test_empty_calendar_raises_no_upcoming_round(self):
        async def only_results(client, path):
            if "segunda" in path:
                return SEGUNDA
            return RESULTS if "results_" in path else "gw,date,time,home,away\n1,2026-01-01,20:00,A,B\n"
        with patch.object(data, "_open_matchday_csv", only_results), patch.object(data, "_cache", {}):
            with self.assertRaises(data.NoUpcomingRound):
                asyncio.run(data._open_matchday_context("CDR"))


if __name__ == "__main__":
    unittest.main()
