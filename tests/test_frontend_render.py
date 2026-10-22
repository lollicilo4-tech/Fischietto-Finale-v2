"""Esegue gli script della pagina con un DOM finto (tests/render_page.js) sui JSON pubblicati.

Serve a scoprire errori JavaScript che i controlli statici non vedono. Richiede Node.js
(presente sui runner di GitHub Actions); senza Node il test viene saltato.
"""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("node"), "Node.js non disponibile")
class FrontendRenderTests(unittest.TestCase):
    def render(self, league: str) -> dict:
        with tempfile.TemporaryDirectory() as out:
            subprocess.run(["node", str(ROOT / "tests" / "render_page.js"), str(ROOT), league, out],
                           check=True, capture_output=True, timeout=60)
            return json.loads((Path(out) / f"render-{league}.json").read_text(encoding="utf-8"))

    def test_pages_render_without_javascript_errors(self):
        for league in ("SA", "CL", "EL"):
            with self.subTest(league=league):
                result = self.render(league)
                self.assertEqual(result["errors"], [])
                self.assertIn('class="match"', result["matches"])

    def test_how_it_works_page_opens_and_closes(self):
        result = self.render("SA")
        self.assertTrue(result["infoOpen"], "Come funziona deve aprirsi dal piè di pagina")
        self.assertTrue(result["infoClosed"], "le schede devono richiudere Come funziona")

    def test_history_summary_is_shown(self):
        storico = json.loads((ROOT / "docs" / "storico.json").read_text(encoding="utf-8"))
        result = self.render("SA")
        if storico.get("n"):
            self.assertIn("In breve", result["verdict"])
            self.assertIn(f"Su {storico['n']} partite", result["verdict"])


if __name__ == "__main__":
    unittest.main()
