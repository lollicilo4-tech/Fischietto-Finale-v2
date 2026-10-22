"""Controlli del job "pubblica" (.github/scripts/apply_generated.py): solo JSON validi e attesi,
e lo storico dei pronostici non può essere riscritto."""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("apply_generated", ROOT / ".github" / "scripts" / "apply_generated.py")
apply_generated = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apply_generated)

PRED = {"1": {"home": "Inter", "away": "Genoa", "kickoff": "2026-10-25T14:00:00Z",
              "p1": 0.6, "px": 0.25, "p2": 0.15, "pick": "1", "pick_p": 0.6}}


class ApplyGeneratedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.repo, self.src = self.tmp / "repo", self.tmp / "src"
        for d in (self.repo / "docs", self.repo / "data", self.src / "docs", self.src / "data"):
            d.mkdir(parents=True)
        shutil.copytree(ROOT / "app", self.repo / "app")
        (self.repo / "data" / "predictions.json").write_text(json.dumps(PRED), encoding="utf-8")
        self.turno = json.loads((ROOT / "docs" / "turno.json").read_text(encoding="utf-8"))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def put(self, rel: str, content) -> None:
        path = self.src / rel
        path.write_text(content if isinstance(content, str) else json.dumps(content), encoding="utf-8")

    def run_apply(self):
        return apply_generated.apply(self.src, self.repo)

    def test_valid_data_is_applied(self):
        self.put("docs/turno.json", self.turno)
        self.put("docs/league-PL-storico.json", {"n": 0})
        self.put("data/predictions.json", {**PRED, "2": dict(PRED["1"], home="Roma")})
        written = self.run_apply()
        self.assertEqual(set(written), {"docs/turno.json", "docs/league-PL-storico.json", "data/predictions.json"})

    def test_unexpected_files_are_ignored(self):
        self.put("docs/index.html", "<script>alert(1)</script>")
        self.put("docs/evil.json", {})
        (self.src / "data" / "update.yml").write_text("x", encoding="utf-8")
        self.assertEqual(self.run_apply(), [])
        self.assertFalse((self.repo / "docs" / "index.html").exists())

    def test_invalid_json_or_turno_is_rejected(self):
        self.put("docs/turno.json", "{non json")
        with self.assertRaises(apply_generated.Rejected):
            self.run_apply()
        self.put("docs/turno.json", {"matches": []})
        with self.assertRaises(apply_generated.Rejected):
            self.run_apply()

    def test_history_cannot_lose_or_change_predictions(self):
        self.put("data/predictions.json", {})
        with self.assertRaises(apply_generated.Rejected):
            self.run_apply()
        self.put("data/predictions.json", {"1": dict(PRED["1"], p1=0.7)})
        with self.assertRaises(apply_generated.Rejected):
            self.run_apply()

    def test_results_and_rounding_are_allowed(self):
        changed = dict(PRED["1"], p1=0.6004, result={"hg": 1, "ag": 0}, league="SA")
        self.put("data/predictions.json", {"1": changed})
        self.assertEqual(self.run_apply(), ["data/predictions.json"])


if __name__ == "__main__":
    unittest.main()
