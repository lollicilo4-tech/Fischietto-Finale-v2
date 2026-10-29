"""Capocannonieri da football-data.org (risposta finta: nessuna chiamata alla quota dell'API)."""
import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app import data

PAYLOAD = {"scorers": [
    {"player": {"name": "Lautaro Martínez"}, "team": {"name": "FC Internazionale Milano", "shortName": "Inter"},
     "playedMatches": 9, "goals": 8, "assists": 2, "penalties": 1},
    {"player": {"name": "Ademola Lookman"}, "team": {"name": "Atalanta BC", "shortName": "Atalanta"},
     "playedMatches": 8, "goals": 8, "assists": 4, "penalties": None},
    {"player": {"name": "Senza squadra"}, "team": {}, "goals": 5},
    {"player": {"name": "Gol strani"}, "team": {"name": "Roma"}, "goals": "tanti"},
    {"player": {"name": "Moise Kean"}, "team": {"name": "ACF Fiorentina", "shortName": "Fiorentina"},
     "playedMatches": 9, "goals": 6, "assists": None, "penalties": 2},
]}


class ScorersTests(unittest.TestCase):
    def test_parse_and_sort(self):
        out = data._scorers(PAYLOAD)
        self.assertEqual([x["player"] for x in out], ["Ademola Lookman", "Lautaro Martínez", "Moise Kean"])
        self.assertEqual(out[1], {"player": "Lautaro Martínez", "team": "Inter", "goals": 8, "assists": 2, "penalties": 1, "played": 9, "role": None})
        self.assertIsNone(out[2]["assists"])
        self.assertEqual(data._scorers({}), [])
        self.assertEqual(len(data._scorers({"scorers": PAYLOAD["scorers"] * 40})), data.SCORERS_LIMIT)
        self.assertEqual(data.SCORERS_LIMIT, 100)

    def test_role_from_section_or_position(self):
        cases = [({"section": "Offence"}, "A"), ({"position": "Centre-Forward"}, "A"), ({"section": "Midfield"}, "C"),
                 ({"position": "Left-Back"}, "D"), ({"section": "Defence"}, "D"), ({"position": "Goalkeeper"}, "P"),
                 ({"section": None, "position": None}, None), ({}, None)]
        for player, role in cases:
            with self.subTest(player=player):
                self.assertEqual(data._role(player), role)
        one = {"scorers": [{"player": {"name": "Rafael Leão", "section": "Offence"}, "team": {"shortName": "Milan"}, "goals": 3}]}
        self.assertEqual(data._scorers(one)[0]["role"], "A")

    def test_one_request_and_no_failure(self):
        with patch.dict(os.environ, {"FOOTBALL_DATA_KEY": "test"}), patch.object(data, "_get", AsyncMock(return_value=PAYLOAD)) as get:
            out = asyncio.run(data.get_scorers("SA"))
        self.assertEqual(len(out), 3)
        self.assertEqual(get.await_args.args[1], "/competitions/SA/scorers")
        with patch.dict(os.environ, {"FOOTBALL_DATA_KEY": "test"}), \
                patch.object(data, "_get", AsyncMock(side_effect=httpx.ConnectError("giù"))):
            self.assertEqual(asyncio.run(data.get_scorers("PL")), [])
        # Coppe con dati da CSV e modalità senza chiave: nessuna richiesta.
        with patch.dict(os.environ, {"FOOTBALL_DATA_KEY": "test"}), patch.object(data, "_get", AsyncMock()) as get:
            self.assertEqual(asyncio.run(data.get_scorers("EL")), [])
            get.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
