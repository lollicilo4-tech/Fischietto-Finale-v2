import os
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from generate import _report_source_coverage


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


if __name__ == "__main__":
    unittest.main()
