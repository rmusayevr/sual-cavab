import json
import re
from collections import Counter
from pathlib import Path

from django.test import SimpleTestCase

REPO = Path(__file__).resolve().parents[2]
CI = REPO / ".github" / "workflows" / "ci.yml"
LOOP = REPO / ".claude" / "harness-loop.json"

# Steps that set a job up. They are in ci.yml and not in the loop's `checks`. Matched WHOLE, so a command
# that merely contains one of them (`pip install pip-audit && pip-audit ...`) is still a check.
SETUP = {"pip install -r backend/requirements.txt", "cd frontend && npm ci"}

# Checks the loop runs and CI does not, on purpose. The loop's contract is "same as CI, plus anything CI
# skips" (.claude/skills/work-the-queue/reference.md); a loop-only check goes here so it is a decision.
LOOP_ONLY = set()

# This test reads ci.yml as text, not as YAML. So it refuses what it cannot read, instead of passing:
# a run step in any form but the plain one-line `- run: command`, and the keys that change whether or
# how a step runs. When one appears the test fails with the reason: write the step plainly, or teach
# this test the new form together with the change.
RUN_LINE = re.compile(r"^\s*-\s*run:\s+(?P<command>[^\s#\"'|>{&*!\[][^#]*?)\s*$")
ANY_RUN = re.compile(r"(^|[\s{,])run\s*:")
UNREADABLE_KEYS = ("if", "continue-on-error", "strategy", "matrix", "defaults", "working-directory", "shell")
STEP_ONLY_UNREADABLE_KEYS = ("env",)  # job-level `env:` is fine (the database settings); a step's changes the command


def ci_checks(text):
    """The checks of ci.yml: its one-line `- run:` steps minus the setup steps, in file order.

    Raises AssertionError for anything it cannot read (see above), so that never passes silently."""
    commands = []
    in_steps = False
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(line) - len(line.lstrip(" "))
        if re.match(r"^\s{4}steps:\s*$", line):
            in_steps = True
        elif indent <= 4 and in_steps and not stripped.startswith("-"):
            in_steps = False  # the next job key, or a key of this job after its steps
        key = re.match(r"^\s*(?:-\s+)?([A-Za-z][\w-]*)\s*:", line)
        name = key.group(1) if key else None
        if name in UNREADABLE_KEYS or (in_steps and name in STEP_ONLY_UNREADABLE_KEYS):
            raise AssertionError(
                f"ci.yml line {number} uses `{name}:`, which can change whether or how a step runs. "
                f"This test reads ci.yml as text and cannot follow that. Line: {stripped!r}"
            )
        if ANY_RUN.search(line):
            match = RUN_LINE.match(line)
            if not match:
                raise AssertionError(
                    f"ci.yml line {number} has a `run:` in a form this test does not read (a block, quotes, a "
                    f"comment, a flow mapping, or a `run:` that is not the first key of a `- run:` step): "
                    f"{stripped!r}. Write the step as a plain one-line `- run: command`."
                )
            commands.append(match.group("command"))
    return [c for c in commands if c not in SETUP]


def loop_checks():
    # utf-8-sig: a byte order mark that a Windows editor adds must not stop this test (guard-merge.mjs strips it too)
    return json.loads(LOOP.read_text(encoding="utf-8-sig"))["checks"]


class CiAndLoopChecksAgree(SimpleTestCase):
    """The same checks are written in .github/workflows/ci.yml and .claude/harness-loop.json (#51). If one
    changes and not the other, the loop could pass work that CI fails, or the reverse. This fails when they
    differ, so a change has to touch both, and when ci.yml uses a form it cannot read."""

    def test_every_check_ci_runs_is_a_check_the_loop_runs(self):
        ci = ci_checks(CI.read_text(encoding="utf-8"))

        self.assertTrue(ci, "no checks were read from ci.yml")
        self.assertEqual(Counter(ci), Counter(c for c in loop_checks() if c not in LOOP_ONLY))

    def test_a_check_only_the_loop_runs_is_listed_here_on_purpose(self):
        extra = set(loop_checks()) - set(ci_checks(CI.read_text(encoding="utf-8")))

        self.assertEqual(extra, LOOP_ONLY)


class TheReaderRefusesWhatItCannotRead(SimpleTestCase):
    """The comparison above is only as good as the reading. These are the ways ci.yml could change so that
    CI and the loop differ while a text match stays green (found by the review of #97)."""

    PLAIN = "    steps:\n      - uses: actions/checkout@v7\n      - run: pip install -r backend/requirements.txt\n      - run: cd backend && python manage.py check\n"

    def test_it_reads_plain_one_line_steps_and_skips_the_setup_steps(self):
        self.assertEqual(ci_checks(self.PLAIN), ["cd backend && python manage.py check"])

    def test_a_command_that_only_contains_a_setup_command_is_still_a_check(self):
        text = self.PLAIN + "      - run: pip install pip-audit && pip-audit -r backend/requirements.txt\n"

        self.assertIn("pip install pip-audit && pip-audit -r backend/requirements.txt", ci_checks(text))

    def test_a_step_with_a_name_and_run_on_separate_lines_is_refused(self):
        text = self.PLAIN + "      - name: Deploy check\n        run: cd backend && python manage.py check --deploy\n"

        with self.assertRaisesRegex(AssertionError, "not the first key"):
            ci_checks(text)

    def test_other_ways_to_write_a_run_step_are_refused(self):
        for step in (
            "      - run: |\n          cd backend\n          python manage.py check\n",
            "      - run: >-\n          cd backend && python manage.py check\n",
            '      - run: "cd backend && python manage.py check"\n',
            "      - run: cd backend && python manage.py check # the checks\n",
            "      - { run: cd backend && python manage.py check }\n",
        ):
            with self.subTest(step=step), self.assertRaises(AssertionError):
                ci_checks(self.PLAIN + step)

    def test_keys_that_change_whether_or_how_a_step_runs_are_refused(self):
        for modifier in (
            "        if: false\n",
            "        continue-on-error: true\n",
            "        working-directory: frontend\n",
            "        env:\n          DJANGO_SETTINGS_MODULE: other\n",
            "    strategy:\n      matrix:\n        python: [3.13]\n",
        ):
            with self.subTest(modifier=modifier), self.assertRaises(AssertionError):
                ci_checks(self.PLAIN + "      - run: cd backend && python manage.py test --noinput\n" + modifier)

    def test_a_job_level_env_for_the_database_is_fine(self):
        text = "    env:\n      POSTGRES_DB: sual_cavab\n" + self.PLAIN

        self.assertEqual(ci_checks(text), ["cd backend && python manage.py check"])

    def test_a_commented_out_step_is_not_a_check(self):
        text = self.PLAIN + "      # - run: cd backend && python manage.py check --deploy\n"

        self.assertEqual(ci_checks(text), ["cd backend && python manage.py check"])

    def test_it_reads_the_real_file_and_finds_its_checks(self):
        self.assertGreaterEqual(len(ci_checks(CI.read_text(encoding="utf-8"))), 1)

    def test_a_changed_added_or_removed_check_is_a_difference(self):
        real = CI.read_text(encoding="utf-8")
        loop = Counter(loop_checks())
        changed = real.replace("manage.py test --noinput", "manage.py test")
        added = real + "      - run: cd backend && python manage.py check --deploy\n"
        removed = "\n".join(line for line in real.splitlines() if "makemigrations --check" not in line)

        for label, text in (("changed", changed), ("added", added), ("removed", removed)):
            with self.subTest(label):
                self.assertNotEqual(Counter(ci_checks(text)), loop)
