from pathlib import Path
import unittest


class LiveAttributionCssTests(unittest.TestCase):
    def test_attribution_css_is_not_joined_by_literal_backslash_n(self):
        root = Path(__file__).resolve().parents[1]
        for relative_path in ("static/index.html", "docs/index.html"):
            with self.subTest(path=relative_path):
                html = (root / relative_path).read_text(encoding="utf-8")
                self.assertNotIn(r"\n.live-attribution", html)
                self.assertIn(".live-attribution .sportscore-credit{", html)
                self.assertIn(
                    ".live-attribution .sportscore-credit:focus-visible{", html
                )


if __name__ == "__main__":
    unittest.main()
