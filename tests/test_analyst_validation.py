import unittest
from types import SimpleNamespace

from app.analyst import SOURCE_REFRESH_LIMIT_PER_LEAGUE, _cache_is_compatible, _cache_needs_source_refresh, _select_source_refresh_ids, _normalized_provider, _extract_grounding_sources, _extract_response_text, _is_groq_daily_limit, _parse_json, _validate_absences


class CacheCompatibilityTests(unittest.TestCase):
    def test_grounding_refresh_budget_is_one_per_league(self):
        self.assertEqual(SOURCE_REFRESH_LIMIT_PER_LEAGUE, 1)

    def test_current_gemini_cache_version_is_compatible(self):
        self.assertTrue(_cache_is_compatible({"provider": "gemini", "validation_version": 8}))

    def test_provider_is_recovered_for_legacy_cache(self):
        self.assertEqual(_normalized_provider({"validation_version": 4}), "groq")
        self.assertEqual(_normalized_provider({"validation_version": 8}), "gemini")
        self.assertTrue(_cache_is_compatible({"validation_version": 4}))

    def test_current_groq_cache_version_is_compatible(self):
        self.assertTrue(_cache_is_compatible({"provider": "groq", "validation_version": 4}))

    def test_legacy_groq_cache_versions_remain_compatible(self):
        for version in (1, 2, 3, 4, 5, 6):
            with self.subTest(version=version):
                self.assertTrue(_cache_is_compatible({"provider": "groq", "validation_version": version}))

    def test_old_gemini_cache_versions_are_rejected(self):
        for version in (1, 2, 3, 4, 5, 6, 7):
            with self.subTest(version=version):
                self.assertFalse(_cache_is_compatible({"provider": "gemini", "validation_version": version}))

    def test_malformed_cache_entry_is_rejected(self):
        self.assertFalse(_cache_is_compatible(None))
        self.assertFalse(_cache_is_compatible({"provider": "gemini", "validation_version": "8"}))


    def test_legacy_cache_without_sources_is_refreshed(self):
        self.assertTrue(_cache_needs_source_refresh({"provider": "groq", "validation_version": 4, "sources": []}))
        self.assertTrue(_cache_needs_source_refresh({"validation_version": 4, "sources": []}))

    def test_current_gemini_v8_cache_without_sources_needs_bounded_refresh(self):
        self.assertTrue(_cache_needs_source_refresh({"provider": "gemini", "validation_version": 8, "sources": []}))

    def test_source_refresh_is_bounded_and_prioritizes_oldest_cache(self):
        now = 1_800_000.0
        items = [{"fx": {"id": str(i)}} for i in range(12)]
        cache = {
            str(i): (
                now - (30 + i) * 3600,
                {"provider": "gemini", "validation_version": 8, "sources": []},
            )
            for i in range(12)
        }
        cache["11"] = (
            now - 40 * 3600,
            {"provider": "gemini", "validation_version": 8, "sources": [{"url": "https://example.com"}]},
        )
        selected = _select_source_refresh_ids(items, cache=cache, now=now, limit=3)
        self.assertEqual(selected, {"10", "9", "8"})
        self.assertLessEqual(len(selected), 3)

    def test_source_refresh_skips_recent_cache(self):
        now = 1_800_000.0
        items = [{"fx": {"id": "recent"}}]
        cache = {"recent": (now - 2 * 3600, {"provider": "gemini", "validation_version": 8, "sources": []})}
        self.assertEqual(_select_source_refresh_ids(items, cache=cache, now=now), set())

    def test_cache_with_sources_does_not_need_source_refresh(self):
        self.assertFalse(_cache_needs_source_refresh({"provider": "groq", "validation_version": 4, "sources": [{"url": "https://example.com"}]}))


