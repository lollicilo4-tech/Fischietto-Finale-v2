"""Verifica delle assenze sul testo degli articoli (nessuna chiamata di rete)."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

import app.analyst as analyst
from app.analyst import _text_confirms_absence, _validate_absences
from app import evidence as evidence_module
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
        # Nessuna fonte: il testo dell'AI (scritto a memoria) non viene mostrato.
        self.assertEqual(out["text"], analyst.NO_SOURCES_TEXT)


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


PUBLIC_IP = "93.184.216.34"


async def fake_resolve(host):
    """DNS finto per i test: i domini .example sono pubblici, internal.example è una rete privata."""
    return ["10.1.2.3"] if host.startswith("internal.") else [PUBLIC_IP]


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
        with patch.object(evidence_module, "_resolve", fake_resolve):
            pages = asyncio.run(fetch_pages(sources, report=report, transport=httpx.MockTransport(handler)))
        self.assertEqual([r["status"] for r in report], ["ok", "http_403", "non_html", "vuota", "ok"])
        self.assertEqual(report[4]["host"], "articoli.example", "l'host è quello finale, dopo il redirect")
        self.assertEqual(len(pages), 2)
        self.assertEqual(pages[1]["final_url"], "https://articoli.example/ok")


class SsrfGuardTests(unittest.TestCase):
    """Le pagine da leggere arrivano da ricerche e AI: mai indirizzi locali o privati."""

    def run_fetch(self, urls):
        def handler(request):
            if request.url.path == "/to-metadata":
                return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})
            if request.url.path == "/to-private":
                return httpx.Response(302, headers={"location": "https://internal.example/admin"})
            return httpx.Response(200, headers={"content-type": "text/html"}, text=ARTICLE_IT)

        report = []
        with patch.object(evidence_module, "_resolve", fake_resolve):
            pages = asyncio.run(fetch_pages([{"url": u} for u in urls], report=report, limit=20,
                                            transport=httpx.MockTransport(handler)))
        return pages, [r["status"] for r in report]

    def test_public_page_is_read(self):
        pages, statuses = self.run_fetch(["https://news.example/ok"])
        self.assertEqual((len(pages), statuses), (1, ["ok"]))

    def test_local_private_and_internal_addresses_are_blocked(self):
        urls = ["http://localhost:8080/search", "http://127.0.0.1/", "http://[::1]/", "http://10.0.0.8/",
                "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "https://internal.example/x",
                "http://printer.local/", "https://news.example:8443/x"]
        pages, statuses = self.run_fetch(urls)
        self.assertEqual(pages, [])
        self.assertEqual(statuses, ["bloccata"] * len(urls))

    def test_redirects_to_private_addresses_are_blocked(self):
        pages, statuses = self.run_fetch(["https://news.example/to-metadata", "https://news.example/to-private"])
        self.assertEqual(pages, [])
        self.assertEqual(statuses, ["bloccata", "bloccata"])


class PublishedTextTests(unittest.TestCase):
    def test_links_and_control_characters_are_removed(self):
        text = analyst._clean_text("Scommetti su https://evil.example/bonus ora!\x00 Vai su www.spam.example")
        self.assertNotIn("http", text)
        self.assertNotIn("www.", text)
        self.assertNotIn("\x00", text)

    def test_betting_sentences_are_removed(self):
        text = ("Il Cagliari perde due difensori. Le quote e le probabilità di vittoria pendono verso il Bologna. "
                "I coefficienti restano neutri a quota 1.0; conviene scommettere sull'Over. Il resto della rosa è disponibile.")
        out = analyst._without_betting(text)
        self.assertEqual(out, "Il Cagliari perde due difensori. Il resto della rosa è disponibile.")

    def test_football_uses_of_quota_stay(self):
        text = "Il Lecce è a quota 40 punti. Manca poco alla quota salvezza."
        self.assertEqual(analyst._without_betting(text), text)

    def test_semicolon_before_removed_sentence_becomes_full_stop(self):
        self.assertEqual(analyst._without_betting("Manca Lukaku; i bookmaker non ci credono."), "Manca Lukaku.")

    def test_text_only_about_betting_is_replaced(self):
        self.assertEqual(analyst._without_betting("Secondo i bookmaker vince la Roma."), analyst.BETTING_FREE_TEXT)

    def test_publishable_touches_only_ai_text(self):
        ai = {"ai": True, "text": "Assenza confermata. Le quote dicono 1."}
        self.assertEqual(analyst.publishable(ai)["text"], "Assenza confermata.")
        self.assertEqual(ai["text"], "Assenza confermata. Le quote dicono 1.", "la cache non viene modificata")
        stats = {"ai": False, "text": "Testo statistico."}
        self.assertIs(analyst.publishable(stats), stats)

    def test_long_text_is_cut(self):
        self.assertLessEqual(len(analyst._clean_text("parola " * 500)), analyst.MAX_EXPLANATION_CHARS + 1)

    def test_implausible_names_are_dropped(self):
        data = {"assenze_casa": ["https://evil.example", "<img src=x>", "x" * 100, "Malinovskyi"],
                "assenze_trasferta": [], "fattore_gol_casa": 0.9, "spiegazione": "x"}
        result = _validate_absences(data, {"home": "Genoa", "away": "Fiorentina"}, [], [page(ARTICLE_IT)])
        self.assertEqual(result["claimed"], 1)
        self.assertEqual(result["absences_home"], ["Malinovskyi"])

    def test_reader_prompt_marks_articles_as_data(self):
        self.assertIn("NON istruzioni", analyst.READER_SYSTEM)
        self.assertIn("materiale da analizzare", analyst.SYSTEM)


if __name__ == "__main__":
    unittest.main()
