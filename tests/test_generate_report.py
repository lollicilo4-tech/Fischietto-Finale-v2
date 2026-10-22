import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

import asyncio
import json

import generate
from generate import _report_source_coverage, _report_update_failure


class SourceCoverageReportTests(unittest.TestCase):
    def test_low_coverage_is_reported_without_blocking(self):
        payload = {
            "league_name": "Premier League",
            "matches": [
                {"analysis": {"ai": True, "sources": [{"url": "https://example.com/news"}]}},
                {"analysis": {"ai": True, "sources": []}},
                {"analysis": {"ai": True, "sources": []}},
            ],
        }
        payloads = {"PL": (payload, {}, {})}
        with tempfile.TemporaryDirectory() as directory:
            summary_path = str(Path(directory) / "summary.md")
            output = StringIO()
            with patch.dict(os.environ, {
                "GITHUB_ACTIONS": "true",
                "GITHUB_STEP_SUMMARY": summary_path,
            }):
                with redirect_stdout(output):
                    _report_source_coverage(payloads)
            self.assertIn("::warning title=Copertura fonti AI::", output.getvalue())
            self.assertIn("1/3", output.getvalue())
            self.assertTrue(Path(summary_path).is_file())
            summary = Path(summary_path).read_text(encoding="utf-8")
            self.assertIn("| Premier League | 3 | 1 | 33% |", summary)
            self.assertNotIn("\\n", summary)


class UpdateFailureReportTests(unittest.TestCase):
    def test_failure_is_written_to_summary_without_publishing_data(self):
        with tempfile.TemporaryDirectory() as directory:
            summary_path = Path(directory) / "summary.md"
            output = StringIO()
            with patch.dict(os.environ, {
                "GITHUB_ACTIONS": "true",
                "GITHUB_STEP_SUMMARY": str(summary_path),
            }):
                with redirect_stderr(output):
                    _report_update_failure("PL", "Premier League", "HTTPStatusError: status 503\nretry exhausted")
            self.assertIn("Aggiornamento fallito", output.getvalue())
            summary = summary_path.read_text(encoding="utf-8")
            self.assertIn("Premier League (PL)", summary)
            self.assertIn("HTTPStatusError: status 503 retry exhausted", summary)
            self.assertIn("i JSON già pubblicati sono preservati", summary)


def _turno(code: str) -> dict:
    return {
        "demo": False, "ai": False, "ai_error": None, "ai_status": "solo_statistica",
        "_pending_saves": [{"match_id": f"{code}-1"}],
        "matches": [{
            "id": f"{code}-1", "home": "Casa", "away": "Ospite", "kickoff": "2026-10-25T14:00:00Z",
            "prob": {"p1": 0.5, "px": 0.3, "p2": 0.2}, "xg": [1.4, 1.0],
            "top_scores": [[1, 0, 0.12]], "markets": {}, "analysis": {"ai": False, "adjusted": False},
        }],
    }


class LeagueIsolationTests(unittest.TestCase):
    def run_main(self, failing: set[str]):
        async def build_turno(code, use_ai=None, persist=True):
            if code in failing:
                raise RuntimeError(f"{code} non raggiungibile")
            return _turno(code)

        async def build_storico(code):
            return {"demo": False, "n": 0, "hit": 0, "items": []}

        async def build_classifica(code):
            return {"demo": False, "table": [{"pos": 1}]}

        saved = []
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / "docs"
            out.mkdir()
            (out / "league-PL-turno.json").write_text('{"vecchio": true}', encoding="utf-8")
            with patch.object(generate, "OUT", out), \
                    patch.object(generate.pipeline, "build_turno", build_turno), \
                    patch.object(generate.pipeline, "build_storico", build_storico), \
                    patch.object(generate.pipeline, "build_classifica", build_classifica), \
                    patch.object(generate.pipeline, "_save_all", lambda pending: saved.extend(pending)), \
                    patch.dict(os.environ, {"GITHUB_ACTIONS": "", "GITHUB_STEP_SUMMARY": ""}), \
                    redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                code = asyncio.run(generate.main())
            files = {f.name: f.read_text(encoding="utf-8") for f in out.iterdir() if f.suffix == ".json"}
        return code, files, saved

    def test_one_failing_league_does_not_block_the_others(self):
        code, files, saved = self.run_main({"PL"})
        self.assertEqual(code, generate.EXIT_PARTIAL)
        self.assertIn("turno.json", files)                      # Serie A pubblicata
        self.assertIn("league-BL1-turno.json", files)
        self.assertEqual(json.loads(files["league-PL-turno.json"]), {"vecchio": True})  # PL invariata
        self.assertNotIn("_pending_saves", json.loads(files["turno.json"]))
        ids = {item["match_id"] for item in saved}
        self.assertIn("SA-1", ids)
        self.assertNotIn("PL-1", ids, "una lega fallita non salva pronostici")

    def test_all_leagues_ok(self):
        code, files, saved = self.run_main(set())
        self.assertEqual(code, generate.EXIT_OK)
        self.assertEqual(len(saved), len(generate.COMPETITIONS))

    def test_all_leagues_failing_publishes_nothing(self):
        code, files, saved = self.run_main(set(generate.COMPETITIONS))
        self.assertEqual(code, generate.EXIT_ALL_FAILED)
        self.assertEqual(set(files), {"league-PL-turno.json"})
        self.assertEqual(saved, [])


if __name__ == "__main__":
    unittest.main()
