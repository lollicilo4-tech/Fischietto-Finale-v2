"""Pulizia dei branch (.github/scripts/cleanup_branches.py): niente lavoro deve andare perso."""
import datetime as dt
import importlib.util
import io
import json
import os
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cleanup_branches", ROOT / ".github" / "scripts" / "cleanup_branches.py")
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)

NOW = dt.datetime(2026, 10, 24, 10, 0, tzinfo=dt.timezone.utc)
OLD = NOW - dt.timedelta(days=5)


def pr(number, state="closed", merged=True, sha="s1"):
    return {"number": number, "state": state, "merged_at": "2026-10-20T10:00:00Z" if merged else None,
            "head": {"sha": sha, "ref": "x", "repo": {"full_name": "o/r"}}}


class DecideTests(unittest.TestCase):
    def test_fixed_branches_are_kept(self):
        for name in ("main", "monitoraggio"):
            self.assertEqual(cleanup.decide(name, "s1", OLD, [pr(1)], NOW)[0], "keep")

    def test_open_pr_is_kept(self):
        self.assertEqual(cleanup.decide("feat/a", "s1", OLD, [pr(5, state="open", merged=False)], NOW),
                         ("keep", "PR #5 aperta"))

    def test_merged_pr_at_same_commit_is_deleted(self):
        self.assertEqual(cleanup.decide("feat/a", "s1", OLD, [pr(7)], NOW), ("delete", "PR #7 già unita"))

    def test_commits_after_the_merge_are_not_lost(self):
        action, _ = cleanup.decide("feat/a", "s2", OLD, [pr(7, sha="s1")], NOW)
        self.assertEqual(action, "compare")
        self.assertEqual(cleanup.decide("feat/a", "s2", OLD, [pr(7, sha="s1")], NOW, ahead=1)[0], "archive")

    def test_recent_work_is_kept(self):
        recent = NOW - dt.timedelta(hours=20)
        self.assertEqual(cleanup.decide("fix/monitor-codex-x", "s9", recent, [], NOW)[0], "keep")

    def test_empty_and_unmerged_branches(self):
        self.assertEqual(cleanup.decide("fix/vuoto", "s3", OLD, [], NOW, ahead=0)[0], "delete")
        action, reason = cleanup.decide("feat/idea", "s4", OLD, [pr(3, merged=False)], NOW, ahead=2)
        self.assertEqual(action, "archive")
        self.assertIn("archivio/feat/idea", reason)


class FakeGitHub:
    """GitHub finto: registra le chiamate di scrittura."""

    def __init__(self, fail_tag=False):
        self.writes, self.fail_tag = [], fail_tag
        self.branches = [("main", "m"), ("feat/unita", "s1"), ("fix/vuoto", "s3"), ("feat/idea", "s4"),
                         ("feat/aperta", "s5")]
        self.prs = [dict(pr(1, sha="s1"), head={"sha": "s1", "ref": "feat/unita", "repo": {"full_name": "o/r"}}),
                    dict(pr(2, state="open", merged=False, sha="s5"),
                         head={"sha": "s5", "ref": "feat/aperta", "repo": {"full_name": "o/r"}})]

    def call(self, method, path, body=None):
        if method == "GET" and path.startswith("/commits/"):
            return {"commit": {"committer": {"date": "2026-10-01T10:00:00Z"}}}
        if method == "GET" and path.startswith("/compare/"):
            return {"ahead_by": 0 if "vuoto" in path else 3}
        if method == "GET" and path.startswith("/git/ref/tags/"):
            return {"object": {"sha": "altro" if self.fail_tag else "s4"}}
        self.writes.append((method, path, body))
        return {}

    def paged(self, path):
        if path.startswith("/pulls"):
            return self.prs
        return [{"name": n, "commit": {"sha": s}} for n, s in self.branches]


class RunTests(unittest.TestCase):
    def run_main(self, execute, fake):
        env = {"REPO": "o/r", "GITHUB_TOKEN": "t", "ESEGUI": "true" if execute else "false"}
        with patch.dict(os.environ, env), patch.object(cleanup, "GitHub", lambda repo, token: fake):
            os.environ.pop("GITHUB_STEP_SUMMARY", None)
            out = io.StringIO()
            with redirect_stdout(out):
                code = cleanup.main()
        return code, out.getvalue()

    def test_dry_run_changes_nothing(self):
        fake = FakeGitHub()
        code, report = self.run_main(False, fake)
        self.assertEqual(code, 0)
        self.assertEqual(fake.writes, [])
        self.assertIn("prova: nessuna modifica", report)
        self.assertIn("| `feat/idea` | da archiviare |", report)
        self.assertIn("| `feat/unita` | da eliminare |", report)

    def test_execution_archives_before_deleting(self):
        fake = FakeGitHub()
        code, _ = self.run_main(True, fake)
        self.assertEqual(code, 0)
        self.assertEqual(len(fake.writes), 4, "3 branch eliminati e 1 tag di archivio")
        deleted = [p for m, p, _ in fake.writes if m == "DELETE"]
        self.assertEqual(sorted(deleted), ["/git/refs/heads/feat/idea", "/git/refs/heads/feat/unita",
                                           "/git/refs/heads/fix/vuoto"])
        tag_at = fake.writes.index(("POST", "/git/refs", {"ref": "refs/tags/archivio/feat/idea", "sha": "s4"}))
        self.assertLess(tag_at, fake.writes.index(("DELETE", "/git/refs/heads/feat/idea", None)))
        self.assertNotIn("/git/refs/heads/main", deleted)
        self.assertNotIn("/git/refs/heads/feat/aperta", deleted)

    def test_branch_is_kept_if_archive_tag_does_not_match(self):
        fake = FakeGitHub(fail_tag=True)
        code, report = self.run_main(True, fake)
        self.assertEqual(code, 1)
        self.assertNotIn(("DELETE", "/git/refs/heads/feat/idea", None), fake.writes)
        self.assertIn("punta a un altro commit", report)

    def test_existing_tag_is_accepted(self):
        fake = FakeGitHub()
        original = fake.call

        def call(method, path, body=None):
            if method == "POST":
                raise urllib.error.HTTPError(path, 422, "esiste", {}, None)
            return original(method, path, body)
        fake.call = call
        code, _ = self.run_main(True, fake)
        self.assertEqual(code, 0)
        self.assertIn(("DELETE", "/git/refs/heads/feat/idea", None), fake.writes)


if __name__ == "__main__":
    unittest.main()
