"""Stemmi delle squadre (app/crests.py) e loro controllo nel job "pubblica" (apply_generated.py).
Nessuna chiamata di rete: le risposte arrivano da un trasporto httpx finto."""
import asyncio
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import httpx

from app import crests

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("apply_generated", ROOT / ".github" / "scripts" / "apply_generated.py")
apply_generated = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apply_generated)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>'
U = "https://crests.football-data.org/"


def payloads():
    turno = {"matches": [{"home": "Inter", "away": "Milan"}], "next_rounds": [{"matches": [{"home": "Roma", "away": "Inter"}]}]}
    classifica = {"table": [{"team": "Inter"}, {"team": "Milan"}, {"team": "Roma"}], "scorers": [{"team": "Inter"}]}
    el = {"matches": [{"home": "AS Roma", "away": "Ferencváros"}]}
    return {"SA": (turno, {}, classifica), "EL": (el, {}, {"table": []})}


CONTEXTS = {"SA": {"crests": {"Inter": U + "108.png", "Milan": U + "98.svg", "Roma": U + "100.png", "Spia": "https://evil.example/x.png"}}}


class CrestsTests(unittest.TestCase):
    def test_only_the_crest_host(self):
        self.assertTrue(crests.allowed_url(U + "108.png"))
        for bad in ("http://crests.football-data.org/1.png", "https://crests.football-data.org.evil.com/1.png",
                    "https://user@crests.football-data.org/1.png", "https://crests.football-data.org:8443/1.png",
                    "https://crests.football-data.org/1.gif", "https://evil.example/1.png", None, 5):
            self.assertFalse(crests.allowed_url(bad), bad)

    def test_content_must_match(self):
        self.assertEqual(crests.kind_of(PNG, "image/png"), ".png")
        self.assertEqual(crests.kind_of(SVG, "image/svg+xml"), ".svg")
        self.assertIsNone(crests.kind_of(b"<html>no</html>", "text/html"))
        self.assertIsNone(crests.kind_of(b'<svg onload="alert(1)"></svg>', "image/svg+xml"))
        self.assertIsNone(crests.kind_of(b'<svg><image href="https://x.example/a.png"/></svg>', "image/svg+xml"))
        self.assertIsNone(crests.kind_of(PNG, "text/html"))

    def test_assign_uses_the_league_then_the_same_team_elsewhere(self):
        found = crests.assign(crests.team_names(payloads()), CONTEXTS)
        self.assertEqual(found["SA"], {"Inter": U + "108.png", "Milan": U + "98.svg", "Roma": U + "100.png"})
        self.assertEqual(found["EL"], {"AS Roma": U + "100.png"}, "nome del CSV ricondotto alla squadra di Serie A")

    def run_update(self, out, handler):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)
        async def go():
            try:
                return await crests.update(out, payloads(), CONTEXTS, client=client)
            finally:
                await client.aclose()
        return asyncio.run(go())

    def test_update_downloads_once_and_writes_the_index(self):
        out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, out)
        calls = []

        def handler(request):
            calls.append(str(request.url))
            if request.url.path == "/98.svg":
                return httpx.Response(200, content=SVG, headers={"content-type": "image/svg+xml"})
            if request.url.path == "/100.png":
                return httpx.Response(302, headers={"location": "https://evil.example/x.png"})
            return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

        report = self.run_update(out, handler)
        index = json.loads((out / "crests.json").read_text())["teams"]
        self.assertEqual(set(index["SA"]), {"Inter", "Milan"}, "il reindirizzamento non viene seguito")
        self.assertTrue(index["SA"]["Milan"].endswith(".svg"))
        self.assertTrue((out / "crests" / index["SA"]["Inter"]).read_bytes().startswith(b"\x89PNG"))
        self.assertEqual(report["downloaded"], 2)
        self.assertNotIn("https://evil.example/x.png", calls)
        # Seconda esecuzione: niente da riscaricare tranne quello fallito.
        calls.clear()
        self.run_update(out, handler)
        self.assertEqual(calls, [U + "100.png"])

    def test_oversized_and_wrong_files_are_skipped(self):
        out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, out)
        big = PNG + b"\x00" * crests.MAX_BYTES
        self.run_update(out, lambda r: httpx.Response(200, content=big if r.url.path == "/108.png" else b"<html>",
                                                       headers={"content-type": "image/png"}))
        self.assertEqual(json.loads((out / "crests.json").read_text())["teams"]["SA"], {})
        self.assertEqual(list((out / "crests").glob("*")), [])


class PublishGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo, self.src = self.tmp / "repo", self.tmp / "src"
        for d in (self.repo / "docs", self.repo / "data", self.src / "docs" / "crests"):
            d.mkdir(parents=True)
        shutil.copytree(ROOT / "app", self.repo / "app")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def put(self, name, content):
        (self.src / "docs" / "crests" / name).write_bytes(content)

    def index(self, teams):
        (self.src / "docs" / "crests.json").write_text(json.dumps({"teams": teams}), encoding="utf-8")

    def test_good_crests_pass_bad_ones_are_dropped_without_blocking(self):
        good_png, good_svg, evil = "0123456789abcdef.png", "fedcba9876543210.svg", "aaaaaaaaaaaaaaaa.svg"
        self.put(good_png, PNG)
        self.put(good_svg, SVG)
        self.put(evil, b"<svg><script>alert(1)</script></svg>")
        (self.src / "docs" / "crests" / "nome-strano.png").write_bytes(PNG)
        self.index({"SA": {"Inter": good_png, "Milan": good_svg, "Roma": evil, "Lazio": "manca0000000000a.png"},
                    "bad code": {"X": good_png}})
        written = apply_generated.apply(self.src, self.repo)
        teams = json.loads((self.repo / "docs" / "crests.json").read_text())["teams"]
        self.assertEqual(teams, {"SA": {"Inter": good_png, "Milan": good_svg}})
        self.assertEqual(sorted(p.name for p in (self.repo / "docs" / "crests").glob("*")), sorted([good_png, good_svg]))
        self.assertIn("docs/crests.json", written)

    def test_broken_index_is_ignored(self):
        (self.src / "docs" / "crests.json").write_text("[1, 2]", encoding="utf-8")
        self.assertEqual(apply_generated.apply(self.src, self.repo), [])
        self.assertFalse((self.repo / "docs" / "crests.json").exists())


if __name__ == "__main__":
    unittest.main()
