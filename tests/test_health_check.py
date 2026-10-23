"""Lo script di monitoraggio (.github/scripts/health_check.py) deve accorgersi dei problemi."""
import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("health_check", ROOT / ".github" / "scripts" / "health_check.py")
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class PublishedDataTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        shutil.copytree(ROOT / "app", self.root / "app")
        shutil.copytree(ROOT / "docs", self.root / "docs", ignore=shutil.ignore_patterns("*.png", "*.html", "*.js"))
        self.turno_path = self.root / "docs" / "turno.json"
        self.turno = json.loads(self.turno_path.read_text(encoding="utf-8"))
        generated = datetime.fromisoformat(self.turno["generated_at"].replace("Z", "+00:00"))
        self.now = generated + timedelta(hours=1)
        # tutte le leghe "aggiornate" un'ora fa e con il turno ancora da giocare
        kickoff = (self.now + timedelta(days=1)).isoformat().replace("+00:00", "Z")
        for path in (self.root / "docs").glob("*turno.json"):
            data = json.loads(path.read_text(encoding="utf-8"))
            data["generated_at"] = generated.isoformat(timespec="minutes")
            for m in data["matches"]:
                m["kickoff"] = kickoff
            path.write_text(json.dumps(data), encoding="utf-8")
        self.turno = json.loads(self.turno_path.read_text(encoding="utf-8"))

    def tearDown(self):
        self.tmp.cleanup()

    def levels(self, now=None):
        return [(level, msg) for level, msg in health.check_published(self.root, now or self.now)]

    def write(self, data):
        self.turno_path.write_text(json.dumps(data), encoding="utf-8")

    def test_everything_ok(self):
        self.assertEqual([l for l, _ in self.levels()], [health.OK])

    def test_old_data(self):
        self.assertIn(health.WARN, [l for l, _ in self.levels(self.now + timedelta(hours=5))])
        errors = [m for l, m in self.levels(self.now + timedelta(hours=9)) if l == health.ERROR]
        self.assertTrue(any("Serie A: dati fermi" in m for m in errors))

    def test_finished_round(self):
        for m in self.turno["matches"]:
            m["kickoff"] = (self.now - timedelta(days=2)).isoformat().replace("+00:00", "Z")
        self.write(self.turno)
        self.assertTrue(any("già finito" in m for l, m in self.levels() if l == health.ERROR))

    def test_invalid_or_demo_or_missing(self):
        self.write(dict(self.turno, demo=True))
        self.assertTrue(any("dati di esempio" in m for _, m in self.levels()))
        self.write({"matches": []})
        self.assertTrue(any("non valido" in m for _, m in self.levels()))
        (self.root / "docs" / "league-PL-classifica.json").unlink()
        self.assertTrue(any("Premier League: file mancanti" in m for _, m in self.levels()))


class HistoryTests(unittest.TestCase):
    def test_lost_prediction_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT / ".github" / "scripts", root / ".github" / "scripts")
            shutil.copytree(ROOT / "app", root / "app")
            (root / "data").mkdir()
            pred = {"1": {"home": "A", "away": "B", "kickoff": "x", "p1": 0.5, "px": 0.3, "p2": 0.2, "pick": "1", "pick_p": 0.5},
                    "2": {"home": "C", "away": "D", "kickoff": "y", "p1": 0.4, "px": 0.3, "p2": 0.3, "pick": "1", "pick_p": 0.4}}
            git = lambda *a, **env: subprocess.run(["git", "-C", tmp, *a], check=True, capture_output=True,
                                                   env={"GIT_AUTHOR_DATE": env.get("date", ""), "GIT_COMMITTER_DATE": env.get("date", ""),
                                                        "HOME": tmp, "PATH": "/usr/bin:/bin"})
            git("init", "-q")
            git("config", "user.email", "t@example.com"); git("config", "user.name", "t")
            (root / "data" / "predictions.json").write_text(json.dumps(pred))
            git("add", "-A"); git("commit", "-qm", "vecchio", date="2026-10-20T10:00:00Z")
            del pred["2"]
            (root / "data" / "predictions.json").write_text(json.dumps(pred))
            git("commit", "-qam", "nuovo", date="2026-10-22T10:00:00Z")
            now = datetime(2026, 10, 22, 12, tzinfo=timezone.utc)
            results = health.check_history(root, now)
        self.assertEqual(results[0][0], health.ERROR)
        self.assertIn("spariti", results[0][1])


if __name__ == "__main__":
    unittest.main()
