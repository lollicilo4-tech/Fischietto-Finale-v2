"""Verifica delle assenze sul testo degli articoli (nessuna chiamata di rete)."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import app.analyst as analyst
from app.analyst import _text_confirms_absence, _validate_absences
from app.evidence import html_to_text


ARTICLE_IT = """
<html><head><title>Genoa, le ultime verso la Fiorentina</title><script>var x = "Sow in dubbio";</script></head>
<body><article>
<h1>Genoa, le ultime verso la Fiorentina</h1>
<p>Vigilia complicata per il Genoa. Malinovskyi è out per una lesione al flessore e salterà la sfida di domenica.</p>
<p>Recuperato invece Frendrup, che torna a disposizione dopo il turno di squalifica.</p>
<h3>Indisponibili</h3>
<p>Vasquez, Ekhator</p>
</article></body></html>
"""

ARTICLE_EN = """
<html><head><title>Arsenal team news</title></head><body>
<p>Arsenal will be without Bukayo Saka, who has been ruled out with a hamstring injury.</p>
<p>Martin Odegaard is a doubt for the game after a late knock.</p>
</body></html>
"""


def page(html: str, url: str = "https://example.com/news") -> dict:
    title, text = html_to_text(html)
    return {"url": url, "final_url": url, "title": title, "text": text, "source_title": ""}


class HtmlToTextTests(unittest.TestCase):
    def test_strips_scripts_and_keeps_title_and_paragraphs(self):
        title, text = html_to_text(ARTICLE_IT)
        self.assertEqual(title, "Genoa, le ultime verso la Fiorentina")
        self.assertIn("Malinovskyi è out per una lesione", text)
        self.assertNotIn("var x", text)
        self.assertIn("\n", text, "un blocco per riga, per ragionare per frase")


class TextConfirmationTests(unittest.TestCase):
    def setUp(self):
        _, self.it = html_to_text(ARTICLE_IT)
        _, self.en = html_to_text(ARTICLE_EN)

    def test_confirmed_absence_in_sentence(self):
        self.assertTrue(_text_confirms_absence("Ruslan Malinovskyi", "Genoa", self.it))

    def test_list_under_short_heading_counts(self):
        self.assertTrue(_text_confirms_absence("Vasquez", "Genoa", self.it))

    def test_recovered_player_is_not_absent(self):
        self.assertFalse(_text_confirms_absence("Frendrup", "Genoa", self.it))

    def test_team_must_be_mentioned(self):
        self.assertFalse(_text_confirms_absence("Malinovskyi", "Torino", self.it))

    def test_player_not_in_article(self):
        self.assertFalse(_text_confirms_absence("Retegui", "Genoa", self.it))

    def test_english_ruled_out_vs_doubt(self):
        self.assertTrue(_text_confirms_absence("Bukayo Saka", "Arsenal", self.en))
        self.assertFalse(_text_confirms_absence("Martin Odegaard", "Arsenal", self.en))

    def test_unavailable_is_not_mistaken_for_available(self):
        text = "Juventus: Vlahovic non sarà disponibile, unavailable for Sunday."
        self.assertTrue(_text_confirms_absence("Vlahovic", "Juventus", text))


class PartialConfirmationTests(unittest.TestCase):
    fx = {"home": "Genoa", "away": "Fiorentina"}

    def data(self, home, away=(), fh=0.9, fa=1.0):
        return {"assenze_casa": list(home), "assenze_trasferta": list(away),
                "fattore_gol_casa": fh, "fattore_gol_trasferta": fa,
                "spiegazione": "Testo dell'AI."}

    def test_all_confirmed_keeps_ai_factors(self):
        result = _validate_absences(self.data(["Malinovskyi"]), self.fx, [], [page(ARTICLE_IT)])
        self.assertEqual(result["absences_home"], ["Malinovskyi"])
        self.assertEqual(result["factor_home"], 0.9)
        self.assertIsNone(result["validation_warning"])
        self.assertEqual(result["evidence"][0]["url"], "https://example.com/news")

    def test_partial_confirmation_shrinks_factor(self):
        result = _validate_absences(self.data(["Malinovskyi", "Frendrup"], fh=0.9), self.fx, [], [page(ARTICLE_IT)])
        self.assertEqual(result["absences_home"], ["Malinovskyi"])
        self.assertAlmostEqual(result["factor_home"], 0.95)
        self.assertIn("1 assenze su 2", result["validation_warning"])

    def test_uncertainty_in_explanation_no_longer_cancels_confirmed_absences(self):
        data = self.data(["Malinovskyi"])
        data["spiegazione"] = "Malinovskyi è fuori; Frendrup era in dubbio ma è recuperato."
        result = _validate_absences(data, self.fx, [], [page(ARTICLE_IT)])
        self.assertEqual(result["factor_home"], 0.9)

    def test_nothing_confirmed_is_neutral(self):
        result = _validate_absences(self.data(["Frendrup"]), self.fx, [], [page(ARTICLE_IT)])
        self.assertEqual((result["factor_home"], result["factor_away"]), (1.0, 1.0))
        self.assertTrue(result["validation_warning"])


class FinalizeTests(unittest.TestCase):
    fx = {"home": "Genoa", "away": "Fiorentina"}

    def test_pages_are_read_only_when_absences_are_claimed(self):
        fetch = AsyncMock(return_value=[page(ARTICLE_IT, "https://news.example/genoa")])
        with patch.object(analyst.evidence, "fetch_pages", fetch):
            none = asyncio.run(analyst._finalize(
                {"assenze_casa": [], "assenze_trasferta": [], "spiegazione": "Nessuna assenza."},
                self.fx, [{"title": "x", "url": "https://news.example/genoa"}], "groq"))
            self.assertEqual(fetch.await_count, 0)
            self.assertEqual(none["text"], "Nessuna assenza.")

            out = asyncio.run(analyst._finalize(
                {"assenze_casa": ["Malinovskyi"], "assenze_trasferta": [], "fattore_gol_casa": 0.92,
                 "fattore_gol_trasferta": 1.0, "spiegazione": "Malinovskyi out."},
                self.fx, [{"title": "sportsite.example", "url": "https://news.example/genoa"}], "gemini"))
        self.assertEqual(fetch.await_count, 1)
        self.assertEqual(out["factor_home"], 0.92)
        self.assertEqual(out["absences_home"], ["Malinovskyi"])
        self.assertEqual(out["validation_version"], analyst.VALIDATION_VERSION)
        # La pagina che conferma l'assenza viene mostrata tra le fonti, con il titolo vero.
        self.assertEqual(out["sources"][0]["url"], "https://news.example/genoa")
        self.assertIn("Genoa", out["sources"][0]["title"])

    def test_fetch_errors_do_not_break_the_analysis(self):
        with patch.object(analyst.evidence, "fetch_pages", AsyncMock(side_effect=RuntimeError("rete giù"))):
            out = asyncio.run(analyst._finalize(
                {"assenze_casa": ["Malinovskyi"], "assenze_trasferta": [], "fattore_gol_casa": 0.92,
                 "spiegazione": "x"}, self.fx, [], "groq"))
        self.assertEqual(out["factor_home"], 1.0)
        self.assertEqual(out["text"], analyst.NEUTRAL_TEXT)


if __name__ == "__main__":
    unittest.main()
