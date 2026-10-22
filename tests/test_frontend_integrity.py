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

    def test_responsible_gaming_notice_and_how_it_works(self):
        html = self.read(STATIC_HTML)
        self.assertIn("vietato ai minori di 18 anni", html)
        self.assertIn('href="tel:800558822"', html, "Telefono Verde Nazionale (ISS) per il gioco d'azzardo")
        self.assertIn('id="p-info"', html)
        self.assertGreaterEqual(html.count("data-open-info"), 2, "Come funziona raggiungibile da Home e piè di pagina")
        self.assertIn('querySelectorAll(".tile[data-go]")', html, "le tessere senza data-go non devono rompere i clic")

    def test_ai_label_requires_real_sources(self):
        html = self.read(STATIC_HTML)
        self.assertIn('a.ai && a.sources.length ? "Analisi con le ultime notizie"', html)
        self.assertIn("Corretto per assenze", html)

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

    def test_service_worker_serves_fresh_json_with_offline_fallback(self):
        for path in (ROOT / "static" / "sw.js", ROOT / "docs" / "sw.js"):
            with self.subTest(path=path):
                worker = self.read(path)
                self.assertIn('const CACHE = "fischietto-v8";', worker)
                self.assertIn('url.pathname.endsWith(".json")', worker)
                self.assertIn('fetch(new Request(req, { cache: "no-store" }))', worker)
                # Rete prima; la copia salvata solo se la rete non risponde.
                self.assertIn('.catch(() => offlineCopy(req))', worker)
                self.assertIn('k !== CACHE && k !== DATA_CACHE', worker, "La copia dei dati non va cancellata all'aggiornamento")

    def test_page_warns_when_showing_offline_data(self):
        source = self.read(ROOT / "static" / "index.html")
        self.assertIn('r.headers.get("X-Fischietto-Offline")', source)
        self.assertIn("Offline · ultimi dati salvati", source)

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
            "m._ffLiveVerified === true || isLiveStatus(m)",
            source,
            "Le righe del feed filtrato dal provider sono attendibili; il fallback va filtrato localmente",
        )
        self.assertIn("Promise.all(liveEndpoints.map", source)
        self.assertIn("var combined = [], positions = {};", source)
        self.assertIn("return {matches:combined};", source)
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
            "/api/v1/matches/?sport=football&limit=50",
            source,
            "Il secondo endpoint documentato va interrogato come ulteriore fonte",
        )
        self.assertIn(
            "Promise.all(liveEndpoints.map",
            source,
            "Tutte le fonti devono essere interrogate invece di fermarsi alla prima risposta non vuota",
        )
        self.assertIn(
            "return m._ffLiveVerified === true || isLiveStatus(m)",
            source,
            "Le partite provenienti dai fallback devono essere filtrate per stato live",
        )
        self.assertIn("sourceIdentity(candidate)", source, "Le partite duplicate tra fonti vanno deduplicate")


if __name__ == "__main__":
    unittest.main()
