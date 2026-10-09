import unittest

from app.analyst import _validate_absences


class ValidateAbsencesTests(unittest.TestCase):
    def setUp(self):
        self.fixture = {"home": "Genoa", "away": "Fiorentina"}

    def test_confirmed_absence_requires_player_team_and_out_evidence(self):
        result = _validate_absences(
            {
                "assenze_casa": ["Sow"],
                "assenze_trasferta": [],
                "fattore_gol_casa": 0.95,
                "fattore_gol_trasferta": 1.0,
                "spiegazione": "Sow è indisponibile per questa partita.",
            },
            self.fixture,
            [{"title": "Genoa: Sow out per lesione muscolare", "url": "https://example.com/genoa-sow-out"}],
        )
        self.assertEqual(result["absences_home"], ["Sow"])
        self.assertEqual(result["factor_home"], 0.95)

    def test_wrong_team_or_missing_confirmation_fails_closed(self):
        result = _validate_absences(
            {
                "assenze_casa": ["Moise Kean"],
                "assenze_trasferta": [],
                "fattore_gol_casa": 0.9,
                "fattore_gol_trasferta": 1.05,
                "spiegazione": "L'attaccante è indisponibile.",
            },
            {"home": "Como 1907", "away": "Roma"},
            [{"title": "Fiorentina: Moise Kean out per infortunio", "url": "https://example.com/kean-out"}],
        )
        self.assertEqual(result["absences_home"], [])
        self.assertEqual(result["factor_home"], 1.0)
        self.assertEqual(result["factor_away"], 1.0)
        self.assertTrue(result["validation_warning"])

    def test_doubtful_or_recovering_player_is_not_an_absence(self):
        result = _validate_absences(
            {
                "assenze_casa": ["Obert (pronto a giocare)"],
                "assenze_trasferta": [],
                "fattore_gol_casa": 0.95,
                "fattore_gol_trasferta": 0.9,
                "spiegazione": "Obert è pronto a giocare.",
            },
            {"home": "Cagliari", "away": "Juventus"},
            [{"title": "Cagliari: Obert out per infortunio", "url": "https://example.com/obert-out"}],
        )
        self.assertEqual(result["absences_home"], [])
        self.assertEqual(result["factor_home"], 1.0)
        self.assertEqual(result["factor_away"], 1.0)

    def test_no_confirmed_absences_means_neutral_factors(self):
        result = _validate_absences(
            {
                "assenze_casa": [],
                "assenze_trasferta": [],
                "fattore_gol_casa": 0.92,
                "fattore_gol_trasferta": 1.08,
                "spiegazione": "Non sono state trovate assenze confermate.",
            },
            self.fixture,
            [],
        )
        self.assertEqual(result["factor_home"], 1.0)
        self.assertEqual(result["factor_away"], 1.0)


if __name__ == "__main__":
    unittest.main()
