"""Verifica delle assenze sul testo degli articoli (nessuna chiamata di rete)."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

import app.analyst as analyst
from app.analyst import _text_confirms_absence, _validate_absences
from app.evidence import fetch_pages, html_to_text
from generate import summarize_verification


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


class DiagnosticsTests(unittest.TestCase):
    fx = {"home": "Genoa", "away": "Fiorentina"}

    def reasons(self, home, pages):
        data = {"assenze_casa": list(home), "assenze_trasferta": [], "fattore_gol_casa": 0.9,
                "spiegazione": "x"}
        return _validate_absences(data, self.fx, [], pages)["reasons"]

    def test_reason_for_each_kind_of_miss(self):
        it = [page(ARTICLE_IT)]
        self.assertEqual(self.reasons(["Frendrup"], it), {"incertezza": 1})
        self.assertEqual(self.reasons(["Retegui"], it), {"giocatore_assente": 1})
        self.assertEqual(self.reasons(["Malinovskyi"], []), {"nessuna_pagina_letta": 1})
        data = {"assenze_casa": ["Malinovskyi"], "assenze_trasferta": [], "spiegazione": "x"}
        no_sources = _validate_absences(data, self.fx, [], [], attempted=False)
        self.assertEqual(no_sources["reasons"], {"nessuna_fonte": 1})
        self.assertEqual(self.reasons(["Obert (in dubbio)"], it), {"dichiarata_incerta": 1})
        other_team = {"url": "u", "final_url": "u", "title": "", "text": "Torino: Zapata out per infortunio."}
        self.assertEqual(self.reasons(["Zapata"], [other_team]), {"squadra_assente": 1})
        no_confirm = {"url": "u", "final_url": "u", "title": "",
                      "text": "Genoa, Malinovskyi ha segnato una doppietta nell'ultima partita."}
        self.assertEqual(self.reasons(["Malinovskyi"], [no_confirm]), {"nessuna_conferma": 1})

    def test_confirmed_absences_have_no_reason(self):
        self.assertEqual(self.reasons(["Malinovskyi"], [page(ARTICLE_IT)]), {})

    def test_finalize_publishes_diagnostics_without_article_text(self):
        async def fake_fetch(sources, report=None, **kwargs):
            report.extend([{"host": "news.example", "status": "ok", "chars": 500},
                           {"host": "blocked.example", "status": "http_403", "chars": 0}])
            return [page(ARTICLE_IT)]
        with patch.object(analyst.evidence, "fetch_pages", side_effect=fake_fetch):
            out = asyncio.run(analyst._finalize(
                {"assenze_casa": ["Malinovskyi", "Retegui"], "assenze_trasferta": [],
                 "fattore_gol_casa": 0.9, "spiegazione": "x"},
                self.fx, [{"title": "a", "url": "https://news.example/a"}], "groq"))
        info = out["verification"]
        self.assertEqual((info["claimed"], info["confirmed"]), (2, 1))
        self.assertEqual(info["reasons"], {"giocatore_assente": 1})
        self.assertEqual([p["status"] for p in info["pages"]], ["ok", "http_403"])
        self.assertNotIn("text", str(info))

    def test_league_summary(self):
        turno = {"matches": [
            {"analysis": {"verification": {"claimed": 2, "confirmed": 1, "reasons": {"incertezza": 1},
                                           "pages": [{"status": "ok"}, {"status": "http_403"}]}}},
            {"analysis": {"verification": {"claimed": 1, "confirmed": 0, "reasons": {"incertezza": 1},
                                           "pages": [{"status": "http_403"}]}}},
            {"analysis": {}},
        ]}
        stats = summarize_verification(turno)
        self.assertEqual((stats["claimed"], stats["confirmed"]), (3, 1))
        self.assertEqual(stats["reasons"], {"incertezza": 2})
        self.assertEqual(stats["pages"], {"ok": 1, "http_403": 2})


class FetchPagesTests(unittest.TestCase):
    def test_outcome_of_each_page_is_reported(self):
        def handler(request):
            path = request.url.path
            if path == "/ok":
                return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=ARTICLE_IT)
            if path == "/blocked":
                return httpx.Response(403, text="no")
            if path == "/pdf":
                return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF")
            if path == "/js":
                return httpx.Response(200, headers={"content-type": "text/html"},
                                      text="<html><body><script>render()</script></body></html>")
            if path == "/redirect":
                return httpx.Response(302, headers={"location": "https://articoli.example/ok"})
            return httpx.Response(404)

        sources = [{"title": "t", "url": f"https://news.example/{p}"} for p in ("ok", "blocked", "pdf", "js", "redirect")]
        report = []
        pages = asyncio.run(fetch_pages(sources, report=report, transport=httpx.MockTransport(handler)))
        self.assertEqual([r["status"] for r in report], ["ok", "http_403", "non_html", "vuota", "ok"])
        self.assertEqual(report[4]["host"], "articoli.example", "l'host è quello finale, dopo il redirect")
        self.assertEqual(len(pages), 2)
        self.assertEqual(pages[1]["final_url"], "https://articoli.example/ok")


if __name__ == "__main__":
    unittest.main()
