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


def run_render(root: Path, league: str) -> dict:
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(["node", str(ROOT / "tests" / "render_page.js"), str(root), league, out],
                       check=True, capture_output=True, timeout=60)
        return json.loads((Path(out) / f"render-{league}.json").read_text(encoding="utf-8"))


@unittest.skipUnless(shutil.which("node"), "Node.js non disponibile")
class FrontendRenderTests(unittest.TestCase):
    def render(self, league: str) -> dict:
        return run_render(ROOT, league)

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

    def test_my_slips_page(self):
        result = self.render("SA")
        self.assertEqual(result["errors"], [])
        self.assertIn("Il tuo andamento", result["mineEmpty"])
        self.assertIn("Non hai ancora segnato schedine", result["mineEmpty"])
        self.assertFalse(result["mineAddBad"], "una partita sconosciuta non entra nella schedina")
        if result.get("mineAdd"):
            self.assertIn("Salva schedina (1 partita)", result["mineDraft"])
        page = result["mineDraft"] + result.get("mineAfter", "")
        for word in ("quota", "importo", "€"):
            self.assertNotIn(word, page.replace("Niente importi", ""), "niente importi né quote nelle mie schedine")
        played = result.get("minePlayed")
        if played:
            self.assertEqual(result["mineImported"], 1, "le schedine non valide nel file vanno scartate")
            self.assertEqual(result["mineSettled"], 1)
            won = played["hg"] > played["ag"]
            self.assertIn(f"finale {played['hg']}-{played['ag']}", result["mineAfter"])
            self.assertIn("Vinta" if won else "Persa", result["mineAfter"])
            self.assertIn("<svg", result["mineAfter"])
            self.assertIn("Per tipo di giocata", result["mineAfter"])


class MySlipsHtmlTests(unittest.TestCase):
    def test_entry_points_and_no_betting_amounts(self):
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="p-mie"', html)
        self.assertGreaterEqual(html.count("data-open-mine"), 2, "Le mie schedine raggiungibile da Home e Schedina")
        section = html.split('id="p-mie"', 1)[1].split("</section>", 1)[0]
        self.assertIn("800 55 88 22", section)


@unittest.skipUnless(shutil.which("node"), "Node.js non disponibile")
class NewFeaturesRenderTests(unittest.TestCase):
    """Stessa pagina con i campi nuovi (fine stagione, forza squadre, ultima giornata), calcolati
    qui sui dati pubblicati, così il test non dipende dal prossimo aggiornamento automatico."""

    @classmethod
    def setUpClass(cls):
        from app import season, store
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        (root / "static").mkdir()
        shutil.copy(ROOT / "static" / "index.html", root / "static" / "index.html")
        shutil.copytree(ROOT / "docs", root / "docs", ignore=shutil.ignore_patterns("*.png", "CNAME"))
        predictions = json.loads((ROOT / "data" / "predictions.json").read_text(encoding="utf-8"))
        for code in ("SA", "CL"):
            prefix = "" if code == "SA" else f"league-{code}-"
            path = root / "docs" / f"{prefix}classifica.json"
            payload = json.loads(path.read_text(encoding="utf-8"))
            table = payload["table"]
            names = [r["team"] for r in table]
            teams = {n: {"att": 1.0 + (len(names) - k) / (4 * len(names)), "def": 1.0, "form": "VNP"} for k, n in enumerate(names)}
            remaining = [{"home": names[i], "away": names[(i + 1) % len(names)]} for i in range(len(names))]
            payload["ratings"] = teams
            payload["season"] = season.simulate(table, remaining, teams, 1.4, 1.1, -0.05, code, n=200)
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            hpath = root / "docs" / f"{prefix}storico.json"
            hist = json.loads(hpath.read_text(encoding="utf-8"))
            rows = [(k, v, {"id": k, "hg": v["result"]["hg"], "ag": v["result"]["ag"]})
                    for k, v in predictions.items() if v.get("league") == code and "result" in v]
            hist["recap"] = store.round_recap(rows)
            hpath.write_text(json.dumps(hist, ensure_ascii=False), encoding="utf-8")
        cls.results = {code: run_render(root, code) for code in ("SA", "CL")}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_no_javascript_errors(self):
        for code, result in self.results.items():
            with self.subTest(league=code):
                self.assertEqual(result["errors"], [])

    def test_season_table(self):
        self.assertIn("Come può finire la stagione", self.results["SA"]["season"])
        self.assertIn("Primo posto", self.results["SA"]["season"])
        self.assertIn("Prime 8 (agli ottavi)", self.results["CL"]["season"])
        self.assertNotIn("<1%", self.results["SA"]["season"].replace("&lt;1%", ""))

    def test_round_recap(self):
        if self.results["SA"]["recap"]:
            self.assertIn("ultima giornata", self.results["SA"]["recap"])

    def test_team_page_favourites_and_share(self):
        result = self.results["SA"]
        self.assertTrue(result["teamOpen"] and result["teamClosed"])
        self.assertIn("Segna il", result["team"])
        self.assertIn("Come può finire la stagione", result["team"])
        self.assertTrue(result["favOn"])
        self.assertIn('class="match fav"', result["matchesAfterFav"])
        self.assertIn("Le tue squadre", result["favStrip"])
        self.assertIn("non un invito a scommettere", result["share"]["text"])
        self.assertTrue(result["share"]["url"].startswith("https://fischiettofinale.com/?league=SA#m-"))


if __name__ == "__main__":
    unittest.main()
