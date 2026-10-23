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

    def test_live_charts(self):
        live = self.render("SA")["live"]
        named = live["named"]
        self.assertIn("Andamento della partita", named)
        self.assertIn('class="lc-timeline"', named)
        self.assertIn("Probabilità minuto per minuto", named)
        self.assertIn("Possesso palla", named)
        self.assertIn("Tiri in porta", named)
        self.assertIn("invito a scommettere", named)
        self.assertIn("Tiri totali", live["sided"])
        self.assertIn('class="lc-prob"', live["sided"])
        self.assertIn("Chi vince adesso?", live["partial"])
        self.assertNotIn('class="lc-prob"', live["partial"])
        self.assertEqual(live["empty"], "")
        curve = live["curve"]
        self.assertEqual(len(curve), 81)
        self.assertGreater(curve[-1]["p1"], curve[0]["p1"], "in vantaggio all'80' la probabilità di vittoria cresce")
        self.assertAlmostEqual(curve[40]["p1"] + curve[40]["px"] + curve[40]["p2"], 1.0, places=6)

    def test_live_charts_with_real_sportscore_payload(self):
        """tests/fixtures/sportscore_match.json è una risposta vera di api/widget/match (Zira-Sumgayit, 61')."""
        live = self.render("SA")["live"]
        events = live["realEvents"]
        self.assertEqual([(e["minute"], e["kind"], e["side"]) for e in events],
                         [(8, "goal", "home"), (10, "yellow", "home"), (21, "goal", "home"),
                          (39, "goal", "away"), (56, "goal", "away")], "il VAR non è un evento del grafico")
        labels = {s["label"]: (s["home"], s["away"]) for s in live["realStats"]}
        self.assertEqual(labels["Attacchi pericolosi"], (20, 35))
        self.assertEqual(labels["Tiri fuori"], (4, 2))
        self.assertEqual(labels["Possesso palla"], (45, 55))
        real = live["real"]
        self.assertIn('class="lc-timeline"', real)
        self.assertIn('class="lc-prob"', real, "i gol del feed spiegano il 2-2: c'è la curva completa")
        self.assertNotIn("Momentum", real, "senza campioni registrati niente momentum")

    def test_momentum_estimate(self):
        live = self.render("SA")["live"]
        samples = live["momentumSamples"]
        self.assertEqual([s["m"] for s in samples], [61, 62, 64, 74], "stesso minuto: il campione viene aggiornato")
        bars = {b["m"]: b["v"] for b in live["momentumBars"]}
        self.assertEqual(sorted(bars), [62, 63, 64], "oltre 5 minuti senza dati il tratto resta vuoto")
        self.assertLess(bars[62], 0, "al 62' attaccano gli ospiti (+5 attacchi pericolosi, +1 tiro in porta)")
        self.assertGreater(bars[63], 0)
        self.assertAlmostEqual(bars[63], bars[64])
        html = live["momentumHtml"]
        self.assertIn("Momentum (stima)", html)
        self.assertIn('class="lc-momentum"', html)
        self.assertIn('class="lc-gap"', html)
        self.assertIn("Non è il momentum di Sofascore", html)
        self.assertLess(html.index("lc-momentum"), html.index("lc-prob"), "il momentum va sotto la linea del tempo")
        first = live["momentumFirst"]
        self.assertIn("il primo tratto compare dopo il prossimo aggiornamento", first)
        self.assertNotIn('class="lc-momentum"', first)
        self.assertLess(first.index("Momentum"), first.index("Chi vince"), "senza linea del tempo il momentum va in cima")

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


@unittest.skipUnless(shutil.which("node"), "Node.js non disponibile")
class NewFeaturesRenderTests(unittest.TestCase):
    """Stessa pagina con i campi nuovi (fine stagione, forza squadre, ultima giornata), calcolati
    qui sui dati pubblicati, così il test non dipende dal prossimo aggiornamento automatico."""

    @classmethod
    def setUpClass(cls):
        from app import explain, season, store
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
            payload["stats"] = explain.team_stats(
                [{"home": names[i], "away": names[(i + 1) % len(names)], "hg": i % 3, "ag": 1} for i in range(len(names))])
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            tpath = root / "docs" / f"{prefix}turno.json"
            turno = json.loads(tpath.read_text(encoding="utf-8"))
            for m in turno["matches"]:
                if m["home"] in teams and m["away"] in teams:
                    m["explain"] = explain.explain_match(teams, 1.4, 1.1, m["home"], m["away"], m["xg"][0], m["xg"][1])
            upcoming = [{"id": f"n{i}", "home": names[i], "away": names[(i + 2) % len(names)],
                         "kickoff": "2099-11-0%dT15:00:00Z" % (1 + i // 10), "matchday": 50 + i // 10}
                        for i in range(len(names))]
            turno["next_rounds"] = explain.upcoming_rounds(upcoming, set(), teams, 1.4, 1.1, -0.05)
            tpath.write_text(json.dumps(turno, ensure_ascii=False), encoding="utf-8")
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

    def test_why_panel_and_next_rounds(self):
        result = self.results["SA"]
        self.assertIn("Perché il modello dice così", result["matches"])
        self.assertIn("Prossime giornate", result["nextRounds"])
        self.assertIn('class="nr-row"', result["nextRounds"])

    def test_team_stats_and_upcoming(self):
        team = self.results["SA"]["team"]
        self.assertIn("Statistiche stagione", team)
        self.assertIn("Senza subire gol", team)
        self.assertNotIn("Segna il Nella media", team)

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