class ValidateAbsencesTests(unittest.TestCase):
    def setUp(self):
        self.fixture = {"home": "Genoa", "away": "Fiorentina"}


    def test_parse_json_accepts_json_wrapped_in_markdown(self):
        parsed = _parse_json('Risultato:\n```json\n{"assenze_casa": [], "fattore_gol_casa": 1.0}\n```')
        self.assertEqual(parsed["assenze_casa"], [])
        self.assertEqual(parsed["fattore_gol_casa"], 1.0)


    def test_parse_json_rejects_non_object_json(self):
        with self.assertRaises(ValueError):
            _parse_json('[1, 2, 3]')

    def test_gemini_text_is_recovered_from_candidate_parts(self):
        response = SimpleNamespace(
            text=None,
            candidates=[SimpleNamespace(content=SimpleNamespace(parts=[
                SimpleNamespace(text='{"assenze_casa": [],'),
                SimpleNamespace(text='"assenze_trasferta": []}'),
            ]))],
        )
        parsed = _parse_json(_extract_response_text(response))
        self.assertEqual(parsed["assenze_casa"], [])
        self.assertEqual(parsed["assenze_trasferta"], [])


    def test_gemini_grounding_sources_support_sdk_objects_and_dicts(self):
        response = SimpleNamespace(candidates=[
            SimpleNamespace(grounding_metadata=SimpleNamespace(grounding_chunks=[
                SimpleNamespace(web=SimpleNamespace(uri="https://example.com/a", title="Example A")),
                {"web": {"uri": "https://example.com/b", "title": "Example B"}},
                SimpleNamespace(web=SimpleNamespace(uri="https://example.com/a", title="Duplicate")),
            ]))
        ])
        sources = _extract_grounding_sources(response)
        self.assertEqual(len(sources), 2)
        self.assertEqual(sources[0]["title"], "Example A")
        self.assertEqual(sources[1]["url"], "https://example.com/b")

    def test_groq_daily_limit_is_distinguished_from_tpm(self):
        self.assertTrue(_is_groq_daily_limit(Exception("429 tokens per day (TPD) limit reached")))
        self.assertFalse(_is_groq_daily_limit(Exception("429 tokens per minute (TPM), try again in 3s")))


    def test_grounding_sources_exclude_social_media(self):
        from app.analyst import _relevant_sources
        sources = [
            {"title": "instagram.com", "url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/example"},
            {"title": "Club official news", "url": "https://club.example/news/team-update"},
        ]
        result = _relevant_sources(sources, {"home": "Como 1907", "away": "Roma"})
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["title"], "Club official news")

    def test_confirmed_absence_requires_player_team_and_out_evidence(self):
        result = _validate_absences(
            {
                "assenze_casa": ["Sow"],
                "assenze_trasferta": [],
                "fattore_gol_casa": 0.95,
                "fattore_gol_trasferta": 1.0,
                "spiegazione": "Sow è indisponibile per questa partita.",
            },
            self.fixture,
            [{"title": "Genoa: Sow out per lesione muscolare", "url": "https://example.com/genoa-sow-out"}],
        )
        self.assertEqual(result["absences_home"], ["Sow"])
        self.assertEqual(result["factor_home"], 0.95)

    def test_wrong_team_or_missing_confirmation_fails_closed(self):
        result = _validate_absences(
            {
                "assenze_casa": ["Moise Kean"],
                "assenze_trasferta": [],
                "fattore_gol_casa": 0.9,
                "fattore_gol_trasferta": 1.05,
                "spiegazione": "L'attaccante è indisponibile.",
            },
            {"home": "Como 1907", "away": "Roma"},
            [{"title": "Fiorentina: Moise Kean out per infortunio", "url": "https://example.com/kean-out"}],
        )
        self.assertEqual(result["absences_home"], [])
        self.assertEqual(result["factor_home"], 1.0)
        self.assertEqual(result["factor_away"], 1.0)
        self.assertTrue(result["validation_warning"])

    def test_doubtful_or_recovering_player_is_not_an_absence(self):
        result = _validate_absences(
            {
                "assenze_casa": ["Obert (pronto a giocare)"],
                "assenze_trasferta": [],
                "fattore_gol_casa": 0.95,
                "fattore_gol_trasferta": 0.9,
                "spiegazione": "Obert è pronto a giocare.",
            },
            {"home": "Cagliari", "away": "Juventus"},
            [{"title": "Cagliari: Obert out per infortunio", "url": "https://example.com/obert-out"}],
        )
        self.assertEqual(result["absences_home"], [])
        self.assertEqual(result["factor_home"], 1.0)
        self.assertEqual(result["factor_away"], 1.0)

    def test_no_confirmed_absences_means_neutral_factors(self):
        result = _validate_absences(
            {
                "assenze_casa": [],
                "assenze_trasferta": [],
                "fattore_gol_casa": 0.92,
                "fattore_gol_trasferta": 1.08,
                "spiegazione": "Non sono state trovate assenze confermate.",
            },
            self.fixture,
            [],
        )
        self.assertEqual(result["factor_home"], 1.0)
        self.assertEqual(result["factor_away"], 1.0)


if __name__ == "__main__":
    unittest.main()
