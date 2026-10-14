import unittest

from app.validation import validate_turno_payload


def valid_payload():
    return {
        "matches": [{
            "id": "123", "home": "Casa", "away": "Trasferta",
            "kickoff": "2026-10-20T18:00:00Z",
            "prob": {"p1": 0.5, "px": 0.25, "p2": 0.25, "o25": 0.6},
            "xg": [1.4, 0.9],
            "top_scores": [[1, 0, 0.2], [1, 1, 0.15]],
            "markets": {"1x_o15": 0.55},
            "analysis": {
                "ai": True, "factor_home": 1.0, "factor_away": 1.0,
                "absences_home": [], "absences_away": [],
                "sources": [{"title": "Fonte", "url": "https://example.com/news"}],
            },
        }]
    }


class TurnoPayloadValidationTests(unittest.TestCase):
    def test_valid_payload_passes(self):
        validate_turno_payload(valid_payload())

    def test_empty_match_list_is_rejected(self):
        payload = valid_payload()
        payload["matches"] = []
        with self.assertRaisesRegex(ValueError, "non contiene partite"):
            validate_turno_payload(payload)

    def test_duplicate_match_ids_are_rejected(self):
        payload = valid_payload()
        payload["matches"].append(dict(payload["matches"][0]))
        with self.assertRaisesRegex(ValueError, "ID duplicato"):
            validate_turno_payload(payload)

    def test_incoherent_1x2_probabilities_are_rejected(self):
        payload = valid_payload()
        payload["matches"][0]["prob"]["p1"] = 0.9
        with self.assertRaisesRegex(ValueError, "non sommano a 1"):
            validate_turno_payload(payload)

    def test_out_of_range_market_probability_is_rejected(self):
        payload = valid_payload()
        payload["matches"][0]["markets"]["1x_o15"] = 1.2
        with self.assertRaisesRegex(ValueError, "fuori intervallo"):
            validate_turno_payload(payload)

    def test_invalid_kickoff_is_rejected(self):
        payload = valid_payload()
        payload["matches"][0]["kickoff"] = "not-a-date"
        with self.assertRaisesRegex(ValueError, "kickoff ISO-8601"):
            validate_turno_payload(payload)

    def test_invalid_ai_factor_is_rejected(self):
        payload = valid_payload()
        payload["matches"][0]["analysis"]["factor_home"] = 1.5
        with self.assertRaisesRegex(ValueError, "analysis.factor_home"):
            validate_turno_payload(payload)

    def test_bad_source_url_is_rejected(self):
        payload = valid_payload()
        payload["matches"][0]["analysis"]["sources"] = [{"url": "javascript:alert(1)"}]
        with self.assertRaisesRegex(ValueError, "URL fonte non valido"):
            validate_turno_payload(payload)


if __name__ == "__main__":
    unittest.main()
