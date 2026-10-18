"""Offline regression checks for the static frontend and published GitHub Pages shell.

These checks do not call external services or consume AI/API tokens.
"""
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATIC_HTML = ROOT / "static" / "index.html"
PUBLISHED_HTML = ROOT / "docs" / "index.html"


class FrontendIntegrityTests(unittest.TestCase):
    def read(self, path: Path) -> str:
        self.assertTrue(path.is_file(), f"File interfaccia mancante: {path}")
        return path.read_text(encoding="utf-8")

    def test_style_and_script_blocks_are_balanced(self):
        for path in (STATIC_HTML, PUBLISHED_HTML):
            with self.subTest(path=path):
                html = self.read(path)
                self.assertEqual(
                    len(re.findall(r"<style\b", html, re.IGNORECASE)),
                    len(re.findall(r"</style\s*>", html, re.IGNORECASE)),
                    "Blocchi CSS <style> non bilanciati",
                )
                self.assertEqual(
                    len(re.findall(r"<script\b", html, re.IGNORECASE)),
                    len(re.findall(r"</script\s*>", html, re.IGNORECASE)),
                    "Blocchi JavaScript <script> non bilanciati",
                )

    def test_static_html_has_no_duplicate_ids_or_broken_tab_targets(self):
        html = self.read(STATIC_HTML)
        ids = re.findall(r"""\bid=["']([^"']+)["']""", html)
        duplicates = sorted({value for value in ids if ids.count(value) > 1})
        self.assertEqual(duplicates, [], f"ID HTML duplicati: {duplicates}")

        id_set = set(ids)
        targets = re.findall(r"""\baria-controls=["']([^"']+)["']""", html)
        missing = sorted({target for target in targets if target not in id_set})
        self.assertEqual(missing, [], f"Tab senza pannello associato: {missing}")

        for tab_id in ("t-home", "t-partite", "t-sicure", "t-schedina", "t-classifica", "t-storico"):
            self.assertIn(tab_id, id_set, f"Sezione di navigazione mancante: {tab_id}")

    def test_published_html_uses_static_json_routes(self):
        published = self.read(PUBLISHED_HTML)
        for endpoint in ("turno.json", "storico.json", "classifica.json"):
            self.assertIn(endpoint, published, f"Endpoint statico mancante: {endpoint}")
        for endpoint in ("/api/turno", "/api/storico", "/api/classifica"):
            self.assertNotIn(endpoint, published, f"Endpoint API non disponibile su Pages: {endpoint}")

    def test_source_html_keeps_api_routes_for_backend_deployment(self):
        source = self.read(STATIC_HTML)
        for endpoint in ("/api/turno", "/api/storico", "/api/classifica"):
            self.assertIn(endpoint, source, f"Endpoint backend rimosso dalla sorgente: {endpoint}")

    def test_published_html_matches_source_except_static_routes(self):
        source = self.read(STATIC_HTML)
        expected = source.replace("/api/turno", "turno.json")
        expected = expected.replace("/api/storico", "storico.json")
        expected = expected.replace("/api/classifica", "classifica.json")
        published = self.read(PUBLISHED_HTML)
        self.assertEqual(
            published,
            expected,
            "docs/index.html deve corrispondere a static/index.html, con solo le rotte adattate a Pages",
        )


    def test_live_data_requests_bypass_browser_http_cache(self):
        source = self.read(STATIC_HTML)
        self.assertEqual(source.count('{ cache: "no-store" }'), 3, "Partite, storico e classifica devono bypassare la cache HTTP")

    def test_service_worker_does_not_cache_dynamic_json(self):
        for path in (ROOT / "static" / "sw.js", ROOT / "docs" / "sw.js"):
            with self.subTest(path=path):
                worker = self.read(path)
                self.assertIn('const CACHE = "fischietto-v7";', worker)
                self.assertIn('url.pathname.endsWith(".json")', worker)
                self.assertIn('fetch(new Request(req, { cache: "no-store" }))', worker)

    def test_html_navigations_bypass_service_worker_cache(self):
        """A league URL such as ?league=BL1 must not receive stale cached HTML."""
        for path in (ROOT / "static" / "sw.js", ROOT / "docs" / "sw.js"):
            with self.subTest(path=path):
                worker = self.read(path)
                navigation_guard = 'if (req.mode === "navigate" || req.destination === "document")'
                data_guard = 'if (url.pathname.endsWith(".json")'
                self.assertIn(navigation_guard, worker)
                self.assertLess(
                    worker.index(navigation_guard),
                    worker.index(data_guard),
                    "Le navigazioni HTML devono bypassare la cache prima del fallback generico",
                )
                self.assertIn('fetch(new Request(req, { cache: "no-store" }))', worker)
                self.assertIn('catch(() => caches.match("./").then((hit) => hit || Response.error()))', worker)


    def test_live_center_trusts_provider_live_filter_without_narrow_local_whitelist(self):
        source = self.read(STATIC_HTML)
        self.assertIn(
            'status=live&limit=200',
            source,
            "Il feed deve richiedere al provider soltanto le partite live",
        )
        self.assertIn(
            "var live = matches;",
            source,
            "Le partite restituite dall'endpoint live non devono essere scartate da una whitelist locale di stati",
        )
        self.assertNotIn("matches.filter(isLiveMatch)", source)


    def test_live_center_has_fallback_for_empty_fixtures_feed(self):
        source = self.read(STATIC_HTML)
        self.assertIn(
            "/api/v1/fixtures/?sport=football&status=live&limit=200",
            source,
        )
        self.assertIn(
            "/api/widget/matches/?sport=football&limit=50",
            source,
            "Se il feed fixtures è vuoto, usa il widget pubblico come fallback",
        )
        self.assertIn(
            "usedWidgetFallback ? matches.filter(isLiveStatus) : matches",
            source,
            "Il fallback deve escludere partite finite e future",
        )


if __name__ == "__main__":
    unittest.main()
