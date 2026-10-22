"""L'AI analizza solo le partite delle prossime 48 ore (quota gratuita di Groq)."""
import asyncio
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import app.analyst as analyst

BASE = {"lh": 1.4, "la": 1.1, "p1": 0.45, "px": 0.28, "p2": 0.27}


def fixture(match_id: str, hours: float | None) -> dict:
    kickoff = None if hours is None else (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
    return {"id": match_id, "home": "Genoa", "away": "Fiorentina", "kickoff": kickoff}


class WindowTests(unittest.TestCase):
    def test_window(self):
        self.assertTrue(analyst._within_ai_window(fixture("a", 10)))
        self.assertTrue(analyst._within_ai_window(fixture("b", -1)), "partita già iniziata")
        self.assertTrue(analyst._within_ai_window(fixture("c", None)), "orario sconosciuto")
        self.assertFalse(analyst._within_ai_window(fixture("d", analyst.AI_WINDOW_HOURS + 1)))


class AnalyzeAllTests(unittest.TestCase):
    def run_all(self, items, cache=None):
        groq_result = {"ai": True, "text": "ok", "factor_home": 1.0, "factor_away": 1.0,
                       "absences_home": [], "absences_away": [], "sources": [{"url": "https://x.example"}],
                       "provider": "groq", "validation_version": analyst.VALIDATION_VERSION}
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(analyst, "_cache", dict(cache or {})), \
                patch.object(analyst, "PERSIST_PATH", Path(tmp) / "ai_cache.json"), \
                patch.object(analyst, "_groq_daily_limit_reached", False), \
                patch.dict(os.environ, {"GROQ_API_KEY": "test"}), \
                patch.object(analyst, "_ask_groq", AsyncMock(return_value=groq_result)) as groq:
            results = asyncio.run(analyst.analyze_all(items, {}, True, league="SA"))
        return results, groq

    def test_far_matches_do_not_call_the_ai(self):
        items = [{"fx": fixture("vicina", 20), "base": BASE}, {"fx": fixture("lontana", 120), "base": BASE}]
        results, groq = self.run_all(items)
        self.assertEqual(groq.await_count, 1)
        self.assertTrue(results[0]["ai"])
        self.assertFalse(results[1]["ai"])
        self.assertTrue(results[1]["deferred"])

    def test_existing_analysis_of_far_match_is_reused(self):
        cached = {"ai": True, "text": "dalla cache", "factor_home": 1.0, "factor_away": 1.0,
                  "absences_home": [], "absences_away": [], "sources": [], "provider": "groq",
                  "validation_version": analyst.VALIDATION_VERSION}
        results, groq = self.run_all([{"fx": fixture("lontana", 100), "base": BASE}],
                                     cache={"lontana": (time.time() - 3600, cached)})
        self.assertEqual(groq.await_count, 0)
        self.assertEqual(results[0]["text"], "dalla cache")


class PipelineStatusTests(unittest.TestCase):
    def test_status_counts_only_matches_within_the_window(self):
        from app import pipeline
        ctx = {"demo": True, "teams": {"Genoa": {"att": 1.0, "def": 1.0, "form": ""},
                                        "Fiorentina": {"att": 1.0, "def": 1.0, "form": ""}},
               "avg_h": 1.4, "avg_a": 1.1, "finished": [], "matchday": 9,
               "fixtures": [dict(fixture("vicina", 10), label=None), dict(fixture("lontana", 120), label=None)]}
        ai = {"ai": True, "text": "ok", "factor_home": 1.0, "factor_away": 1.0, "absences_home": [],
              "absences_away": [], "sources": [], "provider": "groq"}
        far = analyst.deferred_analysis(ctx["fixtures"][1], {"lh": 1.4, "la": 1.1, "p1": 0.4, "px": 0.3, "p2": 0.3}, {})
        with patch.object(pipeline.data, "get_context", AsyncMock(return_value=ctx)), \
                patch.object(pipeline.analyst, "analyze_all", AsyncMock(return_value=[ai, far])):
            turno = asyncio.run(pipeline.build_turno("SA", use_ai=True, persist=False))
        self.assertEqual(turno["ai_status"], "attiva")
        lontana = turno["matches"][1]["analysis"]
        self.assertTrue(lontana["deferred"])
        self.assertIn("48 ore prima della partita", lontana["text"])


if __name__ == "__main__":
    unittest.main()
