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
                    len(re.findall(r"<style\\b", html, re.IGNORECASE)),
                    len(re.findall(r"</style\\s*>", html, re.IGNORECASE)),
                    "Blocchi CSS <style> non bilanciati",
                )
                self.assertEqual(
                    len(re.findall(r"<script\\b", html, re.IGNORECASE)),
                    len(re.findall(r"</script\\s*>", html, re.IGNORECASE)),
                    "Blocchi JavaScript <script> non bilanciati",
                )

    def test_static_html_has_no_duplicate_ids_or_broken_tab_targets(self):
        html = self.read(STATIC_HTML)
        ids = re.findall(r"""\\bid=["']([^"']+)["']""", html)
        duplicates = sorted({value for value in ids if ids.count(value) > 1})
        self.assertEqual(duplicates, [], f"ID HTML duplicati: {duplicates}")

        id_set = set(ids)
        targets = re.findall(r"""\\baria-controls=["']([^"']+)["']""", html)
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


if __name__ == "__main__":
    unittest.main()
