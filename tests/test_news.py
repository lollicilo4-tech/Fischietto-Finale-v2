"""Ricerca gratuita di notizie (SearXNG, Tavily) e Gemini come lettore. Nessuna chiamata di rete."""
import asyncio
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

import httpx

import app.analyst as analyst
from app import news
from tests.test_evidence import ARTICLE_IT, page

FX = {"id": "m1", "home": "Genoa", "away": "Fiorentina"}
BASE = {"lh": 1.2, "la": 1.3, "p1": 0.35, "px": 0.28, "p2": 0.37}


def run_search(handler, env):
    with patch.dict(os.environ, env, clear=False):
        for key in ("SEARXNG_URL", "TAVILY_API_KEY"):
            if key not in env:
                os.environ.pop(key, None)
        return asyncio.run(news.search_news(FX, "SA", transport=httpx.MockTransport(handler)))


class SearchNewsTests(unittest.TestCase):
    def test_query_language_depends_on_league(self):
        self.assertIn("infortunati", news.search_query(FX, "SA"))
        self.assertIn("injuries", news.search_query(FX, "PL"))

    def test_searxng_first(self):
        calls = []

        def handler(request):
            calls.append(request.url.host)
            self.assertEqual(request.url.params["format"], "json")
            return httpx.Response(200, json={"results": [
                {"title": "Genoa, le ultime", "url": "https://a.example/1"},
                {"title": "Fiorentina news", "url": "https://b.example/2"},
                {"title": "duplicato", "url": "https://a.example/1"},
                {"title": "non http", "url": "ftp://x"},
            ]})

        results, provider = run_search(handler, {"SEARXNG_URL": "http://localhost:8080", "TAVILY_API_KEY": "k"})
        self.assertEqual(provider, "searxng")
        self.assertEqual([r["url"] for r in results], ["https://a.example/1", "https://b.example/2"])
        self.assertEqual(calls, ["localhost"], "con SearXNG funzionante Tavily non viene usato")

    def test_tavily_when_searxng_is_down(self):
        def handler(request):
            if request.url.host == "localhost":
                return httpx.Response(503)
            body = json.loads(request.content)
            self.assertEqual(request.headers["Authorization"], "Bearer chiave")
            self.assertEqual(body["search_depth"], "basic")
            return httpx.Response(200, json={"results": [{"title": "t", "url": "https://c.example/3"}]})

        results, provider = run_search(handler, {"SEARXNG_URL": "http://localhost:8080", "TAVILY_API_KEY": "chiave"})
        self.assertEqual(provider, "tavily")
        self.assertEqual(results[0]["url"], "https://c.example/3")

    def test_tavily_retries_general_web_only_when_news_is_empty(self):
        bodies = []

        def handler(request):
            bodies.append(json.loads(request.content))
            if bodies[-1]["topic"] == "news":
                return httpx.Response(200, json={"results": []})
            return httpx.Response(200, json={"results": [{"title": "t", "url": "https://d.example/4"}]})

        results, provider = run_search(handler, {"TAVILY_API_KEY": "chiave"})
        self.assertEqual([b["topic"] for b in bodies], ["news", "general"])
        self.assertEqual(provider, "tavily")

    def test_nothing_configured(self):
        results, provider = run_search(lambda request: httpx.Response(500), {})
        self.assertEqual((results, provider), ([], None))


class FallbackTests(unittest.TestCase):
    def test_gemini_reads_articles_found_by_the_app(self):
        sources = [{"title": "Genoa, le ultime", "url": "https://news.example/genoa"}]
        data = {"assenze_casa": ["Malinovskyi"], "assenze_trasferta": [], "fattore_gol_casa": 0.92,
                "fattore_gol_trasferta": 1.0, "spiegazione": "Malinovskyi salta la partita."}
        with patch.dict(os.environ, {"GEMINI_API_KEY": "g", "SEARXNG_URL": "http://localhost:8080"}), \
                patch.object(analyst.news, "search_news", AsyncMock(return_value=(sources, "searxng"))), \
                patch.object(analyst.evidence, "fetch_pages",
                             AsyncMock(return_value=[page(ARTICLE_IT, "https://news.example/genoa")])), \
                patch.object(analyst, "_ask_gemini_reader", AsyncMock(return_value=data)) as reader, \
                patch.object(analyst, "_ask_gemini", AsyncMock()) as grounding:
            out = asyncio.run(analyst._ask_fallback(FX, BASE, "SA"))
        reader.assert_awaited_once()
        grounding.assert_not_awaited()
        self.assertEqual(out["provider"], "gemini")
        self.assertEqual(out["search_provider"], "searxng")
        self.assertEqual(out["factor_home"], 0.92)
        self.assertEqual(out["absences_home"], ["Malinovskyi"])
        self.assertEqual(out["sources"][0]["url"], "https://news.example/genoa")

    def test_without_articles_falls_back_to_gemini_with_search(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "g", "TAVILY_API_KEY": "t"}), \
                patch.object(analyst.news, "search_news", AsyncMock(return_value=([], None))), \
                patch.object(analyst, "_ask_gemini", AsyncMock(return_value={"ai": True})) as grounding:
            asyncio.run(analyst._ask_fallback(FX, BASE, "SA"))
        grounding.assert_awaited_once()

    def test_excerpt_keeps_relevant_sentences(self):
        text = "Menu Home Notizie\n" + "Pubblicità varia.\n" * 50 + "Genoa: Malinovskyi out per lesione."
        excerpt = analyst._excerpt(text, FX, limit=200)
        self.assertIn("Malinovskyi out", excerpt)
        self.assertNotIn("Pubblicità", excerpt)


if __name__ == "__main__":
    unittest.main()
