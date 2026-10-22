"""Regression checks for the six published competition payloads.

These checks are intentionally offline: they must not consume AI/API tokens.
"""
import json
import unittest
from pathlib import Path

from app.validation import validate_turno_payload


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
LEAGUES = {
    "SA": "Serie A",
    "PL": "Premier League",
    "CL": "Champions League",
    "BL1": "Bundesliga",
    "PD": "LaLiga",
    "FL1": "Ligue 1",
}


def read_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


class PublishedLeaguePayloadTests(unittest.TestCase):
    def test_each_competition_has_valid_turno_storico_and_classifica(self):
        for code, label in LEAGUES.items():
            prefix = "" if code == "SA" else f"league-{code}-"
            with self.subTest(league=label):
                turno_path = DOCS / f"{prefix}turno.json"
                storico_path = DOCS / f"{prefix}storico.json"
                classifica_path = DOCS / f"{prefix}classifica.json"

                self.assertTrue(turno_path.is_file(), f"{label}: turno.json assente")
                self.assertTrue(storico_path.is_file(), f"{label}: storico.json assente")
                self.assertTrue(classifica_path.is_file(), f"{label}: classifica.json assente")

                turno = read_json(turno_path)
                validate_turno_payload(turno)
                self.assertFalse(turno.get("demo"), f"{label}: turno dimostrativo")
                self.assertEqual(turno.get("league"), code)
                self.assertEqual(turno.get("league_name"), label)
                self.assertGreater(len(turno["matches"]), 0)

                storico = read_json(storico_path)
                self.assertFalse(storico.get("demo"), f"{label}: storico dimostrativo")
                self.assertIsInstance(storico.get("items"), list)
                # "n" rappresenta il totale dello storico; "items" è intenzionalmente
                # limitato agli ultimi 30 risultati per contenere la dimensione del JSON.
                self.assertIsInstance(storico.get("n"), int)
                self.assertGreaterEqual(storico["n"], len(storico["items"]))
                self.assertEqual(len(storico["items"]), min(storico["n"], 30))
                performance = storico.get("performance", {})
                if 0 < storico["n"] < 30:
                    self.assertEqual(
                        performance.get("label"),
                        "Campione in costruzione",
                        f"{label}: non presentare come affidabile uno storico troppo piccolo",
                    )

                classifica = read_json(classifica_path)
                self.assertFalse(classifica.get("demo"), f"{label}: classifica dimostrativa")
                self.assertIsInstance(classifica.get("table"), list)
                self.assertGreater(len(classifica["table"]), 0)


if __name__ == "__main__":
    unittest.main()
