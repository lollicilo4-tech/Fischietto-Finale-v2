"""Testi in inglese per le pagine /en/ del sito: spiegazioni del modello, testo a regole e testo dell'AI.
Nessuna chiamata di rete: le risposte dell'AI sono finte."""
import asyncio
import re
import unittest
from unittest.mock import AsyncMock, patch

import app.analyst as analyst
from app import explain

# Parole italiane che non devono comparire nei testi inglesi.
ITALIAN = re.compile(r"\b(della|del|gol|segna|subisce|media|campionato|squadra|partita|modello|"
                     r"stima|assenze|fonti|pareggio|favorita|casa|trasferta|probabilità)\b", re.IGNORECASE)

TEAMS = {
    "Inter": {"att": 1.26, "def": 0.81, "form": "VVNPV"},
    "Milan": {"att": 0.92, "def": 1.08, "form": "PNVVN"},
}


class ExplainTests(unittest.TestCase):
    def test_every_reason_has_an_english_sentence(self):
        out = explain.explain_match(TEAMS, 1.6, 1.2, "Inter", "Milan", 1.92, 1.05, 0.94, 1.0, 1)
        self.assertTrue(out["items"])
        for item in out["items"]:
            self.assertTrue(item["text_en"], item)
            self.assertIsNone(ITALIAN.search(item["text_en"]), item["text_en"])
        texts = " ".join(i["text_en"] for i in out["items"])
        self.assertIn("Inter attack: scores 26% more than the league average.", texts)
        self.assertIn("Inter defence: concedes 19% less than average.", texts)
        self.assertIn("Home advantage: in this league the home side scores on average 33% more than the away side.", texts)
        self.assertIn("Recent form: Inter WWDLW, Milan LDWWD", texts)
        self.assertIn("Absences confirmed by sources (1): expected goals adjusted by Inter -6%.", texts)
        self.assertEqual(out["summary_en"], "Putting these factors together, the model expects 1.9 goals for Inter "
                                            "and 1.1 for Milan: the probability of every score comes from here.")
        # L'italiano resta com'era.
        self.assertIn("Attacco Inter: segna il 26% in più della media del campionato.", [i["text"] for i in out["items"]])
        self.assertIn("1,9 gol per Inter", out["summary"])

    def test_average_team(self):
        out = explain.explain_match({"A": {"att": 1.0, "def": 1.0}, "B": {"att": 1.0, "def": 1.0}}, 1.3, 1.3, "A", "B", 1.3, 1.3)
        self.assertIn("A attack: in line with the league average.", [i["text_en"] for i in out["items"]])


class FallbackTests(unittest.TestCase):
    def test_rule_based_text_in_english(self):
        fx = {"home": "Inter", "away": "Milan"}
        for base, expected in (
            ({"lh": 1.9, "la": 0.8, "p1": 0.62, "px": 0.22, "p2": 0.16}, "Inter start as favourites (62%), helped by home advantage."),
            ({"lh": 0.7, "la": 1.8, "p1": 0.15, "px": 0.25, "p2": 0.60}, "Milan are favourites even away from home (60%)."),
            ({"lh": 1.2, "la": 1.1, "p1": 0.38, "px": 0.31, "p2": 0.31}, "An open match: no outcome is above 50%. A draw remains plausible (31%)."),
        ):
            out = analyst.fallback_analysis(fx, base, {})
            self.assertIn(expected, out["text_en"])
            self.assertTrue(out["text_en"].startswith(f"The model expects {base['lh']:.1f} goals for Inter"))
            self.assertIsNone(ITALIAN.search(out["text_en"]), out["text_en"])


class AiTextTests(unittest.TestCase):
    fx = {"home": "Genoa", "away": "Fiorentina"}
    sources = [{"title": "Genoa news", "url": "https://news.example/genoa"}]

    def finalize(self, data, sources=None):
        with patch.object(analyst.evidence, "fetch_pages", AsyncMock(return_value=[])):
            return asyncio.run(analyst._finalize(data, self.fx, self.sources if sources is None else sources, "groq"))

    def test_ai_english_explanation_is_kept(self):
        out = self.finalize({"assenze_casa": [], "assenze_trasferta": [], "fattore_gol_casa": 1.0, "fattore_gol_trasferta": 1.0,
                             "spiegazione": "Nessuna assenza confermata.", "spiegazione_en": "No confirmed absences."})
        self.assertEqual(out["text"], "Nessuna assenza confermata.")
        self.assertEqual(out["text_en"], "No confirmed absences.")

    def test_missing_english_gets_a_text_from_verified_facts(self):
        out = self.finalize({"assenze_casa": [], "assenze_trasferta": [], "fattore_gol_casa": 1.0, "fattore_gol_trasferta": 1.0,
                             "spiegazione": "Nessuna assenza confermata."})
        self.assertIn("no unavailable player was confirmed", out["text_en"])

    def test_unconfirmed_absences_use_the_neutral_english_text(self):
        out = self.finalize({"assenze_casa": ["Malinovskyi"], "assenze_trasferta": [], "fattore_gol_casa": 0.92,
                             "spiegazione": "Malinovskyi out.", "spiegazione_en": "Malinovskyi is out."})
        self.assertEqual(out["text"], analyst.NEUTRAL_TEXT)
        self.assertEqual(out["text_en"], analyst.NEUTRAL_TEXT_EN)

    def test_no_sources(self):
        out = self.finalize({"spiegazione": "x", "spiegazione_en": "y"}, sources=[])
        self.assertEqual(out["text_en"], analyst.NO_SOURCES_TEXT_EN)

    def test_english_betting_sentences_are_removed(self):
        ai = {"ai": True, "text": "Assenza confermata.", "text_en": "Confirmed absence. Bookmakers see Genoa as favourites."}
        self.assertEqual(analyst.publishable(ai)["text_en"], "Confirmed absence.")
        only = {"ai": True, "text": "Assenza confermata.", "text_en": "The odds favour Genoa."}
        self.assertEqual(analyst.publishable(only)["text_en"], analyst.BETTING_FREE_TEXT_EN)
        clean = {"ai": True, "text": "Assenza confermata.", "text_en": "Confirmed absence."}
        self.assertIs(analyst.publishable(clean), clean)

    def test_cached_analysis_without_english(self):
        cached = {"ai": True, "text": "x", "absences_home": ["Malinovskyi"], "absences_away": [], "sources": self.sources}
        self.assertEqual(analyst.english_text(cached, self.fx),
                         "Absences confirmed by sources — Genoa: Malinovskyi. The model's expected goals are adjusted only for these players.")
        self.assertEqual(analyst.english_text({"ai": True, "sources": []}, self.fx), analyst.NO_SOURCES_TEXT_EN)

    def test_prompts_ask_for_english(self):
        self.assertIn("spiegazione_en", analyst.SYSTEM)
        self.assertIn("spiegazione_en", analyst.READER_SYSTEM)


if __name__ == "__main__":
    unittest.main()
