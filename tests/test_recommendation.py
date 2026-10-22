import unittest

from app import model, pipeline


def summary(lh: float, la: float) -> dict:
    return model.summarize(lh, la)


LEAGUE = [  # 48 partite con medie realistiche: 1 50%, X 25%, Over 1,5 67%
    {"hg": h, "ag": a} for h, a in
    [(1, 0), (2, 1), (0, 0), (1, 1), (3, 1), (0, 2), (2, 2), (1, 2), (2, 0), (0, 1), (4, 1), (1, 0)] * 4
]


class BaseRateTests(unittest.TestCase):
    def test_base_rates_need_enough_matches(self):
        self.assertEqual(pipeline.market_base_rates(LEAGUE[:10]), {})

    def test_base_rates_match_frequencies(self):
        rates = pipeline.market_base_rates(LEAGUE)
        self.assertAlmostEqual(rates["1"], 6 / 12)
        self.assertAlmostEqual(rates["X"], 3 / 12)
        self.assertAlmostEqual(rates["Over 1,5"], 8 / 12)
        self.assertAlmostEqual(rates["1"] + rates["X"] + rates["2"], 1.0)


class RecommendationTests(unittest.TestCase):
    def test_without_base_rates_keeps_previous_behaviour(self):
        rec = pipeline._recommendations(summary(1.6, 1.1), "Casa", "Ospite")
        self.assertEqual(rec["method"], "probabilita")
        self.assertNotIn("edge", rec["best"])

    def test_strong_home_favourite_is_recommended_over_generic_over(self):
        rates = pipeline.market_base_rates(LEAGUE)
        rec = pipeline._recommendations(summary(2.4, 0.6), "Casa", "Ospite", rates)
        self.assertEqual(rec["method"], "scarto_media")
        self.assertNotEqual(rec["best"]["code"], "Over 1,5")
        self.assertGreaterEqual(rec["best"]["p"], pipeline.RECOMMENDED_MIN_P)
        self.assertGreater(rec["best"]["edge"], 0.15)
        self.assertAlmostEqual(rec["best"]["base"], round(rates[rec["best"]["code"]], 4))

    def test_never_recommends_below_fifty_percent_or_exact_score(self):
        rates = pipeline.market_base_rates(LEAGUE)
        for lh, la in ((1.3, 1.25), (0.8, 0.7), (2.8, 2.2), (0.9, 2.1)):
            with self.subTest(lh=lh, la=la):
                best = pipeline._recommendations(summary(lh, la), "Casa", "Ospite", rates)["best"]
                self.assertNotEqual(best["kind"], "score")
                if best["kind"] not in ("esito", "doppia"):
                    self.assertGreaterEqual(best["p"], pipeline.RECOMMENDED_MIN_P)

    def test_average_match_falls_back_to_most_likely_simple_outcome(self):
        rates = {code: 0.99 for code in pipeline.BASE_CODES}  # nessun mercato sopra la media
        rec = pipeline._recommendations(summary(1.4, 1.1), "Casa", "Ospite", rates)
        self.assertIn(rec["best"]["kind"], ("esito", "doppia"))


if __name__ == "__main__":
    unittest.main()
